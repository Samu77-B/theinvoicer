import os
import sys

from dotenv import load_dotenv

load_dotenv()

from app import app, db


def init_db():
    try:
        with app.app_context():
            db.create_all()
            print("Database initialized successfully!")
    except Exception as e:
        print(f"Error initializing database: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    print("Initializing database...")
    init_db()

    port = int(os.environ.get("PORT", "3000"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    print(f"Starting server on http://127.0.0.1:{port} (debug={debug})...")
    try:
        app.run(debug=debug, port=port, host="127.0.0.1")
    except Exception as e:
        print(f"Error starting server: {e}", file=sys.stderr)
        sys.exit(1)
