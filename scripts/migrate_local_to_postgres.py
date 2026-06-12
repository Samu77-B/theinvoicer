"""One-off: copy clients/invoices from local SQLite to Railway Postgres.

Usage:
  1. In Railway, copy the Postgres DATABASE_URL into your local .env
  2. python scripts/migrate_local_to_postgres.py

Does not delete anything on either side; skips rows that already exist by id.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SQLITE_PATH = os.path.join(ROOT, "instance", "invoices.db")


def main() -> int:
    db_url = (os.environ.get("DATABASE_URL") or "").strip()
    if not db_url:
        print("Set DATABASE_URL in .env to your Railway Postgres URL first.", file=sys.stderr)
        return 1
    if not os.path.isfile(SQLITE_PATH):
        print(f"Local database not found: {SQLITE_PATH}", file=sys.stderr)
        return 1

    if db_url.startswith("postgres://"):
        db_url = "postgresql://" + db_url[len("postgres://") :]

    sys.path.insert(0, ROOT)
    from app import app, db, Client, Invoice, InvoiceItem  # noqa: E402
    from sqlalchemy import text

    src = sqlite3.connect(SQLITE_PATH)
    src.row_factory = sqlite3.Row

    with app.app_context():
        db.create_all()

        existing_clients = {c.id for c in Client.query.with_entities(Client.id).all()}
        existing_invoices = {i.id for i in Invoice.query.with_entities(Invoice.id).all()}

        clients = src.execute("SELECT id, name, email, address FROM client ORDER BY id").fetchall()
        invoices = src.execute(
            "SELECT id, invoice_number, date, client_id, total_amount, paid, "
            "vat_applies, vat_rate_percent, vat_amount FROM invoice ORDER BY id"
        ).fetchall()
        items = src.execute(
            "SELECT id, description, amount, invoice_id FROM invoice_item ORDER BY id"
        ).fetchall()

        added_clients = added_invoices = added_items = 0

        for row in clients:
            if row["id"] in existing_clients:
                continue
            db.session.add(
                Client(
                    id=row["id"],
                    name=row["name"],
                    email=row["email"],
                    address=row["address"] or "",
                )
            )
            added_clients += 1

        if added_clients:
            db.session.flush()

        for row in invoices:
            if row["id"] in existing_invoices:
                continue
            raw_date = row["date"]
            if isinstance(raw_date, str):
                parsed_date = datetime.fromisoformat(raw_date.split(".")[0])
            else:
                parsed_date = raw_date
            db.session.add(
                Invoice(
                    id=row["id"],
                    invoice_number=row["invoice_number"],
                    date=parsed_date,
                    client_id=row["client_id"],
                    total_amount=float(row["total_amount"] or 0),
                    paid=bool(row["paid"]),
                    vat_applies=bool(row["vat_applies"]) if row["vat_applies"] is not None else False,
                    vat_rate_percent=row["vat_rate_percent"],
                    vat_amount=float(row["vat_amount"] or 0),
                )
            )
            added_invoices += 1

        if added_invoices:
            db.session.flush()

        existing_items = {i.id for i in InvoiceItem.query.with_entities(InvoiceItem.id).all()}
        for row in items:
            if row["id"] in existing_items:
                continue
            db.session.add(
                InvoiceItem(
                    id=row["id"],
                    description=row["description"],
                    amount=float(row["amount"]),
                    invoice_id=row["invoice_id"],
                )
            )
            added_items += 1

        db.session.commit()

        if db.engine.dialect.name == "postgresql":
            for table, col in (
                ("client", "id"),
                ("invoice", "id"),
                ("invoice_item", "id"),
            ):
                db.session.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('{table}', '{col}'), "
                        f"COALESCE((SELECT MAX({col}) FROM {table}), 1))"
                    )
                )
            db.session.commit()

        print(
            f"Done. Added {added_clients} client(s), "
            f"{added_invoices} invoice(s), {added_items} line item(s) to Postgres."
        )
        print(f"Postgres now has {Client.query.count()} client(s) and {Invoice.query.count()} invoice(s).")

    src.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
