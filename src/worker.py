from flask import Flask, jsonify, request, session
from workers import wsgi
import os, base64, hashlib, hmac, secrets
from pyodide.ffi import run_sync, to_js
from js import crypto, Uint8Array, Object
from supabase_rest import request as sb_request

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "change-me")


def env():
    return request.environ["workers.env"]


def sb(path, method="GET", params=None, body=None, prefer=None):
    e = env()
    return sb_request(e.SUPABASE_URL, e.SUPABASE_SECRET_KEY, method, path, params, body, prefer)


async def _webcrypto_pbkdf2(password, salt, iterations, dklen):
    password_js = to_js(password)
    salt_js = to_js(salt)
    key = await crypto.subtle.importKey(
        "raw",
        password_js,
        Object.fromEntries([("name", "PBKDF2")]),
        False,
        to_js(["deriveBits"]),
    )
    derived = await crypto.subtle.deriveBits(
        Object.fromEntries([
            ("name", "PBKDF2"),
            ("salt", salt_js),
            ("iterations", iterations),
            ("hash", "SHA-256"),
        ]),
        key,
        dklen * 8,
    )
    return bytes(Uint8Array.new(derived).to_py())


def pbkdf2_sha256(password, salt, iterations, dklen=32):
    password = password.encode() if isinstance(password, str) else password
    return run_sync(_webcrypto_pbkdf2(password, salt, iterations, dklen))


def hash_pin(pin, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = pbkdf2_sha256(pin, salt, 100000)
    return "pbkdf2_sha256$100000$%s$%s" % (
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
        actual = pbkdf2_sha256(pin, salt, int(rounds), len(expected))
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
    try:
        e = env()
        token = request.headers.get("X-Bootstrap-Token", "")
        expected_token = getattr(e, "BOOTSTRAP_TOKEN", "")
        if not token or token != expected_token:
            return jsonify({"error": "Forbidden"}), 403
        existing_status, existing_rows = sb("employees", params={"select": "id", "limit": "1"})
        if existing_status != 200:
            return jsonify({"error": {"status": existing_status, "response": existing_rows}}), 503
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
            return jsonify({"error": {"status": status, "response": result}}), status
        return jsonify(result), 201
    except Exception as exc:
        return jsonify({"error": {"type": type(exc).__name__, "message": str(exc)}}), 500

def require_admin():
    if not session.get("employee_id"):
        return jsonify({"error": "Unauthorized"}), 401
    if session.get("role") != "admin":
        return jsonify({"error": "Admin access required"}), 403
    return None


@app.get("/api/employees")
def employees():
    auth = require_admin()
    if auth:
        return auth
    status, rows = sb("employees", params={
        "select": "id,name,phone,role,active,created_at",
        "order": "name.asc"
    })
    return jsonify(rows), status


@app.post("/api/employees")
def create_employee():
    auth = require_admin()
    if auth:
        return auth
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    pin = str(data.get("pin", ""))
    role = str(data.get("role", "employee")).strip()
    if role not in ("employee", "admin"):
        return jsonify({"error": "Invalid role"}), 400
    if not name or not phone or len(pin) < 4:
        return jsonify({"error": "Name, phone and PIN of at least 4 digits are required"}), 400
    body = {"name": name, "phone": phone, "role": role, "pin_hash": hash_pin(pin), "active": True}
    status, result = sb("employees", method="POST", body=body, prefer="return=representation")
    if status >= 400:
        return jsonify({"error": result}), status
    return jsonify(result), 201


@app.post("/api/tanks")
def create_tank():
    auth = require_admin()
    if auth:
        return auth
    data = request.get_json(silent=True) or {}
    code = str(data.get("tank_code", "")).strip()
    product = str(data.get("product", "")).strip()
    try:
        capacity = float(data.get("capacity_liters", 0))
        current = float(data.get("current_liters", 0))
        current_mm = float(data.get("current_mm", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid tank values"}), 400
    if not code or not product or capacity <= 0 or current < 0 or current > capacity:
        return jsonify({"error": "Tank code, product and valid capacity/current liters are required"}), 400
    body = {
        "tank_code": code,
        "product": product,
        "capacity_liters": capacity,
        "current_mm": current_mm,
        "current_liters": current,
    }
    status, result = sb("tanks", method="POST", body=body, prefer="return=representation")
    if status >= 400:
        return jsonify({"error": result}), status
    return jsonify(result), 201


@app.post("/api/nozzles")
def create_nozzle():
    auth = require_admin()
    if auth:
        return auth
    data = request.get_json(silent=True) or {}
    code = str(data.get("nozzle_code", "")).strip()
    product = str(data.get("product", "")).strip()
    tank_id = str(data.get("tank_id", "")).strip()
    if not code or not product or not tank_id:
        return jsonify({"error": "Nozzle code, product and tank are required"}), 400
    body = {"nozzle_code": code, "product": product, "tank_id": tank_id, "active": True}
    status, result = sb("nozzles", method="POST", body=body, prefer="return=representation")
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


@app.post("/api/shifts")
def create_shift():
    auth = require_admin()
    if auth:
        return auth
    data = request.get_json(silent=True) or {}
    employee_id = str(data.get("employee_id", "")).strip()
    nozzle_id = str(data.get("nozzle_id", "")).strip()
    if not employee_id or not nozzle_id:
        return jsonify({"error": "Employee and nozzle are required"}), 400
    emp_status, emp_rows = sb("employees", params={"id": "eq." + employee_id, "active": "eq.true", "select": "id"})
    if emp_status != 200 or not emp_rows:
        return jsonify({"error": "Active employee not found"}), 404
    nozzle_status, nozzle_rows = sb("nozzles", params={"id": "eq." + nozzle_id, "active": "eq.true", "select": "id"})
    if nozzle_status != 200 or not nozzle_rows:
        return jsonify({"error": "Active nozzle not found"}), 404
    active_status, active_rows = sb("shifts", params={
        "employee_id": "eq." + employee_id,
        "status": "in.(assigned,active)",
        "select": "id",
        "limit": "1"
    })
    if active_status != 200:
        return jsonify({"error": active_rows}), active_status
    if active_rows:
        return jsonify({"error": "Employee already has an assigned or active shift"}), 409
    body = {
        "employee_id": employee_id,
        "nozzle_id": nozzle_id,
        "status": "assigned",
        "assigned_by": session.get("employee_id")
    }
    status, result = sb("shifts", method="POST", body=body, prefer="return=representation")
    if status >= 400:
        return jsonify({"error": result}), status
    return jsonify(result), 201


@app.post("/api/shifts/<shift_id>/start")
def start_shift(shift_id):
    eid = session.get("employee_id")
    if not eid:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    try:
        opening_reading = float(data.get("opening_reading", 0))
        opening_mm = float(data.get("opening_mm", 0))
        opening_liters = float(data.get("opening_liters", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid opening readings"}), 400
    if opening_reading < 0 or opening_mm < 0 or opening_liters < 0:
        return jsonify({"error": "Opening readings cannot be negative"}), 400
    status, rows = sb("shifts", params={
        "id": "eq." + shift_id,
        "employee_id": "eq." + eid,
        "status": "eq.assigned",
        "select": "id"
    })
    if status != 200 or not rows:
        return jsonify({"error": "Assigned shift not found"}), 404
    patch = {
        "status": "active",
        "start_time": "now()",
        "opening_reading": opening_reading,
        "opening_mm": opening_mm,
        "opening_liters": opening_liters
    }
    status, result = sb("shifts", method="PATCH", params={"id": "eq." + shift_id}, body=patch, prefer="return=representation")
    if status >= 400:
        return jsonify({"error": result}), status
    return jsonify(result), 200


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
