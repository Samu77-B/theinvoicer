from flask import Flask, render_template, request, jsonify, send_file, url_for, session, redirect
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
from sqlalchemy import inspect, text
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
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=14)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

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
    vat_applies = db.Column(db.Boolean, nullable=False, default=False)
    vat_rate_percent = db.Column(db.Float, nullable=True)
    vat_amount = db.Column(db.Float, nullable=False, default=0.0)


class InvoiceItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(200), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    invoice_id = db.Column(db.Integer, db.ForeignKey("invoice.id"), nullable=False)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)


def _auth_enabled() -> bool:
    return bool((os.environ.get("INVOICE_APP_PASSWORD") or "").strip())


def _bootstrap_auth_user():
    if not _auth_enabled():
        return
    username = (os.environ.get("INVOICE_APP_USERNAME") or "admin").strip() or "admin"
    if User.query.filter_by(username=username).first():
        return
    pwd = os.environ["INVOICE_APP_PASSWORD"].strip()
    db.session.add(User(username=username, password_hash=generate_password_hash(pwd)))
    db.session.commit()


def _ensure_invoice_vat_columns():
    """Add VAT columns to existing deployments (create_all does not alter tables)."""
    try:
        insp = inspect(db.engine)
        tables = insp.get_table_names()
        if "invoice" not in tables:
            return
        cols = {c["name"] for c in insp.get_columns("invoice")}
        dialect = db.engine.dialect.name
        alters = []
        if "vat_applies" not in cols:
            if dialect == "sqlite":
                alters.append(
                    "ALTER TABLE invoice ADD COLUMN vat_applies BOOLEAN NOT NULL DEFAULT 0"
                )
            else:
                alters.append(
                    "ALTER TABLE invoice ADD COLUMN vat_applies BOOLEAN NOT NULL DEFAULT FALSE"
                )
        if "vat_rate_percent" not in cols:
            alters.append("ALTER TABLE invoice ADD COLUMN vat_rate_percent FLOAT")
        if "vat_amount" not in cols:
            if dialect == "sqlite":
                alters.append(
                    "ALTER TABLE invoice ADD COLUMN vat_amount REAL NOT NULL DEFAULT 0"
                )
            else:
                alters.append(
                    "ALTER TABLE invoice ADD COLUMN vat_amount DOUBLE PRECISION NOT NULL DEFAULT 0"
                )
        for stmt in alters:
            with db.engine.begin() as conn:
                conn.execute(text(stmt))
    except Exception as e:
        app.logger.warning("Could not ensure invoice VAT columns: %s", e)


def _calendar_week_range(now=None):
    """Monday 00:00 UTC through the following Monday 00:00 UTC (end exclusive)."""
    now = now or datetime.utcnow()
    start = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end = start + timedelta(days=7)
    return start, end


def _calendar_month_range(now=None):
    """First day of month 00:00 UTC through first day of next month (end exclusive)."""
    now = now or datetime.utcnow()
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


def _net_subtotal_from_items(items):
    total = 0.0
    for it in items:
        if isinstance(it, dict):
            total += float(it["amount"])
        else:
            total += float(it.amount)
    return round(total, 2)


def _vat_amount_and_total(net_subtotal: float, vat_applies: bool, vat_rate_percent):
    if not vat_applies or vat_rate_percent is None:
        return 0.0, round(float(net_subtotal), 2)
    rate = float(vat_rate_percent)
    vat = round(net_subtotal * rate / 100.0, 2)
    return vat, round(net_subtotal + vat, 2)


def _invoice_dict(inv: Invoice):
    subtotal = _net_subtotal_from_items(inv.items)
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "date": inv.date.strftime("%Y-%m-%d"),
        "client": _client_json(inv.client),
        "items": [
            {"description": item.description, "amount": item.amount} for item in inv.items
        ],
        "subtotal_net": subtotal,
        "vat_applies": bool(inv.vat_applies),
        "vat_rate_percent": inv.vat_rate_percent,
        "vat_amount": float(inv.vat_amount or 0.0),
        "total_amount": inv.total_amount,
        "paid": inv.paid,
    }


def _parse_vat_from_payload(data: dict):
    vat_applies = bool(data.get("vat_applies", False))
    raw_rate = data.get("vat_rate_percent")
    rate = None
    if vat_applies:
        try:
            rate = float(raw_rate if raw_rate is not None else 20.0)
        except (TypeError, ValueError):
            return None, None, "Invalid VAT rate"
        if rate < 0 or rate > 100:
            return None, None, "VAT rate must be between 0 and 100"
    return vat_applies, rate, None


def _client_json(client):
    return {
        "id": client.id,
        "name": client.name,
        "email": client.email,
        "address": client.address or "",
    }


def _invoice_prefix(client_name: str) -> str:
    name_parts = (client_name or "").split()
    if len(name_parts) >= 3:
        business_words = [word for word in name_parts if word and word[0].isupper()]
        if len(business_words) >= 3:
            prefix = "".join(word[0] for word in business_words[:3]).upper()
            if "Saturday Love Funk" in client_name:
                prefix = "SLF"
            return prefix

    if not name_parts:
        return "INV"

    prefix = "".join(c for c in name_parts[0][:3] if c.isalpha()).upper()
    prefix = (prefix + "XXX")[:3]
    return prefix


def generate_invoice_number(client: Client) -> str:
    """
    Generate the next invoice number for a client.

    This uses the highest existing numeric suffix for the client's prefix, so
    manual edits like TOX105 won't break subsequent numbering (next becomes TOX106).
    """
    prefix = _invoice_prefix(client.name)
    existing = (
        db.session.query(Invoice.invoice_number)
        .filter(Invoice.client_id == client.id)
        .filter(Invoice.invoice_number.like(f"{prefix}%"))
        .all()
    )

    max_suffix = 0
    for (num,) in existing:
        if not num or not num.startswith(prefix):
            continue
        suffix = num[len(prefix) :]
        if suffix.isdigit():
            max_suffix = max(max_suffix, int(suffix))

    return f"{prefix}{(max_suffix + 1):03d}"


@app.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


@app.before_request
def _require_login():
    if not _auth_enabled():
        return None
    if request.endpoint in (None, "static", "health", "login", "logout"):
        return None
    if session.get("user_id"):
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Unauthorized"}), 401
    return redirect(url_for("login", next=request.path))


@app.route("/login", methods=["GET", "POST"])
def login():
    if not _auth_enabled():
        return redirect(url_for("index"))
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password_hash, password):
            session.clear()
            session["user_id"] = user.id
            session.permanent = True
            nxt = request.args.get("next") or ""
            if nxt.startswith("/") and not nxt.startswith("//"):
                return redirect(nxt)
            return redirect(url_for("index"))
        return render_template("login.html", error="Invalid username or password"), 401
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.pop("user_id", None)
    if _auth_enabled():
        return redirect(url_for("login"))
    return redirect(url_for("index"))


@app.route("/")
def index():
    return render_template("index.html", auth_enabled=_auth_enabled())


@app.route("/api/reports")
def api_reports():
    period = (request.args.get("period") or "month").strip().lower()
    if period == "week":
        start, end = _calendar_week_range()
    else:
        period = "month"
        start, end = _calendar_month_range()

    rows = (
        Invoice.query.filter(Invoice.date >= start, Invoice.date < end)
        .order_by(Invoice.date.desc())
        .all()
    )
    total_invoiced = sum(float(inv.total_amount or 0) for inv in rows)
    paid_total = sum(float(inv.total_amount or 0) for inv in rows if inv.paid)
    unpaid_total = total_invoiced - paid_total
    end_inclusive = end - timedelta(seconds=1)

    return jsonify(
        {
            "period": period,
            "range_start": start.strftime("%Y-%m-%d"),
            "range_end": end_inclusive.strftime("%Y-%m-%d"),
            "invoice_count": len(rows),
            "total_invoiced": round(total_invoiced, 2),
            "paid_total": round(paid_total, 2),
            "unpaid_total": round(unpaid_total, 2),
            "invoices": [
                {
                    "id": inv.id,
                    "invoice_number": inv.invoice_number,
                    "date": inv.date.strftime("%Y-%m-%d"),
                    "client_name": inv.client.name,
                    "total_amount": inv.total_amount,
                    "paid": inv.paid,
                }
                for inv in rows
            ],
        }
    )


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

        vat_applies, vat_rate, vat_err = _parse_vat_from_payload(data)
        if vat_err:
            return jsonify({"error": vat_err}), 400

        new_invoice = Invoice(
            invoice_number=generate_invoice_number(client),
            client_id=client.id,
            date=datetime.utcnow(),
            vat_applies=vat_applies,
            vat_rate_percent=vat_rate if vat_applies else None,
        )

        for item_data in data.get("items", []):
            item = InvoiceItem(
                description=item_data["description"],
                amount=float(item_data["amount"]),
            )
            new_invoice.items.append(item)

        net = _net_subtotal_from_items(new_invoice.items)
        vat_amt, gross = _vat_amount_and_total(net, vat_applies, vat_rate)
        new_invoice.vat_amount = vat_amt if vat_applies else 0.0
        new_invoice.total_amount = gross
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
    return jsonify([_invoice_dict(inv) for inv in invoices])


@app.route("/api/invoices/<int:invoice_id>", methods=["GET", "PUT", "DELETE"])
def handle_invoice(invoice_id):
    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Not found"}), 404

    if request.method == "GET":
        return jsonify(_invoice_dict(invoice))

    if request.method == "PUT":
        data = request.json or {}
        new_number = (data.get("invoice_number") or "").strip()
        if new_number and new_number != invoice.invoice_number:
            exists = (
                db.session.query(Invoice.id)
                .filter(Invoice.invoice_number == new_number)
                .filter(Invoice.id != invoice.id)
                .first()
            )
            if exists:
                return jsonify({"error": "Invoice number already exists"}), 409
            invoice.invoice_number = new_number

        merged = {**data}
        if "vat_applies" not in merged:
            merged["vat_applies"] = invoice.vat_applies
        if (
            merged.get("vat_applies")
            and merged.get("vat_rate_percent") is None
            and invoice.vat_rate_percent is not None
        ):
            merged["vat_rate_percent"] = invoice.vat_rate_percent

        vat_applies, vat_rate, vat_err = _parse_vat_from_payload(merged)
        if vat_err:
            return jsonify({"error": vat_err}), 400
        invoice.vat_applies = vat_applies
        invoice.vat_rate_percent = vat_rate if vat_applies else None

        InvoiceItem.query.filter_by(invoice_id=invoice.id).delete()

        items_buffer = []
        for item_data in data.get("items", []):
            item = InvoiceItem(
                description=item_data["description"],
                amount=float(item_data["amount"]),
                invoice_id=invoice.id,
            )
            items_buffer.append(item)
            db.session.add(item)

        net = _net_subtotal_from_items(
            [{"amount": i.amount, "description": i.description} for i in items_buffer]
        )
        vat_amt, gross = _vat_amount_and_total(net, vat_applies, vat_rate)
        invoice.vat_amount = vat_amt if vat_applies else 0.0
        invoice.total_amount = gross
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

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if len(message) > 4000:
        message = message[:4000]

    try:
        import resend

        resend.api_key = api_key
        logo_url = request.url_root.rstrip("/") + url_for("static", filename="logo.png")
        html = render_template(
            "email_invoice.html",
            invoice=invoice,
            message=message or None,
            logo_url=logo_url,
            subtotal_net=_net_subtotal_from_items(invoice.items),
        )
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


@app.route("/api/invoices/<int:invoice_id>/duplicate", methods=["POST"])
def duplicate_invoice(invoice_id):
    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"success": False, "error": "Invoice not found"}), 404

    client = invoice.client
    if not client:
        return jsonify({"success": False, "error": "Client not found"}), 404

    vat_applies = bool(invoice.vat_applies)
    vat_rate = invoice.vat_rate_percent if vat_applies else None

    new_invoice = Invoice(
        invoice_number=generate_invoice_number(client),
        client_id=client.id,
        date=datetime.utcnow(),
        paid=False,
        vat_applies=vat_applies,
        vat_rate_percent=vat_rate if vat_applies else None,
    )

    for item in invoice.items:
        new_item = InvoiceItem(description=item.description, amount=float(item.amount))
        new_invoice.items.append(new_item)

    net = _net_subtotal_from_items(new_invoice.items)
    vat_amt, gross = _vat_amount_and_total(net, vat_applies, vat_rate)
    new_invoice.vat_amount = vat_amt if vat_applies else 0.0
    new_invoice.total_amount = gross
    db.session.add(new_invoice)
    db.session.commit()

    return jsonify(
        {
            "success": True,
            "id": new_invoice.id,
            "invoice_number": new_invoice.invoice_number,
            "client_name": client.name,
        }
    )


# Ensure tables exist (Railway runs gunicorn, not run.py — create_all is idempotent)
with app.app_context():
    db.create_all()
    _ensure_invoice_vat_columns()
    _bootstrap_auth_user()


if __name__ == "__main__":
    app.run(debug=True)
