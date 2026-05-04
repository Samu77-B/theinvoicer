from flask import Flask, render_template, request, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from werkzeug.middleware.proxy_fix import ProxyFix
from datetime import datetime
import os

from dotenv import load_dotenv

load_dotenv()

basedir = os.path.abspath(os.path.dirname(__file__))


def _database_uri():
    """Railway Postgres sets DATABASE_URL. Local dev uses SQLite if unset."""
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if url:
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        return url
    instance_path = os.path.join(basedir, "instance")
    os.makedirs(instance_path, exist_ok=True)
    db_path = os.path.join(instance_path, "invoices.db")
    return "sqlite:///" + db_path.replace("\\", "/")


# Optional: volume mount for generated PDFs only (DB is Postgres on Railway)
_data_root = os.environ.get("DATA_DIR", basedir).strip() or basedir
_invoice_folder = os.path.join(_data_root, "invoices")

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

_engine_options = {}
if (os.environ.get("DATABASE_URL") or "").strip():
    _engine_options["pool_pre_ping"] = True

_config = dict(
    SQLALCHEMY_DATABASE_URI=_database_uri(),
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    SECRET_KEY=os.environ.get("SECRET_KEY", "dev-change-in-production"),
    INVOICE_FOLDER=_invoice_folder,
)
if _engine_options:
    _config["SQLALCHEMY_ENGINE_OPTIONS"] = _engine_options
app.config.update(_config)
app.debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")

os.makedirs(app.config["INVOICE_FOLDER"], exist_ok=True)

db = SQLAlchemy(app)
migrate = Migrate(app, db)


class Client(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), nullable=False)
    address = db.Column(db.String(200))
    invoices = db.relationship("Invoice", backref="client", lazy=True)


class Invoice(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    invoice_number = db.Column(db.String(20), unique=True, nullable=False)
    date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    client_id = db.Column(db.Integer, db.ForeignKey("client.id"), nullable=False)
    items = db.relationship("InvoiceItem", backref="invoice", lazy=True)
    total_amount = db.Column(db.Float, nullable=False, default=0.0)
    paid = db.Column(db.Boolean, nullable=False, default=False)


class InvoiceItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(200), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    invoice_id = db.Column(db.Integer, db.ForeignKey("invoice.id"), nullable=False)


def _client_json(client):
    return {
        "id": client.id,
        "name": client.name,
        "email": client.email,
        "address": client.address or "",
    }


def generate_invoice_number(client_name):
    name_parts = client_name.split()

    if len(name_parts) >= 3:
        business_words = [word for word in name_parts if word and word[0].isupper()]
        if len(business_words) >= 3:
            prefix = "".join(word[0] for word in business_words[:3]).upper()
            if "Saturday Love Funk" in client_name:
                prefix = "SLF"

            count = Invoice.query.join(Client).filter(Client.name == client_name).count()
            return f"{prefix}{(count + 1):03d}"

    prefix = "".join(c for c in name_parts[0][:3] if c.isalpha()).upper()
    prefix = (prefix + "XXX")[:3]

    count = Invoice.query.join(Client).filter(Client.name == client_name).count()
    return f"{prefix}{(count + 1):03d}"


@app.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/clients", methods=["GET", "POST"])
def handle_clients():
    if request.method == "POST":
        data = request.json or {}
        new_client = Client(
            name=data["name"],
            email=data["email"],
            address=data.get("address", "") or "",
        )
        db.session.add(new_client)
        db.session.commit()
        return jsonify({"id": new_client.id, "message": "Client created successfully"})

    clients = Client.query.all()
    return jsonify([_client_json(c) for c in clients])


@app.route("/api/invoices", methods=["GET", "POST"])
def handle_invoices():
    if request.method == "POST":
        data = request.json or {}
        client = db.session.get(Client, data.get("client_id"))
        if not client:
            return jsonify({"error": "Client not found"}), 404

        client_folder = os.path.join(
            app.config["INVOICE_FOLDER"], client.name.replace(" ", "_")
        )
        if not os.path.exists(client_folder):
            os.makedirs(client_folder)

        new_invoice = Invoice(
            invoice_number=generate_invoice_number(client.name),
            client_id=client.id,
            date=datetime.utcnow(),
        )

        total_amount = 0.0
        for item_data in data.get("items", []):
            item = InvoiceItem(
                description=item_data["description"],
                amount=float(item_data["amount"]),
            )
            total_amount += item.amount
            new_invoice.items.append(item)

        new_invoice.total_amount = total_amount
        db.session.add(new_invoice)
        db.session.commit()

        return jsonify(
            {
                "id": new_invoice.id,
                "invoice_number": new_invoice.invoice_number,
                "client_name": client.name,
                "message": "Invoice created successfully",
            }
        )

    invoices = Invoice.query.all()
    return jsonify(
        [
            {
                "id": inv.id,
                "invoice_number": inv.invoice_number,
                "date": inv.date.strftime("%Y-%m-%d"),
                "client": _client_json(inv.client),
                "items": [
                    {"description": item.description, "amount": item.amount}
                    for item in inv.items
                ],
                "total_amount": inv.total_amount,
                "paid": inv.paid,
            }
            for inv in invoices
        ]
    )


@app.route("/api/invoices/<int:invoice_id>", methods=["GET", "PUT", "DELETE"])
def handle_invoice(invoice_id):
    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Not found"}), 404

    if request.method == "GET":
        return jsonify(
            {
                "id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "date": invoice.date.strftime("%Y-%m-%d"),
                "client": _client_json(invoice.client),
                "items": [
                    {"description": item.description, "amount": item.amount}
                    for item in invoice.items
                ],
                "total_amount": invoice.total_amount,
                "paid": invoice.paid,
            }
        )

    if request.method == "PUT":
        data = request.json or {}
        InvoiceItem.query.filter_by(invoice_id=invoice.id).delete()

        total_amount = 0.0
        for item_data in data.get("items", []):
            item = InvoiceItem(
                description=item_data["description"],
                amount=float(item_data["amount"]),
                invoice_id=invoice.id,
            )
            total_amount += item.amount
            db.session.add(item)

        invoice.total_amount = total_amount
        db.session.commit()
        return jsonify({"message": "Invoice updated successfully"})

    InvoiceItem.query.filter_by(invoice_id=invoice.id).delete()
    db.session.delete(invoice)
    db.session.commit()
    return jsonify({"message": "Invoice deleted successfully"})


@app.route("/download_invoice/<int:invoice_id>")
def download_invoice(invoice_id):
    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Not found"}), 404
    client_folder = os.path.join(
        app.config["INVOICE_FOLDER"], invoice.client.name.replace(" ", "_")
    )
    filename = f"{invoice.invoice_number}_{invoice.date.strftime('%Y%m%d')}.pdf"
    filepath = os.path.join(client_folder, filename)

    if os.path.exists(filepath):
        return send_file(filepath, as_attachment=True)
    return jsonify({"error": "Invoice file not found"}), 404


@app.route("/api/invoices/<int:invoice_id>/paid", methods=["PUT"])
def toggle_paid_status(invoice_id):
    try:
        data = request.get_json() or {}
        paid = bool(data.get("paid", False))

        invoice = db.session.get(Invoice, invoice_id)
        if not invoice:
            return jsonify({"success": False, "error": "Not found"}), 404

        invoice.paid = paid
        db.session.commit()

        return jsonify({"success": True, "paid": invoice.paid})
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/invoices/<int:invoice_id>/send", methods=["POST"])
def send_invoice_email(invoice_id):
    api_key = os.environ.get("RESEND_API_KEY")
    from_email = os.environ.get("RESEND_FROM_EMAIL")
    if not api_key or not from_email:
        return jsonify(
            {
                "success": False,
                "error": "RESEND_API_KEY and RESEND_FROM_EMAIL must be set on the server.",
            }
        ), 503

    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"success": False, "error": "Invoice not found"}), 404

    client = invoice.client
    if not (client.email or "").strip():
        return jsonify({"success": False, "error": "Client has no email address"}), 400

    try:
        import resend

        resend.api_key = api_key
        html = render_template("email_invoice.html", invoice=invoice)
        params = {
            "from": from_email,
            "to": [client.email.strip()],
            "subject": f"Invoice {invoice.invoice_number}",
            "html": html,
        }
        result = resend.Emails.send(params)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    return jsonify({"success": True, "id": result.get("id") if isinstance(result, dict) else None})


# Ensure tables exist (Railway runs gunicorn, not run.py — create_all is idempotent)
with app.app_context():
    db.create_all()


if __name__ == "__main__":
    app.run(debug=True)
