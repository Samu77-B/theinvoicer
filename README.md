# Invoice software

Flask app for clients, line-item invoices, preview/print, and email delivery via [Resend](https://resend.com).

## Local development

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env   # optional: set RESEND_* to test email
python run.py
```

Open http://localhost:3000 (or the port shown in the terminal).

Without `DATABASE_URL`, the app uses **SQLite** at `instance/invoices.db`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | Production | Session / signing secret |
| `DATABASE_URL` | Railway (recommended) | PostgreSQL URL from Railway (see below) |
| `FLASK_DEBUG` | No | `true` for local debug |
| `DATA_DIR` | No | Optional: put the `invoices/` folder on a volume path |
| `RESEND_API_KEY` | To send email | From Resend dashboard |
| `RESEND_FROM_EMAIL` | To send email | Must be allowed by Resend |
| `PORT` | Railway | Set automatically by Railway |

## Deploy on Railway (simple database setup)

1. Deploy this repo from GitHub.
2. In the same Railway project, click **New** → **Database** → **PostgreSQL**. Wait until it is ready.
3. On your **web** service, open **Variables** → **Add variable** → **Reference** → choose **`DATABASE_URL`** from the Postgres service. Railway injects the connection string; you do not paste credentials by hand.
4. Set `SECRET_KEY`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`. Do not set `FLASK_DEBUG` in production (or set it to `false`).
5. Redeploy the web service. On startup the app runs `db.create_all()` so tables are created automatically.
6. Health check path: `/health`.

Optional: add a **Volume** and `DATA_DIR` only if you need **server-generated PDF files** to survive redeploys; the **database** itself lives in Railway Postgres, not on disk.

## API

- `GET/POST /api/clients` — JSON body for POST: `name`, `email`, `address` (optional)
- `GET/POST /api/invoices` — POST: `client_id`, `items: [{ description, amount }]`
- `GET/PUT/DELETE /api/invoices/<id>`
- `PUT /api/invoices/<id>/paid` — JSON `{ "paid": true|false }`
- `POST /api/invoices/<id>/send` — sends HTML invoice to the client email via Resend
