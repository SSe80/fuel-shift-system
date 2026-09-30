from flask import Flask, jsonify, request, session
from workers import wsgi
import os, base64, hashlib, hmac, secrets
from supabase_rest import request as sb_request

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "change-me")


def env():
    return request.environ["workers.env"]


def sb(path, method="GET", params=None, body=None, prefer=None):
    e = env()
    return sb_request(e.SUPABASE_URL, e.SUPABASE_SECRET_KEY, method, path, params, body, prefer)


def hash_pin(pin, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 120000)
    return "pbkdf2_sha256$120000$%s$%s" % (
        base64.urlsafe_b64encode(salt).decode().rstrip("="),
        base64.urlsafe_b64encode(digest).decode().rstrip("="),
    )


def verify_pin(pin, stored):
    try:
        algo, rounds, salt_s, digest_s = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_s + "==")
        expected = base64.urlsafe_b64decode(digest_s + "==")
        actual = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "fuel-shift", "database": "supabase"})


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    phone = str(data.get("phone", "")).strip()
    pin = str(data.get("pin", ""))
    if not phone or not pin:
        return jsonify({"error": "Phone and PIN are required"}), 400
    status, rows = sb("employees", params={"phone": "eq." + phone, "active": "eq.true", "select": "id,name,phone,role,pin_hash,active"})
    if status != 200 or not isinstance(rows, list) or not rows:
        return jsonify({"error": "Invalid credentials"}), 401
    emp = rows[0]
    if not verify_pin(pin, emp.get("pin_hash", "")):
        return jsonify({"error": "Invalid credentials"}), 401
    session["employee_id"] = emp["id"]
    session["role"] = emp["role"]
    return jsonify({"id": emp["id"], "name": emp["name"], "phone": emp["phone"], "role": emp["role"]})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    eid = session.get("employee_id")
    if not eid:
        return jsonify({"authenticated": False}), 401
    status, rows = sb("employees", params={"id": "eq." + eid, "select": "id,name,phone,role,active"})
    if status != 200 or not rows:
        session.clear()
        return jsonify({"authenticated": False}), 401
    return jsonify({"authenticated": True, "employee": rows[0]})


@app.post("/api/bootstrap-admin")
def bootstrap_admin():
    e = env()
    token = request.headers.get("X-Bootstrap-Token", "")
    if not token or token != getattr(e, "BOOTSTRAP_TOKEN", ""):
        return jsonify({"error": "Forbidden"}), 403
    existing_status, existing_rows = sb("employees", params={"select": "id", "limit": "1"})
    if existing_status != 200:
        return jsonify({"error": "Unable to verify initial setup state"}), 503
    if existing_rows:
        return jsonify({"error": "Initial admin has already been created"}), 409
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    pin = str(data.get("pin", ""))
    if not name or not phone or not pin or len(pin) < 4:
        return jsonify({"error": "name, phone and a PIN of at least 4 digits are required"}), 400
    body = {"name": name, "phone": phone, "role": "admin", "pin_hash": hash_pin(pin), "active": True}
    status, result = sb("employees", method="POST", body=body, prefer="return=representation")
    if status >= 400:
        return jsonify({"error": result}), status
    return jsonify(result), 201


@app.get("/api/tanks")
def tanks():
    if not session.get("employee_id"):
        return jsonify({"error": "Unauthorized"}), 401
    status, rows = sb("tanks", params={"select": "id,tank_code,product,capacity_liters,current_mm,current_liters,updated_at", "order": "tank_code.asc"})
    return jsonify(rows), status


@app.get("/api/nozzles")
def nozzles():
    if not session.get("employee_id"):
        return jsonify({"error": "Unauthorized"}), 401
    status, rows = sb("nozzles", params={"active": "eq.true", "select": "id,nozzle_code,product,tank_id", "order": "nozzle_code.asc"})
    return jsonify(rows), status


@app.get("/api/shifts")
def shifts():
    eid = session.get("employee_id")
    if not eid:
        return jsonify({"error": "Unauthorized"}), 401
    params = {"select": "*", "order": "created_at.desc", "limit": "50"}
    if session.get("role") != "admin":
        params["employee_id"] = "eq." + eid
    status, rows = sb("shifts", params=params)
    return jsonify(rows), status


@app.post("/api/sales")
def create_sale():
    eid = session.get("employee_id")
    if not eid:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    product = str(data.get("product", "")).strip()
    try:
        quantity = float(data.get("quantity_liters", 0))
        unit_price = float(data.get("unit_price", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid quantity or price"}), 400
    if not product or quantity <= 0 or unit_price < 0:
        return jsonify({"error": "Product, positive quantity and valid price are required"}), 400

    shift_status, shifts_rows = sb("shifts", params={
        "employee_id": "eq." + eid,
        "status": "eq.active",
        "select": "id,nozzle_id",
        "order": "created_at.desc",
        "limit": "1",
    })
    if shift_status != 200 or not shifts_rows:
        return jsonify({"error": "No active shift assigned to this employee"}), 409

    shift = shifts_rows[0]
    body = {
        "shift_id": shift["id"],
        "employee_id": eid,
        "nozzle_id": shift.get("nozzle_id"),
        "product": product,
        "quantity_liters": quantity,
        "unit_price": unit_price,
        "amount": quantity * unit_price,
        "payment_method": str(data.get("payment_method", "cash")),
    }
    status, result = sb("sales", method="POST", body=body, prefer="return=representation")
    if status >= 400:
        return jsonify({"error": result}), status
    return jsonify(result), 201


@app.get("/api/sales")
def sales():
    if not session.get("employee_id"):
        return jsonify({"error": "Unauthorized"}), 401
    status, rows = sb("sales", params={"select": "*", "order": "sale_time.desc", "limit": "100"})
    return jsonify(rows), status


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def frontend(path=""):
    assets = request.environ["workers.env"].ASSETS
    from pyodide.ffi import run_sync
    from flask import Response
    r = run_sync(assets.fetch("https://assets.local/" + path))
    body = run_sync(r.bytes())
    return Response(body, status=r.status, headers=r.headers)


Default = wsgi.entrypoint(app)
