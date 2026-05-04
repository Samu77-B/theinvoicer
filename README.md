# Invoice software

Flask app for clients, line-item invoices, preview/print, and email delivery via [Resend](https://resend.com).

## Local development

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env   # then edit RESEND_* if testing email
python run.py
```

Open http://localhost:3000 (or the port shown in the terminal).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | Production | Session / signing secret |
| `FLASK_DEBUG` | No | `true` for local debug |
| `DATA_DIR` | No | Root folder for `instance/` and `invoices/` (use with a Railway volume) |
| `RESEND_API_KEY` | To send email | From Resend dashboard |
| `RESEND_FROM_EMAIL` | To send email | Must be allowed by Resend (e.g. `Name <you@yourdomain.com>`) |
| `PORT` | Railway | Set automatically by Railway |

## Deploy on Railway

1. Push this repo to GitHub and create a **New Project → Deploy from GitHub**.
2. **Variables**: set `SECRET_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. Unset or set `FLASK_DEBUG` to false for production.
3. **Persistent data (SQLite)**: add a **Volume**, mount it (e.g. `/data`), and set `DATA_DIR=/data` so the database and generated files survive redeploys.
4. Railway runs the **Procfile** `web` process (`gunicorn`). Health check path: `/health`.

## API

- `GET/POST /api/clients` — JSON body for POST: `name`, `email`, `address` (optional)
- `GET/POST /api/invoices` — POST: `client_id`, `items: [{ description, amount }]`
- `GET/PUT/DELETE /api/invoices/<id>`
- `PUT /api/invoices/<id>/paid` — JSON `{ "paid": true|false }`
- `POST /api/invoices/<id>/send` — sends HTML invoice to the client email via Resend
