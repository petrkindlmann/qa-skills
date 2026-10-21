#!/usr/bin/env python3
"""Loopback-only Shop fixture: real HTTP, SQLite transactions and local SMTP.

This is a synthetic QA application, not a payment provider or production service.
See ../fixture-app-contract.md for the public behavior under test.
"""

import argparse
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import hashlib
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import html
import json
import os
from pathlib import Path
import re
import time
import secrets
import signal
import smtplib
import sqlite3
import sys
import threading
import time
from urllib.parse import urlsplit
import uuid

from faults import Faults

CATALOG = {
    "TEA-50": {"sku": "TEA-50", "name": "Mountain tea 50 g", "unit_amount": 1200},
    "CUP-01": {"sku": "CUP-01", "name": "Tea cup", "unit_amount": 1800},
}
PAYMENT_SECRET = b"local-payment-secret"
ADMIN_KEY = "local-test-admin"
LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW = 60


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 60000).hex()
    return f"{salt}:{digest}"


def password_matches(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(":", 1)[0]), stored)


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


class HTTPProblem(Exception):
    def __init__(self, status, code, headers=None):
        self.status, self.code, self.headers = status, code, headers or {}


class Runtime:
    def __init__(self, args):
        self.db_path = Path(args.db).resolve()
        self.smtp_port = args.smtp_port
        self.test_mode = args.test_mode
        self.email_suffix = args.email_suffix.lower()
        self.faults = Faults()
        self.catalog = {sku: dict(product) for sku, product in CATALOG.items()}
        if self.faults.has("compensating_prices"):
            self.catalog["TEA-50"]["unit_amount"] = 1500
            self.catalog["CUP-01"]["unit_amount"] = 1200
        self.fail_once = args.fail_fulfillment_once
        self.fail_lock = threading.Lock()
        self.base_url = None
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # Fixture fault: a migration that dropped the idempotency constraint.
        idempotency = "" if self.faults.has("missing_idempotency_index") else ", UNIQUE(user_id, idem_key)"
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(f"""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    idem_key TEXT NOT NULL, intent_hash TEXT NOT NULL, items TEXT NOT NULL,
                    currency TEXT NOT NULL, amount INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending', fulfillment_count INTEGER NOT NULL DEFAULT 0,
                    created REAL NOT NULL{idempotency});
                CREATE TABLE IF NOT EXISTS receipts (
                    id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL,
                    order_id TEXT NOT NULL REFERENCES orders(id), created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS reset_tokens (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    expires REAL NOT NULL, consumed REAL);
                CREATE TABLE IF NOT EXISTS login_attempts (email TEXT NOT NULL, attempted REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            db.execute("INSERT OR IGNORE INTO metadata VALUES ('clock_offset', '0')")
            db.execute("INSERT OR IGNORE INTO metadata VALUES ('smtp_errors', '0')")
            for user_id, email, password in [
                ("alice", "alice@example.test", "Alice-secret-123!"),
                ("bob", "bob@example.test", "Bob-secret-456!"),
            ]:
                if self.email_suffix:
                    email = f"{user_id}+{self.email_suffix}@example.test"
                if not db.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
                    db.execute("INSERT INTO users VALUES (?, ?, ?)",
                               (user_id, email, password_hash(password)))
            db.commit()

    @contextmanager
    def connection(self, transaction=False):
        db = sqlite3.connect(self.db_path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            if transaction:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if db.in_transaction:
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()

    def now(self, db):
        offset = db.execute("SELECT value FROM metadata WHERE key='clock_offset'").fetchone()[0]
        return time.time() + float(offset)

    def session_key(self, token):
        # Fixture fault: a session table that stores the raw bearer value.
        return token if self.faults.has("plaintext_session_tokens") else digest(token)

    def page(self):
        data = Path(__file__).with_name("index.html").read_bytes()
        if self.faults.has("unlabeled_controls"):
            # Fixture fault: visible captions that no longer label their inputs.
            data, replaced = re.subn(rb"<label>(Email|Password|Account email|New password) (<input[^>]*>)</label>",
                                     rb"<span>\1</span> \2", data)
            if replaced != 4:
                raise RuntimeError("unlabeled_controls no longer matches the four labelled inputs")
        if self.faults.has("wrong_currency_event"):
            # Fixture fault: the purchase event reports a hard-coded currency.
            data, replaced = re.subn(rb"currency: result\.order\.currency", rb"currency: 'USD'", data)
            if replaced != 1:
                raise RuntimeError("wrong_currency_event no longer matches the purchase event")
        return data

    def consume_transient_failure(self):
        with self.fail_lock:
            fail = self.fail_once
            self.fail_once = False
            return fail

    def send_reset(self, email, token):
        link = f"{self.base_url}/reset-password?token={token}"
        message = EmailMessage()
        message["From"] = "Shop <no-reply@shop.example.test>"
        message["To"] = email
        message["Subject"] = "Reset your Shop password"
        message["Date"] = formatdate(localtime=False)
        message["Message-ID"] = make_msgid(domain="shop.example.test")
        message.set_content(f"Use this link to reset your Shop password:\n\n{link}\n\n"
                            "This link expires in five minutes and can be used once.\n")
        message.add_alternative(
            f'<p>Reset your Shop password.</p><p><a href="{html.escape(link, quote=True)}">'
            'Reset password</a></p><p>This link expires in five minutes and can be used once.</p>',
            subtype="html")
        if self.faults.has("reset_email_dropped"):
            # Fixture fault: the message never reaches SMTP while the endpoint still answers 202.
            print(json.dumps({"event": "reset_email_dropped"}), file=sys.stderr, flush=True)
            return
        try:
            with smtplib.SMTP("127.0.0.1", self.smtp_port, timeout=5) as smtp:
                smtp.send_message(message)
        except (OSError, smtplib.SMTPException) as error:
            with self.connection(transaction=True) as db:
                db.execute("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='smtp_errors'")
            print(json.dumps({"event": "smtp_error", "error": type(error).__name__}),
                  file=sys.stderr, flush=True)
            if self.faults.has("smtp_failure_503"):
                # Fixture fault: a mail outage turns the uniform 202 into an error for real accounts.
                raise HTTPProblem(503, "email_unavailable")


class ShopServer(ThreadingHTTPServer):
    # The default listen backlog of 5 makes macOS reset new connections when a test sends
    # a burst of concurrent requests; the contract promises concurrent handling.
    request_queue_size = 128


def public_order(row):
    return {key: row[key] for key in ("id", "user_id", "currency", "amount", "status", "fulfillment_count")} | {
        "items": json.loads(row["items"])}


def order_intent(body):
    items = body.get("items")
    currency = body.get("currency")
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        raise HTTPProblem(400, "invalid_order")
    if not isinstance(items, list) or not items or len(items) > len(CATALOG):
        raise HTTPProblem(400, "invalid_order")
    normalized, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            raise HTTPProblem(400, "invalid_order")
        sku, quantity = item.get("sku"), item.get("quantity")
        if not isinstance(sku, str) or sku not in CATALOG or sku in seen:
            raise HTTPProblem(400, "invalid_order")
        if type(quantity) is not int or not 1 <= quantity <= 10:
            raise HTTPProblem(400, "invalid_order")
        seen.add(sku)
        normalized.append({"sku": sku, "quantity": quantity})
    normalized.sort(key=lambda item: item["sku"])
    intent = {"currency": currency, "items": normalized}
    return intent, digest(json.dumps(intent, sort_keys=True, separators=(",", ":")))


class Handler(BaseHTTPRequestHandler):
    server_version = "ShopWorkflowFixture/1"
    protocol_version = "HTTP/1.1"

    @property
    def app(self):
        return self.server.app

    def log_request(self, code="-", size="-"):
        print(json.dumps({"method": self.command, "path": urlsplit(self.path).path,
                          "status": code}), file=sys.stderr, flush=True)

    def respond(self, status, payload=None, headers=None):
        data = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if self.close_connection:
            self.send_header("Connection", "close")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def read_raw(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise HTTPProblem(400, "invalid_json")
        if not 0 < length <= 65536:
            raise HTTPProblem(400, "invalid_json")
        if self.headers.get_content_type() != "application/json":
            raise HTTPProblem(415, "unsupported_media_type")
        return self.rfile.read(length)

    def parse_json(self, raw):
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise HTTPProblem(400, "invalid_json")
        if not isinstance(value, dict):
            raise HTTPProblem(400, "invalid_json")
        return value, raw

    def read_json(self):
        return self.parse_json(self.read_raw())

    def session_token(self):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            return ""
        return jar["shop_session"].value if "shop_session" in jar else ""

    def user(self, db):
        row = db.execute("SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id "
                         "WHERE token_hash=? AND expires>?", (self.app.session_key(self.session_token()), self.app.now(db))).fetchone()
        if row is None:
            raise HTTPProblem(401, "unauthenticated")
        return row

    def admin(self):
        if self.app.faults.has("open_test_support"):
            return  # Fixture fault: support routes shipped without any check.
        if not self.app.test_mode:
            raise HTTPProblem(404, "not_found")
        if not hmac.compare_digest(self.headers.get("X-Test-Admin-Key", ""), ADMIN_KEY):
            raise HTTPProblem(403, "forbidden")

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def dispatch(self, method):
        try:
            self.route(method, urlsplit(self.path).path)
        except HTTPProblem as error:
            self.close_connection = True
            self.respond(error.status, {"error": error.code}, error.headers)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self.close_connection = True
            print(json.dumps({"event": "request_error", "error": type(error).__name__,
                              "detail": str(error)}), file=sys.stderr, flush=True)
            self.respond(500, {"error": "internal_error"})

    def route(self, method, path):
        if method == "GET" and path in {"/", "/reset-password"}:
            data = self.app.page()
            self.send_response(200)
            for name, value in {"Content-Type": "text/html; charset=utf-8",
                                "Content-Length": str(len(data)), "Cache-Control": "no-store",
                                "Referrer-Policy": "no-referrer"}.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)
            return
        if method == "GET" and path == "/health":
            if self.app.faults.has("slow_health"):
                time.sleep(2.5)  # Fixture fault: the probe target answers, but far outside its budget.
            return self.respond(200, {"status": "ok", "build": "shop-lab-v1"})
        if method == "GET" and path == "/api/catalog":
            if self.app.faults.has("catalog_currency_missing"):
                # Fixture fault: the catalogue response drops its top-level currency field.
                return self.respond(200, {"products": list(self.app.catalog.values())})
            return self.respond(200, {"currency": "EUR", "products": list(self.app.catalog.values())})
        if method == "POST" and path == "/api/login":
            body, _ = self.read_json()
            email, password = body.get("email"), body.get("password")
            if not isinstance(email, str) or not isinstance(password, str):
                raise HTTPProblem(401, "invalid_credentials")
            account = email.lower()
            with self.app.connection(transaction=True) as db:
                now = self.app.now(db)
                db.execute("DELETE FROM login_attempts WHERE attempted<=?", (now - LOGIN_FAILURE_WINDOW,))
                failures = db.execute("SELECT COUNT(*) FROM login_attempts WHERE email=?", (account,)).fetchone()[0]
                if failures >= LOGIN_FAILURE_LIMIT and not self.app.faults.has("no_login_throttle"):
                    raise HTTPProblem(429, "too_many_attempts", {"Retry-After": str(LOGIN_FAILURE_WINDOW)})
                row = db.execute("SELECT * FROM users WHERE email=?", (account,)).fetchone()
                accepted = row is not None and password_matches(password, row["password"])
                if accepted:
                    db.execute("DELETE FROM login_attempts WHERE email=?", (account,))
                    token = secrets.token_urlsafe(32)
                    db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                               (self.app.session_key(token), row["id"], now + 86400))
                else:
                    # The failure must commit before the rejection leaves this transaction.
                    db.execute("INSERT INTO login_attempts VALUES (?, ?)", (account, now))
            if not accepted:
                raise HTTPProblem(401, "invalid_credentials")
            return self.respond(200, {"user": {"id": row["id"], "email": row["email"]}}, {
                "Set-Cookie": f"shop_session={token}; HttpOnly; SameSite=Lax; Path=/"})
        if method == "POST" and path == "/api/logout":
            if not self.app.faults.has("logout_cookie_only"):
                with self.app.connection(transaction=True) as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (self.app.session_key(self.session_token()),))
            return self.respond(204, headers={
                "Set-Cookie": "shop_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})
        if method == "GET" and path == "/api/me":
            with self.app.connection() as db:
                row = self.user(db)
                return self.respond(200, {"user": {"id": row["id"], "email": row["email"]}})
        if method == "POST" and path == "/api/orders":
            return self.create_order()
        if method == "GET" and (path == "/api/orders" or path.startswith("/api/orders/")):
            with self.app.connection() as db:
                user = self.user(db)
                if path == "/api/orders":
                    rows = db.execute("SELECT * FROM orders WHERE user_id=? ORDER BY created,id", (user["id"],)).fetchall()
                    return self.respond(200, {"orders": [public_order(row) for row in rows]})
                row = db.execute("SELECT * FROM orders WHERE id=?", (path.removeprefix("/api/orders/"),)).fetchone()
                if row is None or (row["user_id"] != user["id"] and not self.app.faults.has("cross_user_order_read")):
                    raise HTTPProblem(404, "not_found")
                return self.respond(200, {"order": public_order(row)})
        if method == "POST" and path == "/api/webhooks/payment":
            return self.payment_event()
        if method == "POST" and path == "/api/password-reset/request":
            return self.request_reset()
        if method == "POST" and path == "/api/password-reset/confirm":
            return self.confirm_reset()
        if path.startswith("/test-support/"):
            return self.test_support(method, path)
        raise HTTPProblem(404, "not_found")

    def create_order(self):
        with self.app.connection() as db:
            self.user(db)
        body, _ = self.read_json()
        with self.app.connection(transaction=True) as db:
            user = self.user(db)
            key = self.headers.get("Idempotency-Key", "")
            if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", key):
                raise HTTPProblem(400, "invalid_idempotency_key")
            intent, intent_hash = order_intent(body)
            prior = db.execute("SELECT * FROM orders WHERE user_id=? AND idem_key=?", (user["id"], key)).fetchone()
            if prior:
                if prior["intent_hash"] != intent_hash and not self.app.faults.has("idempotency_payload_conflict"):
                    raise HTTPProblem(409, "idempotency_conflict")
                order, replayed, status = public_order(prior), True, 200
            else:
                if intent["currency"] != "EUR":
                    raise HTTPProblem(400, "invalid_order")
                amount = sum(self.app.catalog[item["sku"]]["unit_amount"] * item["quantity"] for item in intent["items"])
                if self.app.faults.has("trust_client_amount") and type(body.get("amount")) is int:
                    amount = body["amount"]
                order_id = str(uuid.uuid4())
                db.execute("INSERT INTO orders (id,user_id,idem_key,intent_hash,items,currency,amount,created) "
                           "VALUES (?,?,?,?,?,?,?,?)", (order_id, user["id"], key, intent_hash,
                           json.dumps(intent["items"]), intent["currency"], amount, self.app.now(db)))
                order = public_order(db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone())
                replayed, status = False, 201
        return self.respond(status, {"order": order, "replayed": replayed})

    def payment_event(self):
        supplied = self.headers.get("X-Test-Payment-Signature", "")
        if not re.fullmatch(r"sha256=[0-9a-f]{64}", supplied):
            raise HTTPProblem(401, "invalid_signature")
        raw = self.read_raw()
        signature_bytes = raw
        if self.app.faults.has("canonicalized_signature"):
            parsed, _ = self.parse_json(raw)
            signature_bytes = json.dumps(parsed, separators=(",", ":")).encode()
        expected = "sha256=" + hmac.new(PAYMENT_SECRET, signature_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(supplied, expected):
            raise HTTPProblem(401, "invalid_signature")
        body, _ = self.parse_json(raw)
        event_id, data = body.get("id"), body.get("data")
        if not isinstance(event_id, str) or not 1 <= len(event_id) <= 128 or body.get("type") != "payment.succeeded":
            raise HTTPProblem(400, "invalid_event")
        if not isinstance(data, dict) or not isinstance(data.get("order_id"), str) or type(data.get("amount")) is not int:
            raise HTTPProblem(400, "invalid_event")
        with self.app.connection(transaction=True) as db:
            prior = db.execute("SELECT * FROM receipts WHERE id=?", (event_id,)).fetchone()
            if prior:
                if prior["payload_hash"] != digest(raw):
                    raise HTTPProblem(409, "event_conflict")
                if self.app.faults.has("duplicate_fulfillment"):
                    db.execute("UPDATE orders SET fulfillment_count=fulfillment_count+1 WHERE id=?", (prior["order_id"],))
                order_id, duplicate = prior["order_id"], True
            else:
                row = db.execute("SELECT * FROM orders WHERE id=?", (data["order_id"],)).fetchone()
                if row is None:
                    raise HTTPProblem(404, "not_found")
                if data["amount"] != row["amount"] or data.get("currency") != row["currency"]:
                    raise HTTPProblem(422, "payment_mismatch")
                db.execute("INSERT INTO receipts VALUES (?, ?, ?, ?)",
                           (event_id, digest(raw), row["id"], self.app.now(db)))
                if self.app.faults.has("receipt_before_commit"):
                    db.commit()
                    db.execute("BEGIN IMMEDIATE")
                if self.app.consume_transient_failure():
                    raise HTTPProblem(503, "fulfillment_unavailable")
                if row["status"] != "paid" or self.app.faults.has("duplicate_fulfillment"):
                    db.execute("UPDATE orders SET status='paid',fulfillment_count=fulfillment_count+1 WHERE id=?", (row["id"],))
                order_id, duplicate = row["id"], False
        return self.respond(200, {"received": True, "duplicate": duplicate, "order_id": order_id})

    def request_reset(self):
        body, _ = self.read_json()
        email = body.get("email")
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPProblem(400, "invalid_email")
        with self.app.connection(transaction=True) as db:
            user = db.execute("SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
            token = secrets.token_urlsafe(32) if user else None
            if user:
                db.execute("INSERT INTO reset_tokens VALUES (?, ?, ?, NULL)",
                           (digest(token), user["id"], self.app.now(db) + 300))
        if token:
            self.app.send_reset(user["email"], token)
        return self.respond(202, {"message": "If this account exists, a reset email has been sent."})

    def confirm_reset(self):
        body, _ = self.read_json()
        token, password = body.get("token"), body.get("password")
        if not isinstance(password, str) or not 12 <= len(password) <= 1024:
            raise HTTPProblem(400, "invalid_password")
        if not isinstance(token, str):
            raise HTTPProblem(400, "invalid_or_expired_token")
        with self.app.connection(transaction=True) as db:
            row = db.execute("SELECT * FROM reset_tokens WHERE token_hash=?", (digest(token),)).fetchone()
            if row is None or row["expires"] <= self.app.now(db) or (row["consumed"] is not None and not self.app.faults.has("reusable_reset_token")):
                raise HTTPProblem(400, "invalid_or_expired_token")
            db.execute("UPDATE users SET password=? WHERE id=?", (password_hash(password), row["user_id"]))
            if not self.app.faults.has("reusable_reset_token"):
                db.execute("UPDATE reset_tokens SET consumed=? WHERE token_hash=?", (self.app.now(db), digest(token)))
            db.execute("DELETE FROM sessions WHERE user_id=?", (row["user_id"],))
        return self.respond(200, {"reset": True})

    def test_support(self, method, path):
        self.admin()
        if method == "GET" and path == "/test-support/state":
            with self.app.connection() as db:
                db.execute("BEGIN")
                state = {
                    "now": self.app.now(db),
                    "orders": [public_order(row) for row in db.execute("SELECT * FROM orders ORDER BY created,id")],
                    "receipts": [dict(row) for row in db.execute("SELECT id,order_id,created FROM receipts ORDER BY created,id")],
                    "reset_tokens": [dict(row) for row in db.execute("SELECT user_id,expires,consumed FROM reset_tokens ORDER BY expires")],
                    "sessions": {row["user_id"]: row["count"] for row in db.execute("SELECT user_id,COUNT(*) AS count FROM sessions GROUP BY user_id")},
                    "smtp_errors": int(db.execute("SELECT value FROM metadata WHERE key='smtp_errors'").fetchone()[0]),
                }
            return self.respond(200, state)
        if method == "POST" and path == "/test-support/clock":
            body, _ = self.read_json()
            advance = body.get("advance_seconds")
            if type(advance) is not int or not 0 <= advance <= 31536000:
                raise HTTPProblem(400, "invalid_clock_advance")
            with self.app.connection(transaction=True) as db:
                db.execute("UPDATE metadata SET value=CAST(value AS INTEGER)+? WHERE key='clock_offset'", (advance,))
                now = self.app.now(db)
            return self.respond(200, {"now": now})
        raise HTTPProblem(404, "not_found")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--db", required=True)
    parser.add_argument("--ready-file", required=True)
    parser.add_argument("--smtp-port", type=int, default=int(os.environ.get("MAILPIT_SMTP_PORT", "1025")))
    parser.add_argument("--test-mode", action="store_true")
    parser.add_argument("--email-suffix", default="")
    parser.add_argument("--fail-fulfillment-once", action="store_true")
    args = parser.parse_args()
    if args.email_suffix and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", args.email_suffix):
        parser.error("--email-suffix must contain 1–64 ASCII letters, digits, underscores or hyphens")
    runtime = Runtime(args)
    server = ShopServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    server.app = runtime
    runtime.base_url = f"http://127.0.0.1:{server.server_port}"
    ready = Path(args.ready_file)
    ready.parent.mkdir(parents=True, exist_ok=True)
    temporary = ready.with_suffix(ready.suffix + ".tmp")
    with runtime.connection() as db:
        seeded_users = [dict(row) for row in db.execute("SELECT id,email FROM users ORDER BY id")]
    temporary.write_text(json.dumps({"base_url": runtime.base_url, "pid": os.getpid(),
                                    "build": "shop-lab-v1", "seeded_users": seeded_users}) + "\n")
    temporary.replace(ready)
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
