from flask import Flask, jsonify, request, session
from workers import wsgi
import os, base64, hmac, secrets, hashlib, json
from datetime import datetime, timezone, date, timedelta
from pyodide.ffi import run_sync, to_js
from js import crypto, Uint8Array, Object
from supabase_rest import request as sb_request

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "change-me")
app.config.update(
    # Cloudflare terminates HTTPS before the Python runtime. Keep the
    # session cookie compatible with the Workers runtime while the site
    # itself remains HTTPS.
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_NAME="__Host-fuel_shift_session",
    SESSION_COOKIE_PATH="/",
    SESSION_COOKIE_MAX_AGE=60 * 60 * 24,
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24,
    SESSION_REFRESH_EACH_REQUEST=False,
)

@app.after_request
def security_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response

def env():
    return request.environ["workers.env"]

def sb(path, method="GET", params=None, body=None, prefer=None):
    e = env()
    return sb_request(e.SUPABASE_URL, e.SUPABASE_SECRET_KEY, method, path, params, body, prefer)

async def _webcrypto_pbkdf2(password, salt, iterations, dklen):
    key = await crypto.subtle.importKey(
        "raw", to_js(password), Object.fromEntries([("name", "PBKDF2")]),
        False, to_js(["deriveBits"])
    )
    derived = await crypto.subtle.deriveBits(
        Object.fromEntries([
            ("name", "PBKDF2"), ("salt", to_js(salt)),
            ("iterations", iterations), ("hash", "SHA-256")
        ]),
        key, dklen * 8
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
        base64.urlsafe_b64encode(digest).decode().rstrip("=")
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

def require_login():
    if not session.get("employee_id"):
        return jsonify({"error": "Unauthorized"}), 401
    return None

def require_admin():
    eid = session.get("employee_id")
    if not eid:
        return jsonify({"error": "Unauthorized"}), 401

    # Refresh the role from Supabase on every protected admin request.
    # This prevents a stale session role from incorrectly blocking an admin
    # after their account role was changed in Settings.
    status, rows = sb("employees", params={
        "id": "eq." + str(eid),
        "select": "id,role,active",
        "limit": "1"
    })
    if status != 200:
        return jsonify({"error": "Unable to verify the current session"}), 503
    if not rows or not rows[0].get("active"):
        session.clear()
        return jsonify({"error": "Unauthorized"}), 401

    session.permanent = True
    session["role"] = rows[0].get("role")
    if session["role"] != "admin":
        return jsonify({"error": "Admin access required"}), 403
    return None

def rpc(name, body):
    return sb("rpc/" + name, method="POST", body=body)

@app.get("/api/health")
def health():
    try:
        status, rows = sb("employees", params={"select":"id", "limit":"1"})
        if status != 200:
            return jsonify({
                "ok": False,
                "service": "fuel-shift",
                "database": "supabase",
                "database_ok": False,
                "database_status": status
            }), 503
        return jsonify({
            "ok": True,
            "service": "fuel-shift",
            "database": "supabase",
            "database_ok": True
        })
    except Exception as exc:
        return jsonify({
            "ok": False,
            "service": "fuel-shift",
            "database": "supabase",
            "database_ok": False,
            "error": type(exc).__name__
        }), 503

@app.get("/api/diagnostics")
def diagnostics():
    admin_error = require_admin()
    if admin_error:
        return admin_error
    checks = {}
    checks["session"] = {
        "authenticated": bool(session.get("employee_id")),
        "role": session.get("role")
    }
    endpoints = [
        ("me", "employees", {"id": "eq." + str(session.get("employee_id")),"select":"id,name,role,active"} if session.get("employee_id") else {"select":"id","limit":"1"}),
        ("products", "products", {"select":"id,name,active","limit":"5"}),
        ("tanks", "tanks", {"select":"id,tank_code,active","limit":"5"}),
        ("nozzles", "nozzles", {"select":"id,nozzle_code,active","limit":"5"}),
        ("shifts", "shifts", {"select":"id,status,employee_id","limit":"5"}),
        ("sales", "sales", {"select":"id,sale_time","limit":"5"}),
        ("purchases", "purchases", {"select":"id,purchase_date","limit":"5"}),
        ("handovers", "handovers", {"select":"id,status","limit":"5"}),
    ]
    for name, table, params in endpoints:
        try:
            status, rows = sb(table, params=params)
            checks[name] = {"status": status, "ok": status == 200, "rows": len(rows) if isinstance(rows, list) else None}
            if status != 200:
                checks[name]["error"] = rows
        except Exception as exc:
            checks[name] = {"status": 0, "ok": False, "error": type(exc).__name__}
    ok = all(v.get("ok") for v in checks.values() if isinstance(v, dict) and "ok" in v)
    return jsonify({"ok": ok, "checks": checks})

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    operator_id, pin = str(data.get("operator_id", "")).strip(), str(data.get("pin", ""))
    if not operator_id or not pin:
        return jsonify({"error": "Operator ID and PIN are required"}), 400
    status, rows = sb("employees", params={
        "operator_id": "eq." + operator_id, "active": "eq.true",
        "select": "id,name,phone,operator_id,role,pin_hash,active"
    })
    if status != 200 or not rows:
        return jsonify({"error": "Invalid credentials"}), 401
    emp = rows[0]
    if not verify_pin(pin, emp.get("pin_hash", "")):
        return jsonify({"error": "Invalid credentials"}), 401
    session.clear()
    session.permanent = True
    session["employee_id"], session["role"] = emp["id"], emp["role"]
    return jsonify({k: emp[k] for k in ("id","name","phone","operator_id","role")})

@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})

@app.get("/api/me")
def me():
    if not session.get("employee_id"):
        return jsonify({"authenticated": False}), 401
    status, rows = sb("employees", params={
        "id": "eq." + session["employee_id"],
        "select": "id,name,phone,operator_id,role,active"
    })
    if status != 200:
        return jsonify({"error": "Unable to verify the current session"}), 503
    if not rows or not rows[0].get("active"):
        session.clear()
        return jsonify({"authenticated": False}), 401
    session.permanent = True
    session["role"] = rows[0]["role"]
    return jsonify({"authenticated": True, "user": rows[0], "employee": rows[0]})

@app.post("/api/bootstrap-admin")
def bootstrap_admin():
    try:
        e = env()
        if not request.headers.get("X-Bootstrap-Token") or request.headers.get("X-Bootstrap-Token") != getattr(e, "BOOTSTRAP_TOKEN", ""):
            return jsonify({"error": "Forbidden"}), 403
        status, rows = sb("employees", params={"select": "id", "limit": "1"})
        if status != 200:
            return jsonify({"error": {"status": status, "response": rows}}), 503
        if rows:
            return jsonify({"error": "Initial admin has already been created"}), 409
        data = request.get_json(silent=True) or {}
        name, phone, pin = str(data.get("name","")).strip(), str(data.get("phone","")).strip(), str(data.get("pin",""))
        digits = "".join(ch for ch in phone if ch.isdigit())
        if not name or len(digits) < 6 or not pin or len(pin) < 4 or not pin.isdigit():
            return jsonify({"error": "Name, phone with at least 6 digits and a numeric PIN of at least 4 digits are required"}), 400
        operator_id = digits[-6:]
        status, result = sb("employees", method="POST", body={
            "name": name, "phone": phone, "operator_id": operator_id, "role": "admin",
            "pin_hash": hash_pin(pin), "active": True
        }, prefer="return=representation")
        if status >= 400:
            return jsonify({"error": {"status": status, "response": result}}), status
        return jsonify(result), 201
    except Exception as exc:
        return jsonify({"error": {"type": type(exc).__name__, "message": str(exc)}}), 500

@app.get("/api/users")
@app.get("/api/employees")
def employees():
    auth = require_login()
    if auth: return auth
    select = "id,name,phone,operator_id,role,active,created_at" if session.get("role") == "admin" else "id,name,phone,operator_id,role"
    params = {"select": select, "order": "created_at.asc"}
    if session.get("role") != "admin": params["active"] = "eq.true"
    status, rows = sb("employees", params=params)
    return jsonify(rows), status

@app.get("/api/handover-receivers")
def handover_receivers():
    auth=require_login()
    if auth:return auth
    eid=str(session.get("employee_id") or "")
    es,emps=sb("employees",params={
        "select":"id,name,phone,operator_id,role,active",
        "role":"eq.attendant",
        "active":"eq.true",
        "order":"name.asc"
    })
    if es!=200:return jsonify(emps),es
    return jsonify([e for e in emps if str(e.get("id"))!=eid]),200

@app.post("/api/users")
@app.post("/api/employees")
def create_employee():
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    name, phone, pin = str(data.get("name","")).strip(), str(data.get("phone","")).strip(), str(data.get("pin",""))
    role = str(data.get("role","attendant")).strip()
    digits = "".join(ch for ch in phone if ch.isdigit())
    if role not in ("attendant","admin") or not name or len(digits) < 6 or len(pin) < 4 or not pin.isdigit():
        return jsonify({"error":"Valid name, phone with at least 6 digits, role and numeric PIN are required"}), 400
    operator_id = digits[-6:]
    status, result = sb("employees", method="POST", body={
        "name":name,"phone":phone,"operator_id":operator_id,"role":role,"pin_hash":hash_pin(pin),"active":True
    }, prefer="return=representation")
    if status >= 400: return jsonify({"error":result}), status
    return jsonify(result), 201

@app.route("/api/users/<employee_id>", methods=["DELETE"])
def delete_employee(employee_id):
    auth=require_admin()
    if auth:return auth
    if employee_id == session.get("employee_id"):
        return jsonify({"error":"You cannot remove your own account"}),400
    ss,sr=sb("shifts",params={"employee_id":"eq."+employee_id,"status":"in.(assigned,active)","select":"id","limit":"1"})
    if ss!=200:return jsonify({"error":sr}),ss
    if sr:return jsonify({"error":"This user has an assigned or active shift"}),409
    status,result=sb("employees",method="DELETE",params={"id":"eq."+employee_id},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    if not result:return jsonify({"error":"User not found"}),404
    return jsonify({"ok":True}),200

@app.patch("/api/users/<employee_id>")
@app.patch("/api/employees/<employee_id>")
def update_employee(employee_id):
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    body = {}
    if "name" in data: body["name"] = str(data["name"]).strip()
    if "phone" in data:
        phone = str(data["phone"]).strip()
        digits = "".join(ch for ch in phone if ch.isdigit())
        if len(digits) < 6: return jsonify({"error":"Phone must contain at least 6 digits"}), 400
        body["phone"] = phone
        body["operator_id"] = digits[-6:]
    if "active" in data: body["active"] = bool(data["active"])
    if "role" in data:
        role = str(data["role"]).strip()
        if role not in ("attendant","admin"): return jsonify({"error":"Invalid role"}), 400
        if employee_id == session.get("employee_id") and role != "admin":
            return jsonify({"error":"You cannot remove your own admin role"}), 400
        body["role"] = role
    if data.get("pin"):
        pin = str(data["pin"])
        if len(pin) < 4 or not pin.isdigit(): return jsonify({"error":"PIN must contain at least 4 digits"}), 400
        body["pin_hash"] = hash_pin(pin)
    if not body: return jsonify({"error":"No changes supplied"}), 400
    if employee_id == session.get("employee_id") and body.get("active") is False:
        return jsonify({"error":"You cannot deactivate your own account"}), 400
    status, result = sb("employees", method="PATCH", params={"id":"eq."+employee_id}, body=body, prefer="return=representation")
    if status >= 400: return jsonify({"error":result}), status
    return jsonify(result), 200

@app.get("/api/sale-types")
@app.get("/api/sale-options")
def sale_types():
    auth=require_login()
    if auth:return auth
    status,result=rpc("list_active_sale_types",{"p_include_inactive":session.get("role")=="admin"})
    if status>=400:return jsonify(result),status
    return jsonify(result if isinstance(result,list) else []),200

@app.post("/api/sale-types")
def create_sale_type():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    name=str(data.get("name","")).strip()
    description=str(data.get("description","")).strip()
    reason_required=bool(data.get("reason_required",False))
    if not name:return jsonify({"error":"Sale name is required"}),400
    status,result=rpc("manage_sale_type",{"p_action":"create","p_name":name,"p_description":description,"p_reason_required":reason_required})
    if status>=400:return jsonify(result),status
    return jsonify(result),201

@app.patch("/api/sale-types/<sale_type_id>")
def update_sale_type(sale_type_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    status,result=rpc("manage_sale_type",{
        "p_action":"update","p_id":sale_type_id,
        "p_name":str(data.get("name","")).strip() if "name" in data else None,
        "p_description":str(data.get("description","")).strip() if "description" in data else None,
        "p_reason_required":bool(data.get("reason_required")) if "reason_required" in data else None,
        "p_active":bool(data.get("active")) if "active" in data else None
    })
    if status>=400:return jsonify(result),status
    return jsonify(result),200

@app.delete("/api/sale-types/<sale_type_id>")
def delete_sale_type(sale_type_id):
    auth=require_admin()
    if auth:return auth
    status,result=rpc("manage_sale_type",{"p_action":"delete","p_id":sale_type_id})
    if status>=400:return jsonify(result),status
    return jsonify(result),200

@app.get("/api/settings")
def get_settings():
    auth=require_login()
    if auth:return auth
    status,result=sb("station_settings",params={"id":"eq.true","select":"currency,item_orders,updated_at","limit":"1"})
    if status!=200:return jsonify(result),status
    if not result:
        return jsonify({"currency":"ETB","item_orders":{}}),200
    return jsonify(result[0]),200

@app.patch("/api/settings")
def update_settings():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    currency=str(data.get("currency","")).strip().upper()
    if not currency or len(currency)>10:
        return jsonify({"error":"Currency is required and must be 1-10 characters"}),400
    if not all(ch.isalnum() or ch in " _-₿$€£¥" for ch in currency):
        return jsonify({"error":"Currency contains unsupported characters"}),400
    status,result=sb("station_settings",method="PATCH",params={"id":"eq.true"},body={"currency":currency,"updated_at":datetime.now(timezone.utc).isoformat()},prefer="return=representation")
    if status>=400:return jsonify(result),status
    if not result:
        status,result=sb("station_settings",method="POST",body={"id":True,"currency":currency},prefer="return=representation")
        if status>=400:return jsonify(result),status
    return jsonify(result[0] if isinstance(result,list) else result),200


def _settings_order_ids(item_orders, key, records):
    requested=item_orders.get(key,[]) if isinstance(item_orders,dict) else []
    requested=[str(x) for x in requested if x]
    valid={str(x.get("id")) for x in records}
    ordered=[x for x in requested if x in valid]
    ordered.extend(str(x.get("id")) for x in records if str(x.get("id")) not in ordered)
    return ordered

@app.post("/api/settings/reorder")
def reorder_settings():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    key=str(data.get("key","")).strip()
    ids=data.get("ids")
    allowed={"products":"products","saleTypes":"sale_types","employees":"employees","tanks":"tanks","dispensers":"nozzles"}
    if key not in allowed or not isinstance(ids,list) or not ids:
        return jsonify({"error":"A valid settings section and ordered item list are required"}),400

    ss,settings=sb("station_settings",params={"id":"eq.true","select":"item_orders","limit":"1"})
    if ss!=200:return jsonify(settings),ss
    item_orders=(settings[0].get("item_orders") or {}) if settings else {}
    if not isinstance(item_orders,dict): item_orders={}

    table=allowed[key]
    select="id"
    if key=="tanks":select="id,tank_code,product"
    elif key=="dispensers":select="id,nozzle_code,product,nozzle_count"
    rs,records=sb(table,params={"select":select})
    if rs!=200:return jsonify(records),rs
    ordered=_settings_order_ids({"x":ids},"x",records)
    item_orders[key]=ordered

    # Tank/dispenser labels contain their numeric position. Rebuild those
    # labels from the new order while keeping UUID references unchanged.
    if key in ("tanks","dispensers"):
        ps,products=sb("products",params={"select":"name,code_name"})
        if ps!=200:return jsonify(products),ps
        code_by_product={str(p.get("name","")).lower():str(p.get("code_name","")).strip() for p in products}
        by_id={str(r["id"]):r for r in records}
        groups={}
        for item_id in ordered:
            item=by_id[item_id]
            product=str(item.get("product","")).lower()
            groups.setdefault(product,[]).append(item_id)

        # First move every affected code to a temporary unique value so the
        # unique tank_code/nozzle_code constraint cannot collide mid-swap.
        for item_id in ordered:
            if key=="tanks":
                st,_=sb("tanks",method="PATCH",params={"id":"eq."+item_id},body={"tank_code":"__reorder__"+item_id},prefer="return=minimal")
            else:
                st,_=sb("nozzles",method="PATCH",params={"id":"eq."+item_id},body={"nozzle_code":"__reorder__"+item_id},prefer="return=minimal")
            if st>=400:return jsonify({"error":"Could not prepare item order change"}),st

        for product,group in groups.items():
            code_name=code_by_product.get(product)
            if not code_name:
                return jsonify({"error":"Product for one or more items was not found"}),404
            for position,item_id in enumerate(group,1):
                if key=="tanks":
                    final_code=f"{code_name}•TANK {position}"
                    st,res=sb("tanks",method="PATCH",params={"id":"eq."+item_id},body={"tank_code":final_code},prefer="return=minimal")
                else:
                    item=by_id[item_id]
                    final_code=f"{code_name}•DISPENSER {position}"
                    count=int(item.get("nozzle_count") or 1)
                    nozzle_ids=[f"{final_code}-N•{i}" for i in range(1,count+1)]
                    st,res=sb("nozzles",method="PATCH",params={"id":"eq."+item_id},body={"nozzle_code":final_code,"nozzle_ids":nozzle_ids},prefer="return=minimal")
                if st>=400:return jsonify({"error":"Could not save item naming order"}),st

    body={"item_orders":item_orders,"updated_at":datetime.now(timezone.utc).isoformat()}
    us,ur=sb("station_settings",method="PATCH",params={"id":"eq.true"},body=body,prefer="return=representation")
    if us>=400:return jsonify(ur),us
    return jsonify({"ok":True,"key":key,"ids":ordered,"item_orders":item_orders}),200

@app.get("/api/products")
def products():
    auth=require_login()
    if auth: return auth
    status, rows = sb("products", params={"select":"id,name,code_name,color,active,selling_price,created_at,updated_at","order":"created_at.asc"})
    return jsonify(rows), status

@app.post("/api/products")
def create_product():
    auth=require_admin()
    if auth: return auth
    data=request.get_json(silent=True) or {}
    name=str(data.get("name","")).strip()
    code_name=str(data.get("code_name","")).strip()
    color=str(data.get("color","")).strip()
    if not name or not code_name or not color:
        return jsonify({"error":"Product name, code name and color are required"}),400
    if len(code_name)>50 or len(name)>100 or len(color)>30:
        return jsonify({"error":"Product name, code name or color is too long"}),400
    status,result=sb("products",method="POST",body={"name":name,"code_name":code_name,"color":color,"active":False},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.route("/api/products/<product_id>", methods=["DELETE"])
def delete_product(product_id):
    auth=require_admin()
    if auth:return auth
    status,result=sb("products",method="DELETE",params={"id":"eq."+product_id},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    if not result:return jsonify({"error":"Product not found"}),404
    return jsonify({"ok":True}),200

@app.patch("/api/products/<product_id>")
def update_product(product_id):
    auth=require_admin()
    if auth: return auth
    data=request.get_json(silent=True) or {}
    body={}
    if "name" in data:
        name=str(data["name"]).strip()
        if not name:return jsonify({"error":"Product name cannot be empty"}),400
        body["name"]=name
    if "code_name" in data:
        code=str(data["code_name"]).strip()
        if not code:return jsonify({"error":"Code name cannot be empty"}),400
        body["code_name"]=code
    if "color" in data:
        color=str(data["color"]).strip()
        if not color:return jsonify({"error":"Color cannot be empty"}),400
        body["color"]=color
    if "active" in data: body["active"]=bool(data["active"])
    if "selling_price" in data:
        try: price=float(data["selling_price"])
        except (TypeError,ValueError): return jsonify({"error":"Invalid selling price"}),400
        if price <= 0: return jsonify({"error":"Selling price must be greater than zero"}),400
        body["selling_price"]=round(price,2)
    if not body:return jsonify({"error":"No changes supplied"}),400
    body["updated_at"]=datetime.now(timezone.utc).isoformat()

    # Read the current product so activation/price changes can be recorded.
    old_status, old_rows = sb("products",params={"id":"eq."+product_id,"select":"id,active,selling_price"})
    if old_status != 200 or not old_rows:
        return jsonify({"error":"Product not found"}),404
    old_product=old_rows[0]
    activating = ("active" in body and body["active"] is True and not old_product.get("active"))
    price_changed = "selling_price" in body and float(body["selling_price"]) != float(old_product.get("selling_price") or 0)

    if activating and "selling_price" not in body:
        return jsonify({"error":"Selling price is required when activating a product"}),400

    status,result=sb("products",method="PATCH",params={"id":"eq."+product_id},body=body,prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status

    new_price=body.get("selling_price")
    if activating and new_price is not None:
        hs,hr=sb("product_price_history",method="POST",body={
            "product_id":product_id,"selling_price":new_price,"action":"activation",
            "changed_by":session.get("employee_id")
        },prefer="return=representation")
        if hs>=400:return jsonify({"error":hr}),hs
    elif price_changed and new_price is not None:
        hs,hr=sb("product_price_history",method="POST",body={
            "product_id":product_id,"selling_price":new_price,"action":"price_update",
            "changed_by":session.get("employee_id")
        },prefer="return=representation")
        if hs>=400:return jsonify({"error":hr}),hs
    return jsonify(result),200

@app.get("/api/tanks")
def tanks():
    auth = require_login()
    if auth: return auth

    status, rows = sb("tanks", params={
        "select":"id,tank_code,product,product_id,capacity_liters,current_mm,current_liters,opening_stock_liters,calibration_mm,calibration_liters,calibration_points,active,updated_at",
        "order":"tank_code.asc"
    })
    if status != 200:
        return jsonify(rows), status

    for tank in rows:
        tank["active_shifts"] = []

    # The active shift already points directly to the legacy dispenser record
    # in shifts.nozzle_id. That record contains tank_id, so use this stable
    # relationship for tank assignment display instead of depending on the
    # normalized reading tables.
    active_status, active_rows = sb("shifts", params={
        "status":"eq.active",
        "select":"id,employee_id,nozzle_id,status,start_time,created_at",
        "order":"created_at.asc",
        "limit":"100"
    })
    if active_status != 200 or not active_rows:
        return jsonify(rows), status

    employee_ids=sorted(set(str(r.get("employee_id")) for r in active_rows if r.get("employee_id")))
    employee_map={}
    if employee_ids:
        es,er=sb("employees",params={
            "id":"in.("+",".join(employee_ids)+")",
            "select":"id,name"
        })
        if es==200:
            employee_map={str(e.get("id")):e.get("name") for e in er}

    nozzle_ids=sorted(set(str(r.get("nozzle_id")) for r in active_rows if r.get("nozzle_id")))
    nozzle_rows=[]
    if nozzle_ids:
        ns,nr=sb("nozzles",params={
            "id":"in.("+",".join(nozzle_ids)+")",
            "select":"id,nozzle_code,product,tank_id,active"
        })
        if ns==200:
            nozzle_rows=nr

    nozzle_map={str(n.get("id")):n for n in nozzle_rows}
    tank_map={str(t.get("id")):t for t in rows}

    for shift in active_rows:
        nozzle=nozzle_map.get(str(shift.get("nozzle_id")))
        if not nozzle:
            continue
        tank=tank_map.get(str(nozzle.get("tank_id") or ""))
        if not tank:
            continue
        tank["active_shifts"].append({
            "shift_id":shift.get("id"),
            "employee_id":shift.get("employee_id"),
            "employee_name":employee_map.get(str(shift.get("employee_id"))) or "Assigned attendant",
            "dispenser_code":nozzle.get("nozzle_code"),
            "tank_id":nozzle.get("tank_id"),
            "product":nozzle.get("product"),
            "nozzle_id":nozzle.get("id"),
            "nozzle_code":nozzle.get("nozzle_code")
        })

    return jsonify(rows), status

@app.post("/api/tanks")
def create_tank():
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    product = str(data.get("product","")).strip()
    try:
        capacity = float(data.get("capacity_liters",0))
    except (TypeError,ValueError):
        return jsonify({"error":"Invalid tank size"}),400
    if not product or capacity <= 0:
        return jsonify({"error":"Product and valid tank size are required"}),400

    ps, products = sb("products", params={"select":"name,code_name,active","name":"eq."+product,"limit":"1"})
    if ps != 200 or not products:
        return jsonify({"error":"Product not found"}),404
    p = products[0]
    if not p.get("active"):
        return jsonify({"error":"Product is inactive"}),400
    code_name = str(p["code_name"]).strip()

    ts, tanks = sb("tanks", params={"select":"tank_code","product":"eq."+product})
    if ts != 200:
        return jsonify({"error":tanks}),ts
    max_order = 0
    import re
    pattern = re.compile(r"^"+re.escape(code_name)+r"•TANK (\d+)$", re.IGNORECASE)
    for tank in tanks:
        match = pattern.match(str(tank.get("tank_code","")))
        if match:
            max_order = max(max_order, int(match.group(1)))
    tank_code = f"{code_name}•TANK {max_order + 1}"

    status,result=sb("tanks",method="POST",body={
        "tank_code":tank_code,
        "product":product,
        "capacity_liters":capacity,
        "current_liters":0,
        "current_mm":0,
        "active":False
    },prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.patch("/api/tanks/<tank_id>/calibration")
def update_tank_calibration(tank_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    try:
        calibration_mm=float(data.get("calibration_mm"))
        calibration_liters=float(data.get("calibration_liters"))
    except (TypeError,ValueError):
        return jsonify({"error":"Enter valid calibration millimeters and liters"}),400
    if calibration_mm <= 0 or calibration_liters < 0:
        return jsonify({"error":"Calibration millimeters must be greater than zero and liters cannot be negative"}),400

    ts,rows=sb("tanks",params={"id":"eq."+tank_id,"select":"id,tank_code,capacity_liters","limit":"1"})
    if ts!=200:return jsonify(rows),ts
    if not rows:return jsonify({"error":"Tank not found"}),404
    tank=rows[0]
    capacity=float(tank.get("capacity_liters") or 0)
    if calibration_liters > capacity:
        return jsonify({"error":"Calibration liters cannot exceed tank capacity"}),400

    status,result=sb("tanks",method="PATCH",params={"id":"eq."+tank_id},body={
        "calibration_mm":calibration_mm,
        "calibration_liters":calibration_liters,
        "updated_at":datetime.now(timezone.utc).isoformat()
    },prefer="return=representation")
    if status>=400:return jsonify(result),status
    return jsonify(result[0] if isinstance(result,list) and result else result),200


@app.patch("/api/tanks/<tank_id>/calibration-csv")
def update_tank_calibration_csv(tank_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    points=data.get("calibration_points")
    if not isinstance(points,list) or len(points)<2:
        return jsonify({"error":"Upload a CSV containing at least two calibration points."}),400
    clean=[]
    last_height=None
    for point in points:
        try:
            height=float(point.get("height_mm"))
            liters_value=float(point.get("liters"))
        except (TypeError,ValueError,AttributeError):
            return jsonify({"error":"Each calibration row must contain numeric height_mm and liters values."}),400
        if height<0 or liters_value<0:
            return jsonify({"error":"Calibration height and liters cannot be negative."}),400
        if last_height is not None and height<=last_height:
            return jsonify({"error":"Calibration heights must be strictly increasing."}),400
        clean.append({"height_mm":height,"liters":liters_value})
        last_height=height
    ts,rows=sb("tanks",params={"id":"eq."+tank_id,"select":"id,tank_code,capacity_liters","limit":"1"})
    if ts!=200:return jsonify(rows),ts
    if not rows:return jsonify({"error":"Tank not found"}),404
    capacity=float(rows[0].get("capacity_liters") or 0)
    if clean[-1]["liters"]>capacity:
        return jsonify({"error":"Calibration liters cannot exceed tank capacity."}),400
    status,result=sb("tanks",method="PATCH",params={"id":"eq."+tank_id},body={
        "calibration_points":clean,
        "calibration_mm":clean[-1]["height_mm"],
        "calibration_liters":clean[-1]["liters"],
        "updated_at":datetime.now(timezone.utc).isoformat()
    },prefer="return=representation")
    if status>=400:return jsonify(result),status
    return jsonify(result[0] if isinstance(result,list) and result else result),200

@app.patch("/api/tanks/<tank_id>/dip")
def update_tank_dip(tank_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    try:
        dip_mm=float(data.get("mm"))
    except (TypeError,ValueError):
        return jsonify({"error":"Enter a valid dip reading in millimeters"}),400
    if dip_mm < 0:
        return jsonify({"error":"Dip reading cannot be negative"}),400

    ts,rows=sb("tanks",params={"id":"eq."+tank_id,"select":"id,tank_code,capacity_liters,calibration_mm,calibration_liters,calibration_points","limit":"1"})
    if ts!=200:return jsonify(rows),ts
    if not rows:return jsonify({"error":"Tank not found"}),404
    tank=rows[0]
    points=tank.get("calibration_points")
    liters_value=None
    if isinstance(points,list) and len(points)>=2:
        clean=[]
        for point in points:
            try:
                ph=float(point.get("height_mm"))
                pl=float(point.get("liters"))
                if ph>=0 and pl>=0: clean.append((ph,pl))
            except (TypeError,ValueError,AttributeError):
                continue
        clean=sorted(clean,key=lambda x:x[0])
        if len(clean)>=2:
            if dip_mm <= clean[0][0]:
                liters_value=clean[0][1]
            elif dip_mm >= clean[-1][0]:
                liters_value=clean[-1][1]
            else:
                for (h1,l1),(h2,l2) in zip(clean,clean[1:]):
                    if h1 <= dip_mm <= h2:
                        ratio=(dip_mm-h1)/(h2-h1) if h2!=h1 else 0
                        liters_value=l1+(l2-l1)*ratio
                        break
    if liters_value is None:
        ref_mm=tank.get("calibration_mm")
        ref_liters=tank.get("calibration_liters")
        if ref_mm is None or ref_liters is None or float(ref_mm)<=0:
            return jsonify({"error":"This tank has no calibration data. Upload a CSV calibration file first."}),409
        liters_value=dip_mm*float(ref_liters)/float(ref_mm)
    capacity=float(tank.get("capacity_liters") or 0)
    if liters_value > capacity:
        return jsonify({"error":"The converted liters exceed tank capacity. Check the dip reading or calibration reference."}),400

    now=datetime.now(timezone.utc).isoformat()
    status,result=sb("tanks",method="PATCH",params={"id":"eq."+tank_id},body={
        "current_mm":dip_mm,
        "current_liters":liters_value,
        "updated_at":now
    },prefer="return=representation")
    if status>=400:return jsonify(result),status
    return jsonify({
        "ok":True,
        "tank":result[0] if isinstance(result,list) and result else result,
        "mm":dip_mm,
        "liters":liters_value
    }),200


@app.patch("/api/tanks/<tank_id>/stock")
def update_tank_stock(tank_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    try:
        stock=float(data.get("stock_liters"))
    except (TypeError,ValueError):
        return jsonify({"error":"Invalid tank stock reading"}),400
    if stock < 0:
        return jsonify({"error":"Tank stock cannot be negative"}),400

    remark = str(data.get("remark") or "").strip()
    if len(remark) > 1000:
        return jsonify({"error":"Remark is too long"}),400

    purchase_id=str(data.get("purchase_id") or "").strip()
    event_index=data.get("event_index")
    try:
        event_index=int(event_index)
    except (TypeError,ValueError):
        return jsonify({"error":"Discharge operation is required"}),400

    ts,rows=sb("tanks",params={"id":"eq."+tank_id,"select":"id,tank_code,product,capacity_liters,current_liters,active","limit":"1"})
    if ts!=200:return jsonify(rows),ts
    if not rows:return jsonify({"error":"Tank not found"}),404
    tank=rows[0]
    capacity=float(tank.get("capacity_liters") or 0)
    if stock>capacity:return jsonify({"error":"Tank stock cannot exceed tank capacity"}),400

    if not purchase_id:
        return jsonify({"error":"Purchase reference is required"}),400
    ps,purchases=sb("purchases",params={"id":"eq."+purchase_id,"select":"id,product,discharge_history","limit":"1"})
    if ps!=200:return jsonify(purchases),ps
    if not purchases:return jsonify({"error":"Purchase not found"}),404
    purchase=purchases[0]
    history=purchase.get("discharge_history") or []
    if not isinstance(history,list) or event_index<0 or event_index>=len(history):
        return jsonify({"error":"Discharge operation not found"}),404
    event=dict(history[event_index] or {})
    if str(event.get("tank_id") or "") != str(tank_id):
        return jsonify({"error":"Selected tank does not match this discharge operation"}),400
    if event.get("tank_stock_recorded"):
        if not data.get("remark_only"):
            return jsonify({"error":"Tank stock for this discharge operation is already recorded"}),409
        event["tank_stock_remark"]=remark
        history[event_index]=event
        ms,mr=sb("purchases",method="PATCH",params={"id":"eq."+purchase_id},body={"discharge_history":history},prefer="return=representation")
        if ms>=400:
            return jsonify({"error":"The tank stock was saved, but the remark could not be updated.","details":mr}),500
        return jsonify({"ok":True,"event_index":event_index,"remark":remark}),200

    # Reconcile the physical reading against this discharge operation's
    # expected post-discharge stock, not against whatever the tank happens to
    # contain now. A later discharge must never be overwritten by recording an
    # older operation's stock.
    previous=float(event.get("tank_liters_after") if event.get("tank_liters_after") is not None else tank.get("current_liters") or 0)
    delta=stock-previous
    now=datetime.now(timezone.utc).isoformat()
    event["tank_stock_recorded"]=True
    event["tank_stock_recorded_liters"]=stock
    event["tank_stock_recorded_at"]=now
    event["tank_stock_adjustment_liters"]=delta
    event["tank_stock_remark"]=remark
    history[event_index]=event

    # Only move the tank's live balance when this operation is still the
    # latest recorded tank movement. If newer movements exist, this reading
    # remains an audit adjustment for the older operation.
    try:
        event_time=datetime.fromisoformat(str(event.get("discharge_datetime") or "").replace("Z","+00:00"))
        if event_time.tzinfo is None:
            event_time=event_time.replace(tzinfo=timezone.utc)
        event_time=event_time.astimezone(timezone.utc)
    except Exception:
        event_time=None
    latest_status,latest_rows=sb("tank_movements",params={
        "select":"id,created_at",
        "tank_id":"eq."+tank_id,
        "created_at":"gt."+str(event.get("discharge_datetime") or ""),
        "order":"created_at.desc","limit":"1"
    }) if event_time else (200,[])
    has_newer_movement=latest_status==200 and bool(latest_rows)
    if not has_newer_movement:
        body={"current_liters":stock,"updated_at":now}
        status,result=sb("tanks",method="PATCH",params={"id":"eq."+tank_id},body=body,prefer="return=representation")
        if status>=400:return jsonify(result),status
    else:
        result=tank

    ms,mr=sb("purchases",method="PATCH",params={"id":"eq."+purchase_id},body={"discharge_history":history},prefer="return=representation")
    if ms>=400:
        return jsonify({"error":"Tank stock was updated, but the discharge record could not be marked complete.","details":mr}),500

    if abs(delta)>0.000001:
        ms,mr=sb("tank_movements",method="POST",body={
            "tank_id":tank_id,
            "movement_type":"adjustment",
            "quantity_liters":delta,
            "reference_id":purchase_id,
            "notes":"Physical tank stock recorded after purchase discharge",
            "created_by":session.get("employee_id")
        },prefer="return=representation")
        if ms>=400:return jsonify({"error":mr}),ms

    return jsonify({"ok":True,"tank":result[0] if isinstance(result,list) and result else result,
                    "previous_liters":previous,"stock_liters":stock,
                    "adjustment_liters":delta,"event_index":event_index}),200

@app.route("/api/tanks/<tank_id>", methods=["DELETE"])
def delete_tank(tank_id):
    auth=require_admin()
    if auth:return auth
    status,result=sb("tanks",method="DELETE",params={"id":"eq."+tank_id},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    if not result:return jsonify({"error":"Tank not found"}),404
    return jsonify({"ok":True}),200

@app.patch("/api/tanks/<tank_id>")
def update_tank(tank_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}

    if "tank_order" in data or "capacity_liters" in data or "active" in data or "calibration_mm" in data or "calibration_liters" in data or "calibration_points" in data:
        ts, rows = sb("tanks", params={"id":"eq."+tank_id,"select":"id,tank_code,product,capacity_liters,current_liters,calibration_mm,calibration_liters,calibration_points"})
        if ts != 200 or not rows:
            return jsonify({"error":"Tank not found"}),404
        tank = rows[0]
        body = {}
        if "capacity_liters" in data:
            try: capacity = float(data["capacity_liters"])
            except (TypeError,ValueError): return jsonify({"error":"Invalid tank size"}),400
            if capacity <= 0:
                return jsonify({"error":"Tank size must be greater than zero"}),400
            if float(tank.get("current_liters") or 0) > capacity:
                return jsonify({"error":"Tank size cannot be below current inventory"}),400
            body["capacity_liters"] = capacity

        if "calibration_points" in data:
            points=data.get("calibration_points")
            if not isinstance(points,list) or len(points)<2:
                return jsonify({"error":"Calibration must contain at least two points"}),400
            clean=[]
            last_height=None
            for point in points:
                try:
                    height=float(point.get("height_mm")); liters_value=float(point.get("liters"))
                except (TypeError,ValueError,AttributeError):
                    return jsonify({"error":"Each calibration point must contain numeric height_mm and liters"}),400
                if height<0 or liters_value<0:
                    return jsonify({"error":"Calibration height and liters cannot be negative"}),400
                if last_height is not None and height<=last_height:
                    return jsonify({"error":"Calibration heights must be strictly increasing"}),400
                clean.append({"height_mm":height,"liters":liters_value}); last_height=height
            effective_capacity=float(data.get("capacity_liters",tank.get("capacity_liters") or 0))
            if clean[-1]["liters"]>effective_capacity:
                return jsonify({"error":"Calibration liters cannot exceed tank capacity"}),400
            body["calibration_points"]=clean
            body["calibration_mm"]=clean[-1]["height_mm"]
            body["calibration_liters"]=clean[-1]["liters"]
        elif "calibration_mm" in data or "calibration_liters" in data:
            if "calibration_mm" not in data or "calibration_liters" not in data:
                return jsonify({"error":"Enter both calibration mm and calibration liters"}),400
            try:
                calibration_mm=float(data["calibration_mm"]); calibration_liters=float(data["calibration_liters"])
            except (TypeError,ValueError):
                return jsonify({"error":"Enter valid calibration millimeters and liters"}),400
            if calibration_mm<=0 or calibration_liters<0:
                return jsonify({"error":"Calibration values are invalid"}),400
            effective_capacity=float(data.get("capacity_liters",tank.get("capacity_liters") or 0))
            if calibration_liters>effective_capacity:
                return jsonify({"error":"Calibration liters cannot exceed tank capacity"}),400
            body["calibration_mm"]=calibration_mm; body["calibration_liters"]=calibration_liters

        if "active" in data:
            requested_active = bool(data["active"])
            if requested_active:
                ps, products = sb("products", params={"select":"name,code_name,active", "name":"eq."+str(tank["product"]), "limit":"1"})
                if ps != 200 or not products:
                    return jsonify({"error":"Product for this tank was not found"}),404
                if not products[0].get("active"):
                    return jsonify({"error":"Tank cannot be activated because its product is inactive"}),400
                if "opening_stock_liters" not in data:
                    return jsonify({"error":"Opening stock reading is required when activating a tank"}),400
                try:
                    opening_stock = float(data["opening_stock_liters"])
                except (TypeError,ValueError):
                    return jsonify({"error":"Invalid opening stock reading"}),400
                if opening_stock < 0:
                    return jsonify({"error":"Opening stock reading cannot be negative"}),400
                if opening_stock > float(tank.get("capacity_liters") or 0):
                    return jsonify({"error":"Opening stock cannot exceed tank capacity"}),400
                body["current_liters"] = opening_stock
                body["opening_stock_liters"] = opening_stock
                body["active"] = True
            else:
                body["active"] = False

        if "tank_order" in data:
            try: order = int(data["tank_order"])
            except (TypeError,ValueError): return jsonify({"error":"Invalid tank order"}),400
            if order < 1:
                return jsonify({"error":"Tank order must be 1 or greater"}),400
            ps, products = sb("products", params={"select":"name,code_name","name":"eq."+str(tank["product"]),"limit":"1"})
            if ps != 200 or not products:
                return jsonify({"error":"Product for this tank was not found"}),404
            code_name = str(products[0]["code_name"]).strip()
            import re
            pattern = re.compile(r"^"+re.escape(code_name)+r"•TANK (\d+)$", re.IGNORECASE)
            ts, same_tanks = sb("tanks", params={"select":"id,tank_code","product":"eq."+str(tank["product"])})
            if ts != 200:
                return jsonify({"error":same_tanks}),ts
            current_match = pattern.match(str(tank.get("tank_code","")))
            current_order = int(current_match.group(1)) if current_match else None
            if current_order is None:
                return jsonify({"error":"Current tank order could not be determined"}),400
            max_order = max([int(m.group(1)) for x in same_tanks if (m := pattern.match(str(x.get("tank_code",""))))] or [0])
            if order > max_order:
                return jsonify({"error":"Select one of the existing tank orders"}),400
            if order != current_order:
                target = next((x for x in same_tanks if pattern.match(str(x.get("tank_code",""))).group(1) == str(order) if pattern.match(str(x.get("tank_code","")))), None)
                if not target:
                    return jsonify({"error":"Selected tank order is not available"}),400
                current_code = f"{code_name}•TANK {current_order}"
                target_code = f"{code_name}•TANK {order}"
                temp_code = f"{code_name}•TANK __swap__{tank_id}"
                status,_=sb("tanks",method="PATCH",params={"id":"eq."+target["id"]},body={"tank_code":temp_code},prefer="return=minimal")
                if status>=400:return jsonify({"error":"Could not prepare tank order swap"}),status
                status,_=sb("tanks",method="PATCH",params={"id":"eq."+tank_id},body={"tank_code":target_code},prefer="return=minimal")
                if status>=400:return jsonify({"error":"Could not change tank order"}),status
                status,_=sb("tanks",method="PATCH",params={"id":"eq."+target["id"]},body={"tank_code":current_code},prefer="return=minimal")
                if status>=400:return jsonify({"error":"Could not complete tank order swap"}),status
                body.pop("tank_code", None)

        if body:
            status,result=sb("tanks",method="PATCH",params={"id":"eq."+tank_id},body=body,prefer="return=representation")
            if status>=400:
                if status == 409 or (isinstance(result,dict) and result.get("code")=="23505"):
                    return jsonify({"error":"That tank order is already in use for this product"}),409
                return jsonify({"error":result}),status
            return jsonify(result),200
        if "tank_order" in data and not body:
            status,result=sb("tanks",params={"id":"eq."+tank_id,"select":"id,tank_code,product,capacity_liters,current_liters,active"})
            if status>=400:return jsonify({"error":result}),status
            return jsonify(result),200

    if "current_liters" not in data:
        return jsonify({"error":"No changes supplied"}),400
    try:
        liters=float(data["current_liters"]); mm=float(data.get("current_mm",0))
    except (TypeError,ValueError):
        return jsonify({"error":"Invalid inventory values"}),400
    status,result=rpc("adjust_tank_inventory",{"p_tank_id":tank_id,"p_new_liters":liters,"p_new_mm":mm,"p_created_by":session["employee_id"],"p_notes":data.get("notes","Admin inventory adjustment")})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.get("/api/nozzles")
def nozzles():
    auth=require_login()
    if auth:return auth
    params={"select":"id,nozzle_code,nozzle_ids,product,tank_id,nozzle_count,active,opening_tank_liters,activated_at","order":"nozzle_code.asc"}
    if session.get("role") != "admin":
        # Attendants need to see their pending assigned dispenser even though
        # it remains inactive until they confirm the assignment.
        ps, pending = sb("shifts", params={
            "employee_id":"eq."+str(session["employee_id"]),
            "status":"eq.assigned",
            "select":"nozzle_id"
        })
        if ps != 200:
            return jsonify(pending), ps
        pending_ids=[str(x.get("nozzle_id")) for x in pending if x.get("nozzle_id")]
        # Also expose dispensers referenced by this attendant's shift
        # history. Historical shifts can belong to dispensers that are now
        # inactive; hiding those rows makes the history card fall back to the
        # raw UUID instead of the human-readable dispenser code.
        hs,history_rows=sb("shifts",params={
            "employee_id":"eq."+str(session["employee_id"]),
            "select":"nozzle_id"
        })
        if hs != 200:
            return jsonify(history_rows), hs
        history_ids=[str(x.get("nozzle_id")) for x in history_rows if x.get("nozzle_id")]
        all_ids=sorted(set(pending_ids+history_ids))
        if all_ids:
            params["or"]="(active.eq.true,id.in.("+",".join(all_ids)+"))"
        else:
            params["active"]="eq.true"
    status,rows=sb("nozzles",params=params)
    return jsonify(rows),status

@app.post("/api/nozzles")
def create_nozzle():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    product,tank_id=str(data.get("product","")).strip(),str(data.get("tank_id","")).strip()
    try: nozzle_count=int(data.get("nozzle_count",0))
    except (TypeError,ValueError): nozzle_count=0
    if not product or not tank_id or nozzle_count not in (1,2,3,4):
        return jsonify({"error":"Product, tank and nozzle count (1-4) are required"}),400
    ps,pr=sb("products",params={"name":"eq."+product,"select":"name,code_name,active","limit":"1"})
    if ps!=200 or not pr:return jsonify({"error":"Product not found"}),404
    if not pr[0].get("active"):return jsonify({"error":"Product is inactive"}),400
    code_name=str(pr[0]["code_name"]).strip()
    ts,tr=sb("tanks",params={"id":"eq."+tank_id,"select":"id,product,active"})
    if ts!=200 or not tr:return jsonify({"error":"Tank not found"}),404
    if not tr[0].get("active"):return jsonify({"error":"Tank is inactive"}),400
    if product.lower()!=str(tr[0]["product"]).lower():return jsonify({"error":"Dispenser product must match tank product"}),400
    ts,rows=sb("nozzles",params={"select":"nozzle_code","product":"eq."+product})
    if ts!=200:return jsonify({"error":rows}),ts
    import re
    pattern=re.compile(r"^"+re.escape(code_name)+r"•DISPENSER (\d+)$",re.IGNORECASE)
    max_order=0
    for row in rows:
        m=pattern.match(str(row.get("nozzle_code","")))
        if m:max_order=max(max_order,int(m.group(1)))
    dispenser_code=f"{code_name}•DISPENSER {max_order+1}"
    nozzle_ids=[f"{dispenser_code}-N•{i}" for i in range(1, nozzle_count + 1)]
    status,result=sb("nozzles",method="POST",body={"nozzle_code":dispenser_code,"nozzle_ids":nozzle_ids,"product":product,"tank_id":tank_id,"nozzle_count":nozzle_count,"active":False},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.route("/api/nozzles/<nozzle_id>",methods=["DELETE"])
def delete_nozzle(nozzle_id):
    auth=require_admin()
    if auth:return auth
    ss,sr=sb("shifts",params={"nozzle_id":"eq."+nozzle_id,"status":"in.(assigned,active)","select":"id","limit":"1"})
    if ss!=200:return jsonify({"error":sr}),ss
    if sr:return jsonify({"error":"This dispenser has an assigned or active shift"}),409
    status,result=sb("nozzles",method="DELETE",params={"id":"eq."+nozzle_id},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    if not result:return jsonify({"error":"Dispenser not found"}),404
    return jsonify({"ok":True}),200

@app.patch("/api/nozzles/<nozzle_id>")
def update_nozzle(nozzle_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    if data.get("active") is True and "activated_nozzles" in data:
        try:
            employee_id=str(data.get("employee_id","")).strip()
            opening_tank_liters=float(data.get("opening_tank_liters"))
            activated_nozzles=data.get("activated_nozzles")
            status,result=rpc("activate_dispenser",{
                "p_nozzle_id":nozzle_id,
                "p_employee_id":employee_id,
                "p_opening_tank_liters":opening_tank_liters,
                "p_activated_nozzles":activated_nozzles
            })
            if status>=400:return jsonify({"error":result}),status
            return jsonify(result),200
        except (TypeError,ValueError):
            return jsonify({"error":"Invalid tank opening liters"}),400
    status,current=sb("nozzles",params={"id":"eq."+nozzle_id,"select":"id,nozzle_code,nozzle_ids,product,tank_id,nozzle_count,active"})
    if status!=200 or not current:return jsonify({"error":"Dispenser not found"}),404
    cur=current[0]
    body={}
    if "active" in data: body["active"]=bool(data["active"])
    if "nozzle_count" in data:
        try: count=int(data["nozzle_count"])
        except (TypeError,ValueError): return jsonify({"error":"Nozzle count must be 1, 2, 3 or 4"}),400
        if count not in (1,2,3,4): return jsonify({"error":"Nozzle count must be 1, 2, 3 or 4"}),400
        body["nozzle_count"]=count
    new_product=str(data.get("product",cur["product"])).strip()
    new_tank_id=str(data.get("tank_id",cur["tank_id"] or "")).strip()
    if "product" in data or "tank_id" in data:
        ps,pr=sb("products",params={"name":"eq."+new_product,"select":"name,code_name,active","limit":"1"})
        if ps!=200 or not pr:return jsonify({"error":"Product not found"}),404
        if not pr[0].get("active"):return jsonify({"error":"Product is inactive"}),400
        ts,tr=sb("tanks",params={"id":"eq."+new_tank_id,"select":"id,product,active"})
        if ts!=200 or not tr:return jsonify({"error":"Tank not found"}),404
        if not tr[0].get("active"):return jsonify({"error":"Tank is inactive"}),400
        if new_product.lower()!=str(tr[0]["product"]).lower():return jsonify({"error":"Dispenser product must match tank product"}),400
        body["product"]=new_product
        body["tank_id"]=new_tank_id
    if "tank_order" in data:
        try: order=int(data["tank_order"])
        except (TypeError,ValueError): return jsonify({"error":"Invalid dispenser order"}),400
        if order<1:return jsonify({"error":"Dispenser order must be 1 or greater"}),400
        code_product=new_product
        ps,pr=sb("products",params={"name":"eq."+code_product,"select":"name,code_name","limit":"1"})
        if ps!=200 or not pr:return jsonify({"error":"Product not found"}),404
        code_name=str(pr[0]["code_name"]).strip()
        import re
        pattern=re.compile(r"^"+re.escape(code_name)+r"•DISPENSER (\d+)$",re.IGNORECASE)
        current_match=pattern.match(str(cur["nozzle_code"]))
        current_order=int(current_match.group(1)) if current_match else None
        if current_order is None:return jsonify({"error":"Current dispenser order could not be determined"}),400
        ts,same=sb("nozzles",params={"select":"id,nozzle_code","product":"eq."+code_product})
        if ts!=200:return jsonify({"error":same}),ts
        max_order=max([int(m.group(1)) for x in same if (m:=pattern.match(str(x.get("nozzle_code",""))))] or [0])
        if order>max_order:return jsonify({"error":"Select one of the existing dispenser orders"}),400
        if order!=current_order:
            target=next((x for x in same if x["id"]!=nozzle_id and pattern.match(str(x.get("nozzle_code",""))) and int(pattern.match(str(x["nozzle_code"])).group(1))==order),None)
            if not target:return jsonify({"error":"Selected dispenser order is not available"}),400
            current_code=f"{code_name}•DISPENSER {current_order}"
            target_code=f"{code_name}•DISPENSER {order}"
            temp_code=f"{code_name}•DISPENSER __swap__{nozzle_id}"
            status,_=sb("nozzles",method="PATCH",params={"id":"eq."+target["id"]},body={"nozzle_code":temp_code},prefer="return=minimal")
            if status>=400:return jsonify({"error":"Could not prepare dispenser order swap"}),status
            status,_=sb("nozzles",method="PATCH",params={"id":"eq."+nozzle_id},body={"nozzle_code":target_code},prefer="return=minimal")
            if status>=400:return jsonify({"error":"Could not change dispenser order"}),status
            status,_=sb("nozzles",method="PATCH",params={"id":"eq."+target["id"]},body={"nozzle_code":current_code},prefer="return=minimal")
            if status>=400:return jsonify({"error":"Could not complete dispenser order swap"}),status
    elif "product" in data:
        # Moving to another product gets the next available automatic dispenser number.
        ps,pr=sb("products",params={"name":"eq."+new_product,"select":"name,code_name","limit":"1"})
        if ps==200 and pr:
            code_name=str(pr[0]["code_name"]).strip()
            ts,rows=sb("nozzles",params={"select":"nozzle_code","product":"eq."+new_product})
            if ts==200:
                import re
                pattern=re.compile(r"^"+re.escape(code_name)+r"•DISPENSER (\d+)$",re.IGNORECASE)
                max_order=max([int(m.group(1)) for x in rows if (m:=pattern.match(str(x.get("nozzle_code",""))))] or [0])
                body["nozzle_code"]=f"{code_name}•DISPENSER {max_order+1}"
    final_code=body.get("nozzle_code",cur["nozzle_code"])
    final_count=body.get("nozzle_count",cur.get("nozzle_count",1))
    if "nozzle_code" in body or "nozzle_count" in body:
        body["nozzle_ids"]=[f"{final_code}-N•{i}" for i in range(1, int(final_count)+1)]
    if not body:return jsonify({"error":"No changes supplied"}),400
    status,result=sb("nozzles",method="PATCH",params={"id":"eq."+nozzle_id},body=body,prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    # Deactivation is admin-only. Keep legacy and normalized physical-nozzle
    # states synchronized, and do not silently invalidate a pending assignment.
    if body.get("active") is False and cur.get("active") is True:
        cs,cr=sb("shifts",params={"nozzle_id":"eq."+nozzle_id,"status":"assigned","select":"id","limit":"1"})
        if cs!=200:return jsonify({"error":cr}),cs
        if cr:return jsonify({"error":"This dispenser has a pending shift assignment. Cancel the assignment before deactivating it."}),409
        cs,cr=sb("shifts",params={"nozzle_id":"eq."+nozzle_id,"status":"active","select":"id"})
        if cs!=200:return jsonify({"error":cr}),cs
        now=datetime.now(timezone.utc).isoformat()
        for shift in cr:
            ss,sr=sb("shifts",method="PATCH",params={"id":"eq."+shift["id"]},body={"status":"closed","end_time":now},prefer="return=representation")
            if ss>=400:return jsonify({"error":sr}),ss
        codes=cur.get("nozzle_ids") or []
        if codes:
            ds,dr=sb("dispenser_nozzles",params={"nozzle_code":"in.("+",".join(str(x) for x in codes)+")","select":"id"})
            if ds!=200:return jsonify({"error":dr}),ds
            for row in dr:
                ps,pr=sb("dispenser_nozzles",method="PATCH",params={"id":"eq."+str(row["id"])},body={"active":False},prefer="return=minimal")
                if ps>=400:return jsonify({"error":pr}),ps
    return jsonify(result),200

@app.get("/api/shifts")
def shifts():
    auth=require_login()
    if auth:return auth
    params={"select":"*","order":"created_at.desc","limit":"100"}
    if session.get("role")!="admin":params["employee_id"]="eq."+session["employee_id"]
    status,rows=sb("shifts",params=params)
    if status != 200:
        return jsonify(rows),status

    # Enrich shifts from the normalized physical-nozzle reading tables.
    # Legacy fields remain in the response for backward compatibility.
    shift_ids=[str(r.get("id")) for r in rows if r.get("id")]
    if shift_ids:
        rs,reading_rows=sb("shift_nozzle_readings",params={
            "shift_id":"in.("+",".join(shift_ids)+")",
            "select":"id,shift_id,nozzle_id,opening_reading,closing_reading,opening_mm,closing_mm,opening_liters,closing_liters,opening_source_reading_id,closing_source_handover_id,opened_at,closed_at"
        })
        if rs==200:
            nozzle_ids=[str(r.get("nozzle_id")) for r in reading_rows if r.get("nozzle_id")]
            nozzle_map={}
            if nozzle_ids:
                ns,nrows=sb("dispenser_nozzles",params={
                    "id":"in.("+",".join(sorted(set(nozzle_ids)))+")",
                    "select":"id,dispenser_id,nozzle_number,nozzle_code,product_id,tank_id,active"
                })
                if ns==200:
                    nozzle_map={str(r.get("id")):r for r in nrows}
                    dispenser_ids=[str(r.get("dispenser_id")) for r in nrows if r.get("dispenser_id")]
                    dispenser_map={}
                    if dispenser_ids:
                        ds,drows=sb("dispensers",params={
                            "id":"in.("+",".join(sorted(set(dispenser_ids)))+")",
                            "select":"id,dispenser_code,active"
                        })
                        if ds==200:
                            dispenser_map={str(r.get("id")):r for r in drows}
                    for rr in reading_rows:
                        dn=nozzle_map.get(str(rr.get("nozzle_id")),{})
                        rr["nozzle_code"]=dn.get("nozzle_code")
                        rr["nozzle_number"]=dn.get("nozzle_number")
                        rr["dispenser_id"]=dn.get("dispenser_id")
                        rr["tank_id"]=dn.get("tank_id")
                        rr["product_id"]=dn.get("product_id")
                        rr["active"]=dn.get("active")
                        rr["dispenser_code"]=dispenser_map.get(str(dn.get("dispenser_id")),{}).get("dispenser_code")
            by_shift={}
            for rr in reading_rows:
                by_shift.setdefault(str(rr.get("shift_id")),[]).append(rr)
            for row in rows:
                row["nozzle_readings"]=by_shift.get(str(row.get("id")),[])
    return jsonify(rows),status

@app.post("/api/shifts")
def create_shift():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    employee_id,nozzle_id=str(data.get("employee_id","")).strip(),str(data.get("nozzle_id","")).strip()
    if not employee_id or not nozzle_id:return jsonify({"error":"User and nozzle are required"}),400

    # A dispenser assignment is pending until the attendant confirms it.
    # Store the readings now, but do not activate the tank/dispenser yet.
    activation_nozzles=data.get("activation_nozzles")
    opening_tank_liters=data.get("opening_tank_liters")
    if activation_nozzles is not None:
        if not isinstance(activation_nozzles,list) or not activation_nozzles:
            return jsonify({"error":"At least one nozzle must be activated"}),400
        try:
            opening_tank_liters=float(opening_tank_liters)
        except (TypeError,ValueError):
            return jsonify({"error":"Invalid tank opening liters"}),400
        if opening_tank_liters < 0:
            return jsonify({"error":"Tank opening liters cannot be negative"}),400
        for item in activation_nozzles:
            if not isinstance(item,dict) or not str(item.get("nozzle_id","")).strip():
                return jsonify({"error":"Invalid nozzle activation data"}),400
            try:
                reading=float(item.get("opening_reading"))
            except (TypeError,ValueError):
                return jsonify({"error":"Invalid nozzle opening reading"}),400
            if reading < 0:
                return jsonify({"error":"Nozzle opening reading cannot be negative"}),400

    es,er=sb("employees",params={"id":"eq."+employee_id,"active":"eq.true","select":"id,role"})
    ns,nr=sb("nozzles",params={"id":"eq."+nozzle_id,"select":"id,active"})
    if es!=200 or not er or er[0].get("role")!="attendant":return jsonify({"error":"Active attendant not found"}),404
    if ns!=200 or not nr:return jsonify({"error":"Dispenser not found"}),404
    # An attendant may have multiple assigned/active dispenser shifts.
    # The dispenser itself remains exclusive to one assigned/active shift.
    ss,sr=sb("shifts",params={"nozzle_id":"eq."+nozzle_id,"status":"in.(assigned,active)","select":"id,status","limit":"1"})
    if ss!=200:return jsonify({"error":sr}),ss
    if sr:return jsonify({"error":"Nozzle already has an assigned or active shift"}),409

    body={"employee_id":employee_id,"nozzle_id":nozzle_id,"status":"assigned","assigned_by":session["employee_id"]}
    if activation_nozzles is not None:
        body["activation_nozzles"]=activation_nozzles
        body["opening_tank_liters"]=opening_tank_liters
    status,result=sb("shifts",method="POST",body=body,prefer="return=representation")
    if status>=400:
        if status==409 or (isinstance(result,dict) and result.get("code")=="23505"):
            return jsonify({"error":"Dispenser already has an assigned or active shift"}),409
        return jsonify({"error":result}),status
    return jsonify(result),201

@app.post("/api/shifts/<shift_id>/confirm")
def confirm_shift_assignment(shift_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    pin=str(data.get("pin",""))
    if not pin or not pin.isdigit():return jsonify({"error":"Enter your numeric PIN"}),400
    es,er=sb("employees",params={"id":"eq."+eid,"active":"eq.true","select":"id,role,pin_hash"})
    if es!=200 or not er:return jsonify({"error":"Attendant account not found"}),404
    emp=er[0]
    if emp.get("role")!="attendant" or not verify_pin(pin,emp.get("pin_hash","")):return jsonify({"error":"Invalid PIN"}),401
    status,rows=sb("shifts",params={"id":"eq."+shift_id,"employee_id":"eq."+eid,"status":"eq.assigned","select":"id,opening_reading,opening_mm,opening_liters,activation_nozzles"})
    if status!=200 or not rows:return jsonify({"error":"Pending shift assignment not found"}),404
    if rows[0].get("activation_nozzles") is None:return jsonify({"error":"Assignment has no nozzle activation readings"}),409
    # The attendant's PIN confirms the pending assignment. Activation of the
    # dispenser, tank opening balance and shift status happen atomically in Supabase.
    status,result=rpc("confirm_shift_activation",{
        "p_shift_id":shift_id,
        "p_employee_id":eid
    })
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.post("/api/shifts/<shift_id>/deactivate")
def admin_deactivate_shift(shift_id):
    auth=require_admin()
    if auth:return auth
    status,current=sb("shifts",params={
        "id":"eq."+shift_id,
        "status":"eq.active",
        "select":"id,nozzle_id"
    })
    if status!=200:return jsonify({"error":current}),status
    if not current:return jsonify({"error":"Active shift not found"}),404
    shift=current[0]
    now=datetime.now(timezone.utc).isoformat()
    status,result=sb("shifts",method="PATCH",params={"id":"eq."+shift_id,"status":"eq.active"},body={
        "status":"closed",
        "end_time":now
    },prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    nozzle_id=shift.get("nozzle_id")
    if nozzle_id:
        ns,nr=sb("nozzles",method="PATCH",params={"id":"eq."+nozzle_id},body={"active":False},prefer="return=representation")
        if ns>=400:return jsonify({"error":nr}),ns
    # Also deactivate normalized physical nozzles belonging to this dispenser.
    if nozzle_id:
        ns,nr=sb("nozzles",params={"id":"eq."+nozzle_id,"select":"nozzle_ids"})
        if ns==200 and nr:
            codes=nr[0].get("nozzle_ids") or []
            if codes:
                ds,dr=sb("dispenser_nozzles",params={"nozzle_code":"in.("+",".join(str(x) for x in codes)+")","select":"id"})
                if ds==200:
                    for row in dr:
                        sb("dispenser_nozzles",method="PATCH",params={"id":"eq."+str(row["id"])},body={"active":False},prefer="return=minimal")
    return jsonify(result),200

@app.post("/api/shifts/<shift_id>/cancel")
def cancel_shift_assignment(shift_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    params={"id":"eq."+shift_id,"status":"eq.assigned","select":"id"}
    if session.get("role")!="admin":
        params["employee_id"]="eq."+eid
    status,current=sb("shifts",params=params)
    if status!=200:return jsonify({"error":current}),status
    if not current:return jsonify({"error":"Pending shift assignment not found"}),404
    status,result=sb("shifts",method="PATCH",params={"id":"eq."+shift_id},body={
        "status":"cancelled",
        "end_time":datetime.now(timezone.utc).isoformat()
    },prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.post("/api/shifts/<shift_id>/start")
def start_shift(shift_id):
    return jsonify({"error":"Use Attendant PIN confirmation to activate this shift"}),410

@app.post("/api/shifts/<shift_id>/close")
def close_shift(shift_id):
    # Shift deactivation is admin-only. Attendants must use handover.
    auth=require_admin()
    if auth:return auth
    eid=session.get("employee_id")
    data=request.get_json(silent=True) or {}
    # Attendant-panel close is intentionally immediate for now.
    # If closing readings are supplied, keep the existing detailed close flow.
    has_readings=any(str(data.get(k,"")).strip()!="" for k in ("closing_reading","closing_mm","closing_liters"))
    if not has_readings:
        status,current=sb("shifts",params={
            "id":"eq."+shift_id,
            "employee_id":"eq."+eid,
            "status":"eq.active",
            "select":"id"
        })
        if status!=200:return jsonify({"error":current}),status
        if not current:return jsonify({"error":"Active shift not found"}),404
        status,current=sb("shifts",params={
            "id":"eq."+shift_id,
            "employee_id":"eq."+eid,
            "status":"eq.active",
            "select":"id,nozzle_id"
        })
        if status!=200:return jsonify({"error":current}),status
        if not current:return jsonify({"error":"Active shift not found"}),404
        nozzle_id=current[0].get("nozzle_id")
        status,result=sb("shifts",method="PATCH",params={"id":"eq."+shift_id},body={
            "status":"closed",
            "end_time":datetime.now(timezone.utc).isoformat()
        },prefer="return=representation")
        if status>=400:return jsonify({"error":result}),status
        if nozzle_id:
            ns,nr=sb("nozzles",method="PATCH",params={"id":"eq."+nozzle_id},body={"active":False},prefer="return=representation")
            if ns>=400:return jsonify({"error":nr}),ns
        return jsonify(result),200
    try: reading,mm,liters=float(data.get("closing_reading",0)),float(data.get("closing_mm",0)),float(data.get("closing_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid closing readings"}),400
    status,current=sb("shifts",params={
        "id":"eq."+shift_id,
        "employee_id":"eq."+eid,
        "status":"eq.active",
        "select":"id,nozzle_id"
    })
    if status!=200:return jsonify({"error":current}),status
    if not current:return jsonify({"error":"Active shift not found"}),404
    nozzle_id=current[0].get("nozzle_id")
    status,result=rpc("close_shift",{"p_shift_id":shift_id,"p_employee_id":eid,"p_closing_reading":reading,"p_closing_mm":mm,"p_closing_liters":liters})
    if status>=400:return jsonify({"error":result}),status
    if nozzle_id:
        ns,nr=sb("nozzles",method="PATCH",params={"id":"eq."+nozzle_id},body={"active":False},prefer="return=representation")
        if ns>=400:return jsonify({"error":nr}),ns
    return jsonify(result),200

@app.get("/api/sales")
def sales():
    auth=require_login()
    if auth:return auth
    params={"select":"*","order":"sale_time.desc","limit":"500"}
    if session.get("role")!="admin":params["employee_id"]="eq."+session["employee_id"]
    status,rows=sb("sales",params=params)
    return jsonify(rows),status

@app.post("/api/sales")
def create_sale():
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    product=str(data.get("product","")).strip()
    payment=str(data.get("payment_method","cash")).strip().lower()
    try: qty,price=float(data.get("quantity_liters",0)),float(data.get("unit_price",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid quantity or price"}),400
    if not product or qty<=0 or price<0:return jsonify({"error":"Product, positive quantity and valid price are required"}),400
    if payment not in {"cash","card","mobile","other"}:return jsonify({"error":"Invalid payment method"}),400
    shift_id=str(data.get("shift_id","")).strip()
    if not shift_id:return jsonify({"error":"Select an active shift"}),400
    ss,sr=sb("shifts",params={"id":"eq."+shift_id,"employee_id":"eq."+eid,"status":"eq.active","select":"id,nozzle_id","limit":"1"})
    if ss!=200 or not sr:return jsonify({"error":"Selected active shift not found"}),409
    pending_status,pending_rows=sb("handovers",params={"shift_id":"eq."+shift_id,"status":"eq.pending","select":"id","limit":"1"})
    if pending_status==200 and pending_rows:return jsonify({"error":"This shift has a pending handover and cannot record new sales"}),409
    status,result=rpc("record_fuel_sale",{"p_shift_id":shift_id,"p_employee_id":eid,"p_nozzle_id":sr[0]["nozzle_id"],"p_product":product,"p_quantity_liters":qty,"p_unit_price":price,"p_payment_method":payment})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.get("/api/purchases")
def purchases():
    auth=require_admin()
    if auth:return auth
    status_filter=str(request.args.get("status") or "").strip()
    params={"select":"*","order":"purchase_date.desc","limit":"200"}
    if status_filter in ("pending_discharge","discharged","cancelled"):
        params["status"]="eq."+status_filter
    status,rows=sb("purchases",params=params)
    if status != 200:
        return jsonify(rows),status
    for row in rows:
        row["attendant"]=None
    return jsonify(rows),200

@app.get("/api/purchases/<purchase_id>/pdf")
def purchase_pdf(purchase_id):
    auth=require_admin()
    if auth:return auth
    # Generate a minimal valid PDF using only ASCII bytes; avoid runtime font/encoding issues.
    status,rows=sb("purchases",params={"id":"eq."+str(purchase_id),"select":"*","limit":"1"})
    if status!=200:return jsonify(rows),status
    if not rows:return jsonify({"error":"Purchase not found"}),404
    p=rows[0]
    history=p.get("discharge_history") or []
    compartments=p.get("compartment_liters") or []
    def fmt(v):
        try:
            n=float(v)
            return f"{n:,.2f}".rstrip("0").rstrip(".")
        except (TypeError,ValueError):
            return "—"
    def clean(v):
        s=str(v if v is not None and str(v).strip() else "—")
        return s.encode("latin-1","replace").decode("latin-1")
    delivered=sum(float(v or 0) for v in compartments)
    discharged=float(p.get("discharged_quantity_liters") or 0)
    remaining=max(delivered-discharged,0)
    lines=[
        "FUEL SHIFT SYSTEM",
        "PURCHASE HISTORY",
        "",
        "Invoice: "+clean(p.get("invoice_number") or "—"),
        "Product: "+clean(p.get("product") or "—"),
        "Status: "+clean(str(p.get("status") or "Purchase").replace("_"," ")),
        "Purchase date: "+clean(p.get("purchase_date") or p.get("created_at") or "—"),
        "",
        "PURCHASE OVERVIEW",
        "Ordered: "+fmt(p.get("ordered_quantity_liters"))+" L",
        "Delivered: "+fmt(delivered)+" L",
        "Discharged: "+fmt(discharged)+" L",
        "Remaining: "+fmt(remaining)+" L",
        "",
        "TRUCK & DRIVER",
        "Driver: "+clean(p.get("driver_name")),
        "Phone: "+clean(p.get("driver_phone")),
        "Plate: "+clean(p.get("plate_number")),
        "Compartments: "+clean(p.get("truck_compartments") or len(compartments)),
    ]
    for i,v in enumerate(compartments):
        lines.append("Compartment %d: %s L"%(i+1,fmt(v)))
    lines += ["","DISCHARGE HISTORY"]
    if not history:
        lines.append("No discharge operations recorded.")
    for i,e in enumerate(history):
        lines += [
            "Discharge %02d"%(i+1),
            "Date & time: "+clean(e.get("created_at")),
            "Tank: "+clean(e.get("tank_id")),
            "Quantity discharged: "+fmt(e.get("discharged_quantity_liters"))+" L",
            "Tank stock before: "+fmt(e.get("tank_liters_before"))+" L",
            "Expected closing: "+fmt((float(e.get("tank_liters_before"))+float(e.get("discharged_quantity_liters"))) if e.get("tank_liters_before") is not None else None)+" L",
            "Recorded closing: "+(fmt(e.get("tank_stock_recorded_liters"))+" L" if e.get("tank_stock_recorded") else "Not recorded"),
            "Stock status: "+("Stock reconciled" if e.get("tank_stock_recorded") else "Tank stock not recorded"),
        ]
        remark=str(e.get("tank_stock_remark") or "").strip()
        if remark: lines.append("Remark: "+clean(remark))
        lines.append("")
    final_remark=""
    for e in reversed(history):
        if str(e.get("tank_stock_remark") or "").strip():
            final_remark=str(e.get("tank_stock_remark")).strip()
            break
    if not final_remark: final_remark=str(p.get("purchase_remark") or p.get("remark") or "").strip()
    if final_remark:
        lines += ["PURCHASE REMARK",clean(final_remark)]

    def esc_pdf(s):
        return clean(s).replace("\\","\\\\").replace("(","\\(").replace(")","\\)")
    pages=[lines[i:i+45] for i in range(0,len(lines),45)] or [["Purchase"]]
    objects=[]
    objects.append("<< /Type /Catalog /Pages 2 0 R >>")
    objects.append("")
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_numbers=[]
    content_numbers=[]
    next_obj=4
    for _ in pages:
        content_numbers.append(next_obj); page_numbers.append(next_obj+1); next_obj+=2
    objects[1]="<< /Type /Pages /Kids ["+" ".join(str(n)+" 0 R" for n in page_numbers)+"] /Count "+str(len(pages))+" >>"
    for page_no,page_lines in enumerate(pages):
        stream=["q","0.12 0.39 0.92 rg 0 780 612 12 re f","0.08 0.13 0.22 rg BT /F1 18 Tf 42 750 Td ("+esc_pdf(page_lines[0] if page_lines else "Purchase")+" ) Tj ET"]
        y=726
        for line in page_lines[1:]:
            if line and line.upper()==line and len(line)<40:
                stream += ["0.94 0.96 1 rg 42 "+str(y-4)+" 528 18 re f","0.12 0.31 0.72 rg BT /F1 9 Tf 48 "+str(y)+" Td ("+esc_pdf(line)+") Tj ET"]
                y-=25
            elif line=="":
                y-=8
            else:
                stream += ["0.30 0.34 0.40 rg BT /F1 9 Tf 48 "+str(y)+" Td ("+esc_pdf(line)+") Tj ET"]
                y-=15
            if y<45: break
        stream += ["0.45 0.48 0.53 rg BT /F1 7 Tf 42 25 Td (Fuel Shift System - Purchase History) Tj ET","Q"]
        body="\n".join(stream)
        objects.append("<< /Length "+str(len(body.encode("latin-1","replace")))+" >>\nstream\n"+body+"\nendstream")
        objects.append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents "+str(content_numbers[page_no])+" 0 R >>")
    pdf="%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets=[0]
    for n,obj in enumerate(objects,1):
        offsets.append(len(pdf))
        pdf+=str(n)+" 0 obj\n"+obj+"\nendobj\n"
    xref=len(pdf)
    pdf+="xref\n0 "+str(len(objects)+1)+"\n0000000000 65535 f \n"
    for off in offsets[1:]: pdf+=str(off).zfill(10)+" 00000 n \n"
    pdf+="trailer\n<< /Size "+str(len(objects)+1)+" /Root 1 0 R >>\nstartxref\n"+str(xref)+"\n%%EOF"
    from flask import make_response
    response=make_response(pdf.encode("latin-1","replace"))
    response.headers["Content-Type"]="application/pdf"
    response.headers["Content-Disposition"]='attachment; filename="purchase_'+clean(p.get("invoice_number") or purchase_id)+'.pdf"'
    response.headers["Cache-Control"]="no-store"
    return response

@app.post("/api/purchases")
def create_purchase():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    product,tank_id=str(data.get("product","")).strip(),str(data.get("tank_id","")).strip()
    try: qty=float(data.get("quantity_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid quantity"}),400
    try: ordered=float(data.get("ordered_quantity_liters")) if data.get("ordered_quantity_liters") is not None else None
    except (TypeError,ValueError):return jsonify({"error":"Invalid ordered quantity"}),400
    if not product or not tank_id or qty<=0:return jsonify({"error":"Product, tank and positive quantity are required"}),400

    # A purchase must use an explicitly selected active tank matching the product.
    # Never silently assign the first tank for a product.
    tank_status,tank_rows=sb("tanks",params={
        "select":"id,tank_code,product,product_id,active",
        "id":"eq."+tank_id,
        "limit":"1"
    })
    if tank_status!=200:
        return jsonify({"error":"Unable to validate the selected tank"}),tank_status
    if not tank_rows:
        return jsonify({"error":"Selected tank was not found"}),404
    selected_tank=tank_rows[0]
    if selected_tank.get("active") is False:
        return jsonify({"error":"Selected tank is inactive"}),409
    if str(selected_tank.get("product") or "").strip().lower()!=product.lower():
        return jsonify({"error":"Selected tank does not match the selected product"}),409

    compartments=data.get("truck_compartments")
    try: compartments=int(compartments) if compartments is not None else None
    except (TypeError,ValueError):return jsonify({"error":"Invalid truck compartments"}),400
    status,result=rpc("record_pending_fuel_purchase",{
        "p_product":product,
        "p_quantity_liters":qty,
        "p_tank_id":tank_id,
        "p_invoice_number":data.get("invoice_number",""),
        "p_created_by":session["employee_id"],
        "p_ordered_quantity_liters":ordered,
        "p_driver_name":data.get("driver_name",""),
        "p_driver_phone":data.get("driver_phone",""),
        "p_plate_number":data.get("plate_number",""),
        "p_truck_compartments":compartments,
        "p_compartment_liters":data.get("compartment_liters")
    })
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.post("/api/purchases/<purchase_id>/discharge")
def discharge_purchase(purchase_id):
    auth=require_admin()
    if auth:return auth
    try:
        import uuid
        purchase_uuid=str(uuid.UUID(str(purchase_id)))
    except (ValueError,TypeError,AttributeError):
        return jsonify({"error":"Invalid purchase id"}),400
    data=request.get_json(silent=True) or {}
    tank_id=str(data.get("tank_id","")).strip()
    indexes=data.get("compartment_indexes",[])
    tank_liters_before=data.get("tank_liters_before")
    if not tank_id or not isinstance(indexes,list) or not indexes:
        return jsonify({"error":"Tank and at least one compartment are required"}),400
    try:
        tank_uuid=str(uuid.UUID(tank_id))
        indexes=[int(x) for x in indexes]
        tank_liters_before=float(tank_liters_before)
    except (ValueError,TypeError):
        return jsonify({"error":"Invalid tank, compartment selection, or tank liters"}),400
    if tank_liters_before < 0:
        return jsonify({"error":"Tank liters before discharge cannot be negative"}),400
    status,result=rpc("discharge_fuel_purchase",{
        "p_purchase_id":purchase_uuid,
        "p_discharged_by":session["employee_id"],
        "p_tank_id":tank_uuid,
        "p_compartment_indexes":indexes,
        "p_tank_liters_before":tank_liters_before
    })
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.get("/api/inventory-summary")
def inventory_summary():
    auth=require_admin()
    if auth:return auth

    # Inventory reconciliation is based on the tank-movement ledger.
    # Opening/dip movements are snapshot anchors, not additive movements.
    ts,tanks=sb("tanks",params={
        "select":"id,tank_code,product,capacity_liters,current_liters,opening_stock_liters,active",
        "order":"tank_code.asc"
    })
    if ts!=200:return jsonify(tanks),ts

    ms,movement_rows=sb("tank_movements",params={
        "select":"tank_id,movement_type,quantity_liters,created_at",
        "limit":"10000",
        "order":"created_at.asc"
    })
    if ms!=200:return jsonify(movement_rows),ms

    result=[]
    movements_by_tank={}
    for movement in movement_rows:
        tid=str(movement.get("tank_id") or "")
        if tid:
            movements_by_tank.setdefault(tid,[]).append(movement)

    for tank in tanks:
        if not tank.get("active"):continue
        tid=str(tank.get("id"))
        movements=movements_by_tank.get(tid,[])

        # Find the latest physical stock anchor. Everything before it belongs
        # to an older reconciliation period and must not affect current stock.
        anchor=None
        for movement in movements:
            if str(movement.get("movement_type") or "").lower() in ("opening","dip"):
                anchor=movement

        current=float(tank.get("current_liters") or 0)
        if anchor is None:
            result.append({
                "tank_id":tank.get("id"),
                "tank_code":tank.get("tank_code"),
                "product":str(tank.get("product") or ""),
                "capacity_liters":tank.get("capacity_liters"),
                "opening_stock_liters":tank.get("opening_stock_liters"),
                "ledger_anchor_liters":None,
                "ledger_anchor_at":None,
                "purchases_liters":0,
                "sales_liters":0,
                "adjustments_liters":0,
                "current_liters":current,
                "expected_liters":None,
                "stock_difference_liters":None,
                "reconciliation_status":"no_anchor"
            })
            continue

        anchor_at=anchor.get("created_at")
        anchor_liters=float(anchor.get("quantity_liters") or 0)
        purchases=0
        sales=0
        adjustments=0

        for movement in movements:
            if movement is anchor:
                continue
            # The ledger is chronological; only movements after the latest
            # anchor belong to the current stock period.
            if anchor_at and str(movement.get("created_at") or "") <= str(anchor_at):
                continue
            movement_type=str(movement.get("movement_type") or "").lower()
            qty=float(movement.get("quantity_liters") or 0)
            if movement_type=="purchase":
                purchases += qty
            elif movement_type=="sale":
                sales += abs(qty)
            elif movement_type=="adjustment":
                adjustments += qty

        expected=anchor_liters+purchases+adjustments-sales
        result.append({
            "tank_id":tank.get("id"),
            "tank_code":tank.get("tank_code"),
            "product":str(tank.get("product") or ""),
            "capacity_liters":tank.get("capacity_liters"),
            "opening_stock_liters":tank.get("opening_stock_liters"),
            "ledger_anchor_liters":anchor_liters,
            "ledger_anchor_at":anchor_at,
            "purchases_liters":purchases,
            "sales_liters":sales,
            "adjustments_liters":adjustments,
            "current_liters":current,
            "expected_liters":expected,
            "stock_difference_liters":current-expected,
            "reconciliation_status":"reconciled" if abs(current-expected)<0.01 else "difference"
        })

    return jsonify(result),200

@app.get("/api/tank-movements")
def tank_movements():
    auth=require_admin()
    if auth:return auth
    params={
        "select":"id,tank_id,movement_type,quantity_liters,reference_id,notes,created_by,created_at",
        "order":"created_at.asc",
        "limit":"500"
    }
    if request.args.get("tank_id"):
        params["tank_id"]="eq."+request.args["tank_id"]
    if request.args.get("movement_type"):
        params["movement_type"]="eq."+request.args["movement_type"]
    status,rows=sb("tank_movements",params=params)
    if status!=200:return jsonify(rows),status

    tank_status,tank_rows=sb("tanks",params={
        "select":"id,tank_code,product,capacity_liters,current_liters,active",
        "limit":"500"
    })
    if tank_status!=200:return jsonify(tank_rows),tank_status
    product_status,product_rows=sb("products",params={
        "select":"id,name,code_name,color,active",
        "limit":"500"
    })
    if product_status!=200:return jsonify(product_rows),product_status

    tank_map={str(x.get("id")):x for x in tank_rows}
    product_map={str(x.get("id")):x for x in product_rows}
    product_by_name={str(x.get("name","")).strip().lower():x for x in product_rows}

    # Build a chronological running balance. Opening/dip readings are
    # snapshots/anchors, not additive movements. Purchases add stock,
    # sales subtract stock, and adjustments apply their signed quantity.
    balance_by_tank={}
    result=[]
    for row in rows:
        tid=str(row.get("tank_id") or "")
        tank=tank_map.get(tid,{})
        product=product_map.get(str(tank.get("product_id") or ""))
        if not product:
            product=product_by_name.get(str(tank.get("product") or "").strip().lower(),{})
        movement=str(row.get("movement_type") or "").lower()
        qty=float(row.get("quantity_liters") or 0)
        if movement in ("opening","dip"):
            balance=qty
        elif movement=="sale":
            balance=balance_by_tank.get(tid,0)-abs(qty)
        else:
            balance=balance_by_tank.get(tid,0)+qty
        balance_by_tank[tid]=balance
        item=dict(row)
        item.update({
            "tank_code":tank.get("tank_code"),
            "tank_product":tank.get("product"),
            "capacity_liters":tank.get("capacity_liters"),
            "current_liters":tank.get("current_liters"),
            "tank_active":tank.get("active"),
            "product_id":product.get("id") if product else None,
            "product_name":product.get("name") if product else tank.get("product"),
            "product_code":product.get("code_name") if product else tank.get("product"),
            "product_color":product.get("color") if product else None,
            "balance_after":balance
        })
        result.append(item)
    result.reverse()
    return jsonify(result),200

@app.get("/api/handovers")
def handovers():
    auth=require_login()
    if auth:return auth
    params={"select":"*","order":"created_at.desc","limit":"100"}
    status,rows=sb("handovers",params=params)
    if status != 200:
        return jsonify(rows),status
    if session.get("role") != "admin":
        eid=str(session["employee_id"])
        rows=[row for row in rows if str(row.get("from_employee_id"))==eid or str(row.get("to_employee_id"))==eid]

    # Include the source dispenser/tank details on handovers. Attendants only
    # receive their own shifts from /api/shifts, so the receiving attendant
    # cannot otherwise resolve the sender's shift_id to its dispenser.
    shift_ids=[str(row.get("shift_id")) for row in rows if row.get("shift_id")]
    if shift_ids:
        ss,shift_rows=sb("shifts",params={
            "id":"in.("+",".join(shift_ids)+")",
            "select":"id,nozzle_id"
        })
        if ss==200:
            shift_map={str(row.get("id")):row for row in shift_rows}
            nozzle_ids=[str(row.get("nozzle_id")) for row in shift_rows if row.get("nozzle_id")]
            nozzle_map={}
            tank_map={}
            if nozzle_ids:
                ns,nozzle_rows=sb("nozzles",params={
                    "id":"in.("+",".join(nozzle_ids)+")",
                    "select":"id,nozzle_code,tank_id"
                })
                if ns==200:
                    nozzle_map={str(row.get("id")):row for row in nozzle_rows}
                    tank_ids=[str(row.get("tank_id")) for row in nozzle_rows if row.get("tank_id")]
                    if tank_ids:
                        ts,tank_rows=sb("tanks",params={
                            "id":"in.("+",".join(tank_ids)+")",
                            "select":"id,tank_code"
                        })
                        if ts==200:
                            tank_map={str(row.get("id")):row for row in tank_rows}
            for row in rows:
                shift=shift_map.get(str(row.get("shift_id")),{})
                nozzle=nozzle_map.get(str(shift.get("nozzle_id")),{})
                tank=tank_map.get(str(nozzle.get("tank_id")),{})
                row["source_nozzle_code"]=nozzle.get("nozzle_code")
                row["source_tank_id"]=nozzle.get("tank_id")
                row["source_tank_code"]=tank.get("tank_code")
    return jsonify(rows),200

@app.post("/api/shift-takeovers/<takeover_id>/record-sale")
def record_shift_takeover_sale(takeover_id):
    auth=require_login()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    sales=data.get("sales",[])
    if not isinstance(sales,list):
        return jsonify({"error":"Invalid sales entries"}),400
    status,result=rpc("record_shift_takeover_sales",{
        "p_takeover_id":takeover_id,
        "p_employee_id":session["employee_id"],
        "p_sales":sales
    })
    if status>=400:return jsonify(result),status
    return jsonify(result),200

@app.post("/api/shift-takeovers/<takeover_id>/cancel-sale")
def cancel_shift_takeover_sale(takeover_id):
    auth=require_login()
    if auth:return auth
    status,result=rpc("cancel_own_shift_takeover_sales",{
        "p_takeover_id":takeover_id,
        "p_employee_id":session["employee_id"]
    })
    if status>=400:return jsonify(result),status
    return jsonify(result),200

@app.get("/api/shift-takeovers")
def shift_takeovers():
    auth=require_login()
    if auth:return auth
    if session.get("role")!="admin":
        # Use the JSON-returning SECURITY DEFINER function. This avoids the
        # SETOF/composite serialization issue and does not depend on direct
        # table read policies for the attendant.
        status,result=rpc("list_my_shift_takeovers",{
            "p_employee_id":session["employee_id"]
        })
        if status>=400:return jsonify(result),status
        return jsonify(result if isinstance(result,list) else []),200
    params={"select":"*","order":"shift_ended_at.desc","limit":"50"}
    status,rows=sb("shift_takeovers",params=params)
    if status!=200:return jsonify(rows),status
    return jsonify(rows),200

@app.get("/api/sales/confirmations")
def sale_confirmations():
    auth=require_admin()
    if auth:return auth
    status,result=rpc("list_pending_shift_takeover_sales",{})
    if status>=400:return jsonify(result),status
    return jsonify(result if isinstance(result,list) else []),200

@app.get("/api/sales/history")
def sale_history():
    auth=require_admin()
    if auth:return auth
    status,result=rpc("list_confirmed_shift_takeover_sales",{})
    if status>=400:return jsonify(result),status
    return jsonify(result if isinstance(result,list) else []),200

@app.post("/api/sales/confirmations/<takeover_id>/confirm")
def confirm_sale_confirmation(takeover_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    checked=data.get("checked_sale_ids",[])
    if not isinstance(checked,list):return jsonify({"error":"Invalid checked sales"}),400
    status,result=rpc("confirm_shift_takeover_sales",{
        "p_takeover_id":takeover_id,
        "p_admin_id":session["employee_id"],
        "p_checked_sale_ids":checked
    })
    if status>=400:return jsonify(result),status

    # If this individual confirmation completes every shift that started on
    # the same Addis Ababa report date, promote that DSR directly to history.
    # This preserves the two admin confirmation paths: individual sales or
    # the combined DSR card.
    ts,takeover=sb("shift_takeovers",params={
        "id":"eq."+takeover_id,
        "select":"id,shift_id,sales_status",
        "limit":"1"
    })
    if ts==200 and takeover:
        shift_id=takeover[0].get("shift_id")
        ss,shift_rows=sb("shifts",params={
            "id":"eq."+str(shift_id),
            "select":"id,start_time",
            "limit":"1"
        })
        if ss==200 and shift_rows and shift_rows[0].get("start_time"):
            report_day=_local_date_from_iso(shift_rows[0].get("start_time"))
            if report_day:
                snap,serr,sstatus=_daily_confirmation_snapshot(report_day)
                if not serr and snap.get("all_shifts_complete") and snap.get("all_handover_recorded") and snap.get("all_sales_recorded") and snap.get("sales_confirmation_ready"):
                    now=datetime.now(timezone.utc).isoformat()
                    ps,pr=sb("daily_report_confirmations",method="POST",params={"on_conflict":"report_date"},body={
                        "report_date":report_day.isoformat(),
                        "total_sales_liters":snap["total_sales_liters"],
                        "total_sales_amount":snap["total_sales_amount"],
                        "sales_by_method":snap["sales_by_method"],
                        "shift_count":snap["shift_count"],
                        "status":"confirmed",
                        "confirmed_at":now,
                        "confirmed_by":session["employee_id"],
                        "updated_at":now
                    },prefer="resolution=merge-duplicates,return=representation")
                    if ps>=400:
                        return jsonify({"error":pr}),ps
                    # Generate/update the finalized report so selecting the
                    # newly moved DSR history card remains fully functional.
                    rpc("generate_daily_report",{
                        "p_report_date":report_day.isoformat(),
                        "p_generated_by":session["employee_id"]
                    })

    return jsonify(result),200

@app.post("/api/sales/confirmations/<takeover_id>/cancel")
def cancel_sale_confirmation(takeover_id):
    auth=require_admin()
    if auth:return auth
    status,result=rpc("cancel_shift_takeover_sales",{
        "p_takeover_id":takeover_id,
        "p_admin_id":session["employee_id"]
    })
    if status>=400:return jsonify(result),status
    return jsonify(result),200

@app.post("/api/handovers")
def create_handover():
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    try: reading,mm,liters=float(data.get("closing_reading",0)),float(data.get("closing_mm",0)),float(data.get("closing_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid closing readings"}),400
    closing_nozzle_readings=data.get("closing_nozzle_readings",[])
    if not isinstance(closing_nozzle_readings,list) or not closing_nozzle_readings:return jsonify({"error":"Closing reading is required for every dispenser nozzle"}),400
    to_id=str(data.get("to_employee_id","")).strip()
    shift_id=str(data.get("shift_id","")).strip()
    if not shift_id or not to_id:return jsonify({"error":"Shift and receiving user are required"}),400
    status,result=rpc("submit_shift_handover",{"p_shift_id":shift_id,"p_from_employee_id":eid,"p_to_employee_id":to_id,"p_closing_reading":reading,"p_closing_mm":mm,"p_closing_liters":liters,"p_closing_nozzle_readings":closing_nozzle_readings})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.post("/api/handovers/<handover_id>/confirm")
def confirm_handover(handover_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    pin=str(data.get("pin",""))
    if not pin or not pin.isdigit():return jsonify({"error":"Enter your numeric PIN"}),400
    es,er=sb("employees",params={"id":"eq."+eid,"active":"eq.true","select":"id,role,pin_hash"})
    if es!=200 or not er:return jsonify({"error":"Attendant account not found"}),404
    emp=er[0]
    if emp.get("role")!="attendant" or not verify_pin(pin,emp.get("pin_hash","")):return jsonify({"error":"Invalid PIN"}),401

    # The sender already supplied the final dispenser/tank readings. The
    # receiving attendant only confirms those readings with their PIN.
    hs,hr=sb("handovers",params={
        "id":"eq."+handover_id,
        "to_employee_id":"eq."+eid,
        "status":"eq.pending",
        "select":"id,closing_reading,closing_mm,closing_liters,closing_nozzle_readings",
        "limit":"1"
    })
    if hs!=200 or not hr:return jsonify({"error":"Pending handover not found"}),404
    handover=hr[0]
    try:
        reading=float(handover.get("closing_reading") or 0)
        mm=float(handover.get("closing_mm") or 0)
        liters=float(handover.get("closing_liters") or 0)
    except (TypeError,ValueError):
        return jsonify({"error":"Invalid handover closing readings"}),409
    if min(reading,mm,liters)<0:return jsonify({"error":"Handover readings cannot be negative"}),409
    status,result=rpc("confirm_shift_handover",{
        "p_handover_id":handover_id,
        "p_to_employee_id":eid,
        "p_opening_reading":reading,
        "p_opening_mm":mm,
        "p_opening_liters":liters
    })
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.post("/api/handovers/<handover_id>/cancel")
def cancel_handover(handover_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    status,current=sb("handovers",params={
        "id":"eq."+handover_id,
        "status":"eq.pending",
        "select":"id,from_employee_id,to_employee_id"
    })
    if status!=200:return jsonify({"error":current}),status
    if not current:return jsonify({"error":"Pending handover not found"}),404
    handover=current[0]
    if str(eid) not in {str(handover.get("from_employee_id")),str(handover.get("to_employee_id"))}:
        return jsonify({"error":"You are not part of this handover"}),403
    status,result=sb("handovers",method="PATCH",params={"id":"eq."+handover_id,"status":"eq.pending"},body={
        "status":"cancelled"
    },prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

def _local_date_from_iso(value):
    if not value: return None
    try:
        dt=datetime.fromisoformat(str(value).replace("Z","+00:00"))
        if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone(timedelta(hours=3))).date()
    except Exception: return None

def _daily_confirmation_snapshot(report_date):
    next_day=report_date+timedelta(days=1)
    ds=report_date.isoformat()+"T00:00:00+03:00"; de=next_day.isoformat()+"T00:00:00+03:00"
    ss,shifts=sb("shifts",params={"and":"(start_time.gte."+ds+",start_time.lt."+de+")","select":"id,start_time,end_time","order":"start_time.asc","limit":"5000"})
    if ss!=200:return None,{"error":shifts},ss
    if not shifts:return {"date":report_date.isoformat(),"shift_count":0,"completed_shift_count":0,"all_shifts_complete":False,"sales_confirmation_ready":False,"can_confirm":False,"status":None,"total_sales_liters":0,"total_sales_amount":0,"sales_by_method":{}},None,200
    ids=[str(x["id"]) for x in shifts if x.get("id")]; filt="in.("+",".join(ids)+")"
    hs,takeovers=sb("shift_takeovers",params={"shift_id":filt,"select":"id,shift_id,total_sales_liters,total_sales_amount,sales_status,sales_submitted_at","limit":"5000"})
    if hs!=200:return None,{"error":takeovers},hs
    # DSR dispenser count must be based on the physical dispenser hierarchy,
    # not on distinct shift nozzle IDs. The newer dispenser_nozzles table is
    # authoritative for dispenser membership.
    rs,reading_rows=sb("shift_nozzle_readings",params={"shift_id":filt,"select":"shift_id,nozzle_id","limit":"10000"})
    if rs!=200:return None,{"error":reading_rows},rs
    reading_nozzle_ids={str(x.get("nozzle_id")) for x in reading_rows if x.get("nozzle_id")}
    dn_ids="in.("+",".join(reading_nozzle_ids)+")" if reading_nozzle_ids else "in.(00000000-0000-0000-0000-000000000000)"
    ds,dispenser_nozzles=sb("dispenser_nozzles",params={"id":dn_ids,"select":"id,dispenser_id","limit":"10000"})
    if ds!=200:return None,{"error":dispenser_nozzles},ds
    dispenser_ids={str(x.get("dispenser_id")) for x in dispenser_nozzles if x.get("dispenser_id")}
    tids=[str(x["id"]) for x in takeovers if x.get("id")]; sale_rows=[]
    if tids:
        ts,sale_rows=sb("shift_takeover_sales",params={"takeover_id":"in.("+",".join(tids)+")","select":"id,takeover_id,sale_type_id,amount","limit":"10000"})
        if ts!=200:return None,{"error":sale_rows},ts
    st,types=sb("sale_types",params={"select":"id,name","limit":"500"}); type_map={str(x["id"]):str(x.get("name") or "Other") for x in types} if st==200 else {}
    methods={}
    for x in sale_rows:
        m=type_map.get(str(x.get("sale_type_id") or "")) or "Other"; methods[m]=methods.get(m,0)+float(x.get("amount") or 0)
    all_complete=all(x.get("end_time") for x in shifts)
    takeovers_by_shift={}
    for takeover in takeovers:
        sid=str(takeover.get("shift_id") or "")
        if sid:
            takeovers_by_shift.setdefault(sid,[]).append(takeover)
    duplicate_handover_shifts=[
        sid for sid,rows in takeovers_by_shift.items() if len(rows)>1
    ]
    # Keep a single handover mapping only for shifts with exactly one handover.
    # Duplicate handovers are a data-integrity error and must block DSR
    # readiness rather than being silently overwritten.
    takeover_by_shift={
        sid:rows[0] for sid,rows in takeovers_by_shift.items() if len(rows)==1
    }
    sale_count_by_takeover={}
    for row in sale_rows:
        key=str(row.get("takeover_id") or "")
        sale_count_by_takeover[key]=sale_count_by_takeover.get(key,0)+1
    # A DSR is created only after every shift has completed its handover AND
    # has actually recorded at least one sale entry. A duplicate handover for
    # any shift is explicitly blocking because there is no safe way to choose
    # an authoritative handover implicitly.
    missing_handover_shifts=[
        str(x.get("id")) for x in shifts
        if len(takeovers_by_shift.get(str(x.get("id")),[]))==0
    ]
    missing_sales_shifts=[
        str(x.get("id")) for x in shifts
        if len(takeovers_by_shift.get(str(x.get("id")),[]))==1
        and sale_count_by_takeover.get(str(takeovers_by_shift[str(x.get("id"))][0].get("id")),0)==0
    ]
    unsubmitted_sales_shifts=[
        str(x.get("id")) for x in shifts
        if len(takeovers_by_shift.get(str(x.get("id")),[]))==1
        and not bool(takeovers_by_shift[str(x.get("id"))][0].get("sales_submitted_at"))
    ]
    unconfirmed_sales_shifts=[
        str(x.get("id")) for x in shifts
        if len(takeovers_by_shift.get(str(x.get("id")),[]))==1
        and str(takeovers_by_shift[str(x.get("id"))][0].get("sales_status") or "")!="confirmed"
    ]
    all_handover_recorded=(
        len(takeovers)==len(shifts)
        and not duplicate_handover_shifts
        and not missing_handover_shifts
    )
    all_sales_recorded=(
        not missing_handover_shifts
        and not duplicate_handover_shifts
        and not missing_sales_shifts
        and not unsubmitted_sales_shifts
        and all(
            str(t.get("sales_status") or "") in ("pending_admin","confirmed")
            for t in takeovers
        )
        and len(takeovers)==len(shifts)
    )
    dsr_ready=bool(all_complete and all_handover_recorded and all_sales_recorded)
    sales_ready=all(str(x.get("sales_status") or "confirmed")=="confirmed" for x in takeovers) if takeovers and not duplicate_handover_shifts else False
    return {"date":report_date.isoformat(),"shift_count":len(shifts),"completed_shift_count":sum(1 for x in shifts if x.get("end_time")),"dispenser_count":len(dispenser_ids),"all_shifts_complete":all_complete,"all_handover_recorded":all_handover_recorded,"duplicate_handover_shifts":duplicate_handover_shifts,"missing_handover_shifts":missing_handover_shifts,"missing_sales_shifts":missing_sales_shifts,"unsubmitted_sales_shifts":unsubmitted_sales_shifts,"unconfirmed_sales_shifts":unconfirmed_sales_shifts,"all_sales_recorded":all_sales_recorded,"sales_confirmation_ready":sales_ready,"can_confirm":dsr_ready,"status":"pending" if dsr_ready else None,"total_sales_liters":sum(float(x.get("total_sales_liters") or 0) for x in takeovers),"total_sales_amount":sum(methods.values()),"sales_by_method":methods},None,200

@app.get("/api/reports/daily/confirmations")
def daily_report_confirmations():
    auth=require_admin()
    if auth:return auth
    today=(datetime.now(timezone.utc)+timedelta(hours=3)).date(); start=today-timedelta(days=3650)
    ss,shifts=sb("shifts",params={"start_time":"gte."+start.isoformat()+"T00:00:00+03:00","select":"id,start_time,end_time","order":"start_time.asc","limit":"10000"})
    if ss!=200:return jsonify({"error":shifts}),ss
    shifts=[x for x in shifts if _local_date_from_iso(x.get("start_time")) and _local_date_from_iso(x.get("start_time"))<=today]
    es,existing=sb("daily_report_confirmations",params={"report_date":"gte."+start.isoformat(),"select":"id,report_date,status,confirmed_at,confirmed_by","order":"report_date.desc","limit":"5000"})
    if es!=200:return jsonify({"error":existing}),es
    existing=[x for x in existing if str(x.get("report_date") or "")[:10]<=today.isoformat()]
    existing={str(x["report_date"]):x for x in existing}; grouped={}
    for x in shifts:
        d=_local_date_from_iso(x.get("start_time"))
        if d:grouped.setdefault(d,[]).append(x)
    cards=[]
    for d,day_shifts in sorted(grouped.items(),reverse=True):
        snap,err,status=_daily_confirmation_snapshot(d)
        if err:return jsonify(err),status
        row=existing.get(d.isoformat())
        if not snap["all_shifts_complete"] or not snap.get("all_handover_recorded") or not snap.get("all_sales_recorded"):
            # Keep the date out of Pending DSR until every shift has ended,
            # completed handover, and submitted its sale.
            snap["status"]="waiting"
            snap["id"]=(row or {}).get("id")
            cards.append(snap)
            continue
        if row and row.get("status")=="confirmed":
            snap["status"]="confirmed"; snap["confirmed_at"]=row.get("confirmed_at"); snap["confirmed_by"]=row.get("confirmed_by")
        else:
            us,ur=sb("daily_report_confirmations",method="POST",params={"on_conflict":"report_date"},body={"report_date":d.isoformat(),"total_sales_liters":snap["total_sales_liters"],"total_sales_amount":snap["total_sales_amount"],"sales_by_method":snap["sales_by_method"],"shift_count":snap["shift_count"],"status":"pending"},prefer="resolution=merge-duplicates,return=representation")
            if us>=400:return jsonify({"error":ur}),us
            snap["status"]="pending"
            row=(ur[0] if isinstance(ur,list) and ur else row)
        snap["id"]=(row or {}).get("id")
        cards.append(snap)
    return jsonify(cards),200

@app.post("/api/reports/daily/confirmations/<report_date>/confirm")
def confirm_daily_report(report_date):
    auth=require_admin()
    if auth:return auth
    try: report_day=date.fromisoformat(report_date)
    except ValueError:return jsonify({"error":"Invalid date"}),400
    snap,err,status=_daily_confirmation_snapshot(report_day)
    if err:return jsonify(err),status
    if snap["shift_count"]==0:return jsonify({"error":"No shifts started on this date"}),404
    if not snap["all_shifts_complete"]:
        return jsonify({"error":"Daily DSR cannot be confirmed until every shift started on this date has ended.","report_ready":False}),409
    if not snap.get("all_handover_recorded") or not snap.get("all_sales_recorded"):
        return jsonify({"error":"Daily DSR is not ready: every completed shift must finish handover and record its sale first.","report_ready":False}),409

    # A confirmed DSR is terminal. If another click/request reaches this
    # endpoint after confirmation, do not run the confirmation workflow again.
    # The database RPC is also idempotent for concurrent requests, but this
    # guard keeps the normal repeat-click path side-effect free.
    cs,existing=sb("daily_report_confirmations",params={
        "report_date":"eq."+report_date,
        "status":"eq.confirmed",
        "select":"id,report_date,status,confirmed_at,confirmed_by",
        "limit":"1"
    })
    if cs!=200:return jsonify({"error":existing}),cs
    if existing:
        return jsonify({
            "confirmed":True,
            "already_confirmed":True,
            "report_date":report_date,
            "confirmed_at":existing[0].get("confirmed_at"),
            "confirmed_by":existing[0].get("confirmed_by")
        }),200

    # The database function is the atomic approval point. It locks each
    # takeover while confirming its pending sale rows, so concurrent DSR
    # confirmation requests cannot duplicate the underlying confirmed sales.
    gs,generated=rpc("confirm_daily_report_sales",{"p_report_date":report_date,"p_admin_id":session["employee_id"]})
    if gs>=400:return jsonify(generated),gs

    # Re-read the authoritative post-confirmation snapshot. Do not persist
    # the pre-confirmation totals because the RPC may have changed takeover
    # statuses/confirmed sales before the DSR record is finalized.
    final_snap,final_err,final_status=_daily_confirmation_snapshot(report_day)
    if final_err:return jsonify(final_err),final_status
    now=datetime.now(timezone.utc).isoformat()
    us,updated=sb("daily_report_confirmations",method="PATCH",params={"report_date":"eq."+report_date},body={
        "total_sales_liters":final_snap["total_sales_liters"],
        "total_sales_amount":final_snap["total_sales_amount"],
        "sales_by_method":final_snap["sales_by_method"],
        "shift_count":final_snap["shift_count"],
        "status":"confirmed",
        "confirmed_at":now,
        "confirmed_by":session["employee_id"],
        "updated_at":now
    },prefer="return=representation")
    if us>=400:return jsonify(updated),us
    return jsonify({
        "confirmed":True,
        "already_confirmed":False,
        "report_date":report_date,
        "takeovers_confirmed":generated.get("takeovers_confirmed",0) if isinstance(generated,dict) else 0,
        "report":generated.get("report") if isinstance(generated,dict) else generated
    }),200

@app.get("/api/reports/daily")
def daily_report():
    auth=require_admin()
    if auth:return auth
    report_date=request.args.get("date") or date.today().isoformat()
    try:
        report_day=date.fromisoformat(report_date)
    except ValueError:
        return jsonify({"error":"Invalid date"}),400

    # A report day is defined by SHIFT START DATE in Africa/Addis_Ababa.
    # A dispenser can have multiple sequential shifts on the same day.
    next_day=(report_day+timedelta(days=1)).isoformat()
    day_start=report_date+"T00:00:00+03:00"
    day_end=next_day+"T00:00:00+03:00"

    shift_status,day_shifts=sb("shifts",params={
        "and":"(start_time.gte."+day_start+",start_time.lt."+day_end+")",
        "select":"id,employee_id,nozzle_id,start_time,end_time,opening_reading,closing_reading,opening_liters,closing_liters,status,opening_tank_liters",
        "order":"start_time.asc","limit":"5000"
    })
    if shift_status!=200:return jsonify({"error":day_shifts}),shift_status

    # Discharge attribution must use every shift that overlaps the report
    # window, not only shifts that started on the report date. This is important
    # for long-running shifts that cross midnight: a discharge on Oct 5 can still
    # belong to the DSR identified by a shift that started on Oct 3.
    discharge_shift_status,discharge_attribution_shifts=sb("shifts",params={
        "start_time":"lt."+day_end,
        "or":"(end_time.gte."+day_start+",end_time.is.null)",
        "select":"id,employee_id,nozzle_id,start_time,end_time,status",
        "order":"start_time.asc","limit":"5000"
    })
    if discharge_shift_status!=200:
        return jsonify({"error":discharge_attribution_shifts}),discharge_shift_status

    def _parse_aware_dt_for_report(value):
        if not value:
            return None
        try:
            parsed=datetime.fromisoformat(str(value).replace("Z","+00:00"))
            if parsed.tzinfo is None:
                parsed=parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            return None

    report_start_utc=_parse_aware_dt_for_report(day_start)
    report_end_utc=_parse_aware_dt_for_report(day_end)

    def _discharge_belongs_to_dsr_shift(value):
        dt=_parse_aware_dt_for_report(value)
        if not dt:
            return False
        for sh in discharge_attribution_shifts:
            started=_parse_aware_dt_for_report(sh.get("start_time"))
            ended=_parse_aware_dt_for_report(sh.get("end_time"))
            if started and report_start_utc <= started < report_end_utc and started <= dt and (ended is None or dt < ended):
                return True
        return False

    shift_ids=[str(x.get("id")) for x in day_shifts if x.get("id")]
    shift_id_filter="in.("+",".join(shift_ids)+")" if shift_ids else "in.(00000000-0000-0000-0000-000000000000)"

    sales_status,sales_rows=sb("sales",params={
        "shift_id":shift_id_filter,
        "select":"id,shift_id,product,quantity_liters,unit_price,amount,payment_method,sale_time,employee_id,sale_type_id,sale_reason,nozzle_id",
        "order":"sale_time.asc","limit":"10000"
    })
    handover_status,handover_rows=sb("shift_takeovers",params={
        "shift_id":shift_id_filter,
        "select":"id,shift_id,from_employee_id,to_employee_id,shift_started_at,shift_ended_at,total_sales_liters,total_sales_amount,tank_id,tank_opening_liters,tank_closing_liters,tank_sales_liters,tank_variance_liters,tank_variance_pct,sales_status,sales_submitted_at,sales_confirmed_at",
        "order":"shift_ended_at.asc","limit":"5000"
    })
    nozzle_reading_status,nozzle_reading_rows=sb("shift_nozzle_readings",params={
        "shift_id":shift_id_filter,
        "select":"shift_id,nozzle_id,opening_reading,closing_reading,opening_liters,closing_liters,opened_at,closed_at,created_at",
        "order":"created_at.asc","limit":"20000"
    })
    dispenser_nozzle_status,dispenser_nozzle_rows=sb("dispenser_nozzles",params={
        "select":"id,dispenser_id,nozzle_number,nozzle_code,product_id,tank_id,active",
        "order":"dispenser_id.asc,nozzle_number.asc","limit":"5000"
    })
    dispenser_status,dispenser_rows=sb("dispensers",params={
        "select":"id,dispenser_code,active",
        "order":"dispenser_code.asc","limit":"1000"
    })
    all_tank_status,all_tank_rows=sb("tanks",params={
        "select":"id,tank_code,product,capacity_liters,active,opening_stock_liters,current_liters",
        "order":"tank_code.asc","limit":"1000"
    })
    # Fetch purchase records broadly enough to catch a purchase created on
    # an earlier day but discharged during this DSR date. The actual DSR
    # purchase contribution is filtered below by purchase date OR discharge
    # operation date.
    purchases_status,purchase_source_rows=sb("purchases",params={
        "select":"id,product,quantity_liters,supplier,invoice_number,tank_id,purchase_date,discharged_at,status,discharged_quantity_liters,discharge_history",
        "order":"purchase_date.asc","limit":"5000"
    })
    if purchases_status!=200:return jsonify({"error":purchase_source_rows}),purchases_status
    purchase_rows=[]
    for p in purchase_source_rows:
        purchase_date_local=_local_date_from_iso(p.get("purchase_date"))
        has_dsr_discharge=any(
            _discharge_belongs_to_dsr_shift(op.get("discharge_datetime"))
            for op in _json_list(p.get("discharge_history"))
        )
        has_legacy_dsr_discharge=_discharge_belongs_to_dsr_shift(p.get("discharged_at"))
        if purchase_date_local==report_day or has_dsr_discharge or has_legacy_dsr_discharge:
            purchase_rows.append(p)
    if handover_status!=200:return jsonify({"error":handover_rows}),handover_status
    if nozzle_reading_status!=200:return jsonify({"error":nozzle_reading_rows}),nozzle_reading_status
    if dispenser_nozzle_status!=200:return jsonify({"error":dispenser_nozzle_rows}),dispenser_nozzle_status
    if dispenser_status!=200:return jsonify({"error":dispenser_rows}),dispenser_status
    if all_tank_status!=200:return jsonify({"error":all_tank_rows}),all_tank_status
    if purchases_status!=200:return jsonify({"error":purchase_rows}),purchases_status

    handovers_by_shift={}
    for handover in handover_rows:
        sid=str(handover.get("shift_id") or "")
        if sid:
            handovers_by_shift.setdefault(sid,[]).append(handover)
    duplicate_handover_shifts=[sid for sid,rows in handovers_by_shift.items() if len(rows)>1]
    handover_by_shift={sid:rows[0] for sid,rows in handovers_by_shift.items() if len(rows)==1}
    readings_by_shift={}
    for row in nozzle_reading_rows:
        readings_by_shift.setdefault(str(row.get("shift_id")),[]).append(row)

    incomplete_shifts=[]
    unconfirmed_shifts=[]
    for x in day_shifts:
        sid=str(x.get("id"))
        if not x.get("end_time"):
            incomplete_shifts.append(x)
        h=handover_by_shift.get(sid)
        if h and h.get("sales_status")!="confirmed":
            unconfirmed_shifts.append({"shift_id":sid,"sales_status":h.get("sales_status") or "not_recorded"})

    all_handover_recorded=(
        bool(day_shifts)
        and not duplicate_handover_shifts
        and len(handover_by_shift)==len(day_shifts)
    ) if day_shifts else False
    all_sales_recorded=(
        all(
            bool(handover_by_shift.get(str(x.get("id"))))
            and str((handover_by_shift.get(str(x.get("id"))) or {}).get("sales_status") or "")=="confirmed"
            and bool((handover_by_shift.get(str(x.get("id"))) or {}).get("sales_submitted_at"))
            for x in day_shifts
        )
        and not duplicate_handover_shifts
        if day_shifts else False
    )
    report_ready=bool(day_shifts and len(incomplete_shifts)==0 and all_handover_recorded and all_sales_recorded)

    takeover_shift_ids=set(handover_by_shift)
    fuel_sale_rows=[x for x in sales_rows if float(x.get("quantity_liters") or 0)>0]
    direct_fuel_rows=[x for x in fuel_sale_rows if str(x.get("shift_id") or "") not in takeover_shift_ids]
    direct_fuel_liters=sum(float(x.get("quantity_liters") or 0) for x in direct_fuel_rows)
    handover_fuel_liters=sum(float(x.get("total_sales_liters") or 0) for x in handover_rows)
    total_l=direct_fuel_liters+handover_fuel_liters
    total_a=sum(float(x.get("amount") or 0) for x in sales_rows)
    fuel_amount=sum(float(x.get("amount") or 0) for x in fuel_sale_rows)
    other_amount=total_a-fuel_amount
    # DSR purchase volume is the physical volume actually discharged in
    # distinct discharge operations, not the ordered/document quantity.
    # This keeps partial purchases and multi-operation purchases correct.
    total_p=0.0

    by_product={}
    for x in fuel_sale_rows:
        p=x.get("product") or "Unknown"
        row=by_product.setdefault(p,{"liters":0,"amount":0})
        if str(x.get("shift_id") or "") not in takeover_shift_ids:
            row["liters"]+=float(x.get("quantity_liters") or 0)
        row["amount"]+=float(x.get("amount") or 0)
    tank_ids={str(x.get("tank_id")) for x in handover_rows if x.get("tank_id")}
    tank_map={}
    if tank_ids:
        ts,tr=sb("tanks",params={"id":"in.("+",".join(tank_ids)+")","select":"id,tank_code,product"})
        if ts==200:tank_map={str(x.get("id")):x for x in tr}

    for x in handover_rows:
        nozzle_sales=x.get("nozzle_sales_liters") if isinstance(x.get("nozzle_sales_liters"),list) else []
        if nozzle_sales:
            for sale in nozzle_sales:
                p=sale.get("product") or (tank_map.get(str(x.get("tank_id"))) or {}).get("product") or "Unknown"
                row=by_product.setdefault(p,{"liters":0,"amount":0})
                row["liters"]+=float(sale.get("liters_sold") or 0)
                row["amount"]+=float(sale.get("amount") or 0)
        else:
            p=(tank_map.get(str(x.get("tank_id"))) or {}).get("product") or "Unknown"
            row=by_product.setdefault(p,{"liters":0,"amount":0})
            row["liters"]+=float(x.get("total_sales_liters") or 0)
            row["amount"]+=float(x.get("total_sales_amount") or 0)

    # Sales methods come from the configured Admin Settings sale types
    # (for example Card, Cash, Transfer). Keep payment_method as a fallback
    # for older/direct sales records that have no configured sale type.
    sale_type_map={}
    st_status,st_rows=sb("sale_types",params={"select":"id,name","limit":"500"})
    if st_status==200:
        sale_type_map={str(x.get("id")):str(x.get("name") or "Other") for x in st_rows}
    payment_methods={}
    sales_by_type={}
    for x in sales_rows:
        method=sale_type_map.get(str(x.get("sale_type_id") or "")) or str(x.get("payment_method") or "other")
        amount=float(x.get("amount") or 0)
        payment_methods[method]=payment_methods.get(method,0)+amount
        sales_by_type[method]=sales_by_type.get(method,0)+amount


    # Resolve dispenser/tank and employee labels once for both the individual
    # shift cards and the combined-per-dispenser reconciliation.
    dispenser_ids={str(x.get("nozzle_id")) for x in day_shifts if x.get("nozzle_id")}
    dispenser_map={}
    if dispenser_ids:
        ns,nr=sb("nozzles",params={
            "id":"in.("+",".join(dispenser_ids)+")",
            "select":"id,nozzle_code,product,tank_id"
        })
        if ns==200:dispenser_map={str(x.get("id")):x for x in nr}
        dispenser_tank_ids={str(x.get("tank_id")) for x in dispenser_map.values() if x.get("tank_id")}
        missing_tank_ids=dispenser_tank_ids-set(tank_map)
        if missing_tank_ids:
            ts,tr=sb("tanks",params={"id":"in.("+",".join(missing_tank_ids)+")","select":"id,tank_code,product"})
            if ts==200:tank_map.update({str(x.get("id")):x for x in tr})

    employee_ids={str(x.get("employee_id")) for x in sales_rows if x.get("employee_id")}
    employee_ids.update(str(x.get("employee_id")) for x in day_shifts if x.get("employee_id"))
    employee_ids.update(str(x.get("from_employee_id")) for x in handover_rows if x.get("from_employee_id"))
    employee_ids.update(str(x.get("to_employee_id")) for x in handover_rows if x.get("to_employee_id"))
    employee_map={}
    if employee_ids:
        es,er=sb("employees",params={"id":"in.("+",".join(employee_ids)+")","select":"id,name,operator_id"})
        if es==200:employee_map={str(x.get("id")):x for x in er}

    all_tank_ids={str(x.get("tank_id")) for x in handover_rows+purchase_rows if x.get("tank_id")}
    missing=all_tank_ids-set(tank_map)
    if missing:
        ts,tr=sb("tanks",params={"id":"in.("+",".join(missing)+")","select":"id,tank_code,product"})
        if ts==200:tank_map.update({str(x.get("id")):x for x in tr})

    sales_by_shift={}
    for row in sales_rows:
        sales_by_shift.setdefault(str(row.get("shift_id")),[]).append(row)

    # Recorded shift-sale amounts come from the payment-method entries attached
    # to each takeover. These are the amounts the admin actually confirms.
    # Keep the meter-derived amount separately so the DSR can reconcile both
    # values without silently substituting one for the other.
    takeover_sale_amount_by_shift={}
    takeover_sale_methods_by_shift={}
    takeover_shift_map={str(t.get("id")):str(t.get("shift_id")) for t in handover_rows if t.get("id") and t.get("shift_id")}
    if takeover_shift_map:
        tsa,tsr=sb("shift_takeover_sales",params={"takeover_id":"in.("+",".join(takeover_shift_map.keys())+")","select":"takeover_id,sale_type_id,amount","limit":"10000"})
        if tsa==200:
            for row in tsr:
                sid=takeover_shift_map.get(str(row.get("takeover_id") or ""))
                if sid:
                    amount=float(row.get("amount") or 0)
                    takeover_sale_amount_by_shift[sid]=takeover_sale_amount_by_shift.get(sid,0)+amount
                    method=sale_type_map.get(str(row.get("sale_type_id") or "")) or "Other"
                    methods=takeover_sale_methods_by_shift.setdefault(sid,{})
                    methods[method]=methods.get(method,0)+amount

    def sales_methods_for_shift(shift_id):
        recorded=takeover_sale_methods_by_shift.get(str(shift_id))
        if recorded:
            return dict(recorded)
        methods={}
        for sale in sales_by_shift.get(str(shift_id),[]):
            method=sale_type_map.get(str(sale.get("sale_type_id") or "")) or str(sale.get("payment_method") or "other")
            methods[method]=methods.get(method,0)+float(sale.get("amount") or 0)
        return methods

    # Individual shift results are always listed first. For a handover shift,
    # the takeover calculation is the authoritative shift sales result.
    shift_summary=[]
    for x in day_shifts:
        sid=str(x.get("id"))
        from_emp=employee_map.get(str(x.get("employee_id"))) or {}
        h=handover_by_shift.get(sid) or {}
        dispenser=dispenser_map.get(str(x.get("nozzle_id"))) or {}
        tank=tank_map.get(str(dispenser.get("tank_id") or h.get("tank_id"))) or {}
        direct_l=sum(float(v.get("quantity_liters") or 0) for v in sales_by_shift.get(sid,[]) if float(v.get("quantity_liters") or 0)>0)
        shift_l=float(h.get("total_sales_liters") or direct_l)
        calculated_shift_a=float(h.get("total_sales_amount") or sum(float(v.get("amount") or 0) for v in sales_by_shift.get(sid,[])))
        recorded_shift_a=takeover_sale_amount_by_shift.get(sid)
        shift_a=float(recorded_shift_a) if recorded_shift_a is not None else calculated_shift_a
        shift_readings=readings_by_shift.get(sid,[])
        complete_meter_rows=[
            r for r in shift_readings
            if r.get("opening_reading") is not None and r.get("closing_reading") is not None
        ]
        shift_meter_delta=sum(
            float(r.get("closing_reading") or 0)-float(r.get("opening_reading") or 0)
            for r in complete_meter_rows
        )
        shift_meter_reconciles=bool(complete_meter_rows) and abs(shift_meter_delta-shift_l) <= 0.05
        shift_summary.append({
            "shift_id":x.get("id"),
            "dispenser_id":x.get("nozzle_id"),
            "dispenser":dispenser.get("nozzle_code") or "—",
            "attendant":from_emp.get("name") or "Unknown",
            "receiver":(employee_map.get(str(h.get("to_employee_id"))) or {}).get("name") or "—",
            "tank":tank.get("tank_code") or "—",
            "tank_id":dispenser.get("tank_id") or h.get("tank_id"),
            "product":dispenser.get("product") or tank.get("product") or "Unknown",
            "started_at":x.get("start_time"),
            "ended_at":x.get("end_time"),
            "sales_liters":shift_l,
            "meter_delta_liters":shift_meter_delta if complete_meter_rows else None,
            "meter_difference_liters":(shift_l-shift_meter_delta) if complete_meter_rows else None,
            "meter_reconciliation_pct":((shift_l/shift_meter_delta)*100) if complete_meter_rows and shift_meter_delta else None,
            "meter_reconciliation_status":("reconciled" if shift_meter_reconciles else "variance") if complete_meter_rows else "boundary",
            "sales_amount":shift_a,
            "calculated_sales_amount":calculated_shift_a,
            "sales_amount_difference":shift_a-calculated_shift_a if recorded_shift_a is not None else 0,
            "tank_opening_liters":float(h.get("tank_opening_liters") or x.get("opening_tank_liters") or 0),
            "tank_closing_liters":float(h.get("tank_closing_liters") or x.get("closing_liters") or 0),
            "tank_purchases_liters":float(h.get("tank_purchases_liters") or 0),
            "tank_sales_liters":float(h.get("tank_sales_liters") or shift_l),
            "tank_variance_liters":float(h.get("tank_variance_liters") or 0),
            "tank_variance_pct":float(h.get("tank_variance_pct") or 0),
            "opening_readings":[
                {"nozzle_id":r.get("nozzle_id"),"reading":float(r.get("opening_reading") or 0),"liters":float(r.get("opening_liters") or 0)}
                for r in shift_readings
            ],
            "closing_readings":[
                {"nozzle_id":r.get("nozzle_id"),"reading":float(r.get("closing_reading") or 0),"liters":float(r.get("closing_liters") or 0)}
                for r in shift_readings
            ],
            "sales_status":h.get("sales_status") or ("completed" if x.get("end_time") else "in_progress"),
            "sales_submitted_at":h.get("sales_submitted_at"),
            "sales_confirmed_at":h.get("sales_confirmed_at"),
            "sales_by_method":sales_methods_for_shift(sid)
        })

    # Rebuild station payment totals from the same authoritative source used
    # by each shift: confirmed takeover sale entries when available, otherwise
    # direct sales for shifts without a takeover. This prevents payment totals
    # from diverging from the DSR station sales amount.
    payment_methods={}
    sales_by_type={}
    for z in shift_summary:
        for method,amount in (z.get("sales_by_method") or {}).items():
            val=float(amount or 0)
            payment_methods[method]=payment_methods.get(method,0)+val
            sales_by_type[method]=sales_by_type.get(method,0)+val

    # Combined dispenser/day reconciliation:
    # first shift = opening boundary; last shift = closing boundary.
    # Sales are the sum of every individual shift belonging to that dispenser.
    dispenser_groups={}
    shift_by_id={str(x.get("id")):x for x in shift_summary}
    for x in shift_summary:
        key=str(x.get("dispenser_id") or "")
        if not key: continue
        dispenser_groups.setdefault(key,[]).append(x)

    dispenser_summary=[]
    for dispenser_id,items in dispenser_groups.items():
        items.sort(key=lambda z:str(z.get("started_at") or ""))
        first=items[0]
        last=items[-1]
        nozzle=dispenser_map.get(dispenser_id) or {}
        tank_id=nozzle.get("tank_id") or first.get("tank_id") or last.get("tank_id")
        tank=tank_map.get(str(tank_id)) or {}
        combined_sales_l=sum(float(z.get("sales_liters") or 0) for z in items)
        combined_sales_a=sum(float(z.get("sales_amount") or 0) for z in items)
        combined_methods={}
        for z in items:
            for method,amount in (z.get("sales_by_method") or {}).items():
                combined_methods[method]=combined_methods.get(method,0)+float(amount or 0)
        first_openings=first.get("opening_readings") or []
        last_closings=last.get("closing_readings") or []
        dispenser_summary.append({
            "dispenser_id":dispenser_id,
            "dispenser":first.get("dispenser") or "—",
            "product":first.get("product") or tank.get("product") or "Unknown",
            "tank_id":tank_id,
            "tank":tank.get("tank_code") or first.get("tank") or "—",
            "shift_count":len(items),
            "first_shift_id":first.get("shift_id"),
            "first_shift_started_at":first.get("started_at"),
            "last_shift_id":last.get("shift_id"),
            "last_shift_started_at":last.get("started_at"),
            "last_shift_ended_at":last.get("ended_at"),
            "opening_tank_liters":float(first.get("tank_opening_liters") or 0),
            "closing_tank_liters":float(last.get("tank_closing_liters") or 0),
            "tank_change_liters":float(last.get("tank_closing_liters") or 0)-float(first.get("tank_opening_liters") or 0),
            "sales_liters":combined_sales_l,
            "sales_amount":combined_sales_a,
            "sales_by_method":combined_methods,
            "opening_readings":first_openings,
            "closing_readings":last_closings,
            "shifts":[
                {
                    "shift_id":z.get("shift_id"),
                    "attendant":z.get("attendant"),
                    "started_at":z.get("started_at"),
                    "ended_at":z.get("ended_at"),
                    "sales_liters":z.get("sales_liters"),
                    "sales_amount":z.get("sales_amount"),
                    "tank_opening_liters":z.get("tank_opening_liters"),
                    "tank_closing_liters":z.get("tank_closing_liters")
                } for z in items
            ]
        })

    dispenser_summary.sort(key=lambda z:(str(z.get("dispenser") or ""),str(z.get("first_shift_started_at") or "")))

    # Final station-wide total is built from combined dispenser totals, not raw
    # sales rows, so multiple shifts are never double-counted.
    station_methods={}
    station_l=0
    station_a=0
    calculated_station_a=sum(float(z.get("calculated_sales_amount") or z.get("sales_amount") or 0) for z in shift_summary)
    for dispenser in dispenser_summary:
        station_l += float(dispenser.get("sales_liters") or 0)
        station_a += float(dispenser.get("sales_amount") or 0)
        for method,amount in (dispenser.get("sales_by_method") or {}).items():
            station_methods[method]=station_methods.get(method,0)+float(amount or 0)
    station_summary={
        "dispenser_count":len(dispenser_summary),
        "shift_count":len(shift_summary),
        "sales_liters":station_l,
        "sales_amount":station_a,
        "sales_by_method":station_methods,
        "dispensers":[
            {
                "dispenser_id":x.get("dispenser_id"),
                "dispenser":x.get("dispenser"),
                "product":x.get("product"),
                "shift_count":x.get("shift_count"),
                "sales_liters":x.get("sales_liters"),
                "sales_amount":x.get("sales_amount"),
                "sales_by_method":x.get("sales_by_method") or {}
            } for x in dispenser_summary
        ]
    }

    # Detail-only reconciliation model. This is deliberately derived from
    # the existing shift/handover/reading records so the DSR workflow itself
    # remains unchanged.
    dn_by_id={str(x.get("id")):x for x in dispenser_nozzle_rows if x.get("id")}
    dn_by_code={str(x.get("nozzle_code") or ""):x for x in dispenser_nozzle_rows if x.get("nozzle_code")}
    dispenser_by_id={str(x.get("id")):x for x in dispenser_rows if x.get("id")}
    tank_all_by_id={str(x.get("id")):x for x in all_tank_rows if x.get("id")}

    shift_reading_map={}
    for rr in nozzle_reading_rows:
        shift_reading_map.setdefault(str(rr.get("shift_id")),[]).append(rr)

    def _json_list(value):
        return value if isinstance(value,list) else []

    def _shift_nozzle_refs(shift):
        sid=str(shift.get("id") or "")
        refs=[]
        seen=set()
        for rr in shift_reading_map.get(sid,[]):
            nid=str(rr.get("nozzle_id") or "")
            if nid and nid not in seen:
                refs.append(dn_by_id.get(nid) or {})
                seen.add(nid)
        # The shift's primary nozzle is authoritative when present.
        primary_id=str(shift.get("nozzle_id") or "")
        if primary_id and primary_id not in seen:
            dn=dn_by_id.get(primary_id)
            if dn:
                refs.append(dn); seen.add(primary_id)
        for item in _json_list(shift.get("activation_nozzles")):
            code=str((item or {}).get("nozzle_id") or "")
            dn=dn_by_code.get(code)
            if dn and str(dn.get("id")) not in seen:
                refs.append(dn); seen.add(str(dn.get("id")))
        return [x for x in refs if x.get("id")]

    employee_name_map=employee_map

    # Per-nozzle meter boundaries and attendant participation.
    nozzle_stats={}
    nozzle_shift_rows={}
    for sh in day_shifts:
        sid=str(sh.get("id") or "")
        started=sh.get("start_time")
        for dn in _shift_nozzle_refs(sh):
            nid=str(dn.get("id"))
            nozzle_shift_rows.setdefault(nid,[]).append(sh)
            nozzle_stats.setdefault(nid,{
                "nozzle_id":nid,
                "dispenser_id":str(dn.get("dispenser_id") or ""),
                "nozzle_number":dn.get("nozzle_number"),
                "nozzle_code":dn.get("nozzle_code") or "—",
                "tank_id":dn.get("tank_id"),
                "product":(tank_all_by_id.get(str(dn.get("tank_id"))) or {}).get("product") or "Unknown",
                "sales_liters":0.0,
                "sales_amount":0.0,
                "opening_reading":None,
                "closing_reading":None,
                "opening_shift_id":None,
                "closing_shift_id":None,
                "attendant_shifts":[]
            })

    # The confirmed handover snapshot contains authoritative per-nozzle
    # liters/amount and opening/closing readings for the shift.
    handover_by_shift_id={str(x.get("shift_id")):x for x in handover_rows if x.get("shift_id")}
    for sh in day_shifts:
        sid=str(sh.get("id") or "")
        hrow=handover_by_shift_id.get(sid) or {}
        h_open={str((v or {}).get("nozzle_id") or ""):v for v in _json_list(hrow.get("nozzle_opening_readings"))}
        h_close={str((v or {}).get("nozzle_id") or ""):v for v in _json_list(hrow.get("nozzle_closing_readings"))}
        h_sales={str((v or {}).get("nozzle_id") or ""):v for v in _json_list(hrow.get("nozzle_sales_liters"))}
        for dn in _shift_nozzle_refs(sh):
            nid=str(dn.get("id")); code=str(dn.get("nozzle_code") or "")
            stat=nozzle_stats.setdefault(nid,{
                "nozzle_id":nid,"dispenser_id":str(dn.get("dispenser_id") or ""),
                "nozzle_number":dn.get("nozzle_number"),"nozzle_code":code,
                "tank_id":dn.get("tank_id"),"product":"Unknown","sales_liters":0.0,
                "sales_amount":0.0,"opening_reading":None,"closing_reading":None,
                "opening_shift_id":None,"closing_shift_id":None,"attendant_shifts":[]
            })
            sale=h_sales.get(code) or {}
            stat["sales_liters"]+=float(sale.get("liters_sold") or 0)
            stat["sales_amount"]+=float(sale.get("amount") or 0)

            reading_rows=[r for r in shift_reading_map.get(sid,[]) if str(r.get("nozzle_id") or "")==nid]
            if reading_rows:
                rr=reading_rows[-1]
                if rr.get("opening_reading") is not None and stat["opening_reading"] is None:
                    stat["opening_reading"]=float(rr.get("opening_reading"))
                    stat["opening_shift_id"]=sid
                if rr.get("closing_reading") is not None:
                    stat["closing_reading"]=float(rr.get("closing_reading"))
                    stat["closing_shift_id"]=sid
            if stat["opening_reading"] is None and h_open.get(code,{}).get("opening_reading") is not None:
                stat["opening_reading"]=float(h_open[code]["opening_reading"])
                stat["opening_shift_id"]=sid
            if h_close.get(code,{}).get("closing_reading") is not None:
                stat["closing_reading"]=float(h_close[code]["closing_reading"])
                stat["closing_shift_id"]=sid

            emp=employee_name_map.get(str(sh.get("employee_id"))) or {}
            stat["attendant_shifts"].append({
                "shift_id":sid,
                "attendant":emp.get("name") or "Unknown",
                "started_at":sh.get("start_time"),
                "ended_at":sh.get("end_time"),
                "sales_liters":float(sale.get("liters_sold") or 0),
                "sales_amount":float(sale.get("amount") or 0)
            })

    # Re-derive nozzle meter boundaries from chronologically ordered shifts.
    # This keeps the DSR true to the first shift opening and last shift closing
    # even if the underlying shift query order changes.
    for stat in nozzle_stats.values():
        nid=str(stat.get("nozzle_id") or "")
        ordered_shifts=sorted(
            nozzle_shift_rows.get(nid,[]),
            key=lambda z:str(z.get("start_time") or "")
        )
        if ordered_shifts:
            first_shift=ordered_shifts[0]
            last_shift=ordered_shifts[-1]
            first_sid=str(first_shift.get("id") or "")
            last_sid=str(last_shift.get("id") or "")
            first_readings=shift_reading_map.get(first_sid,[])
            last_readings=shift_reading_map.get(last_sid,[])
            first_rr=next((r for r in first_readings if str(r.get("nozzle_id") or "")==nid and r.get("opening_reading") is not None),None)
            last_rr=next((r for r in reversed(last_readings) if str(r.get("nozzle_id") or "")==nid and r.get("closing_reading") is not None),None)
            first_h=handover_by_shift_id.get(first_sid) or {}
            last_h=handover_by_shift_id.get(last_sid) or {}
            first_open={str((v or {}).get("nozzle_id") or ""):v for v in _json_list(first_h.get("nozzle_opening_readings"))}
            last_close={str((v or {}).get("nozzle_id") or ""):v for v in _json_list(last_h.get("nozzle_closing_readings"))}
            code=str(stat.get("nozzle_code") or "")
            if first_rr:
                stat["opening_reading"]=float(first_rr.get("opening_reading"))
                stat["opening_shift_id"]=first_sid
            elif first_open.get(code,{}).get("opening_reading") is not None:
                stat["opening_reading"]=float(first_open[code]["opening_reading"])
                stat["opening_shift_id"]=first_sid
            if last_rr:
                stat["closing_reading"]=float(last_rr.get("closing_reading"))
                stat["closing_shift_id"]=last_sid
            elif last_close.get(code,{}).get("closing_reading") is not None:
                stat["closing_reading"]=float(last_close[code]["closing_reading"])
                stat["closing_shift_id"]=last_sid

        stat["attendant_shifts"].sort(key=lambda z:str(z.get("started_at") or ""))

        # A physical nozzle can have multiple shifts in one DSR, and the meter
        # can legitimately be reset/replaced between shifts. Never calculate
        # the day's meter delta as last_closing - first_opening because that
        # crosses reset boundaries and can produce a false reconciliation gap.
        # Sum each valid shift segment independently instead.
        meter_segments=[]
        for z in ordered_shifts:
            sid=str(z.get("id") or "")
            readings=shift_reading_map.get(sid,[])
            rr=next((r for r in readings if str(r.get("nozzle_id") or "")==nid
                     and r.get("opening_reading") is not None
                     and r.get("closing_reading") is not None),None)
            if not rr:
                h=handover_by_shift_id.get(sid) or {}
                code=str(stat.get("nozzle_code") or "")
                ho={str((v or {}).get("nozzle_id") or ""):v for v in _json_list(h.get("nozzle_opening_readings"))}
                hc={str((v or {}).get("nozzle_id") or ""):v for v in _json_list(h.get("nozzle_closing_readings"))}
                ov=ho.get(code,{}).get("opening_reading")
                cv=hc.get(code,{}).get("closing_reading")
                if ov is not None and cv is not None:
                    rr={"opening_reading":ov,"closing_reading":cv}
            if rr:
                ov=float(rr.get("opening_reading"))
                cv=float(rr.get("closing_reading"))
                segment_delta=cv-ov
                meter_segments.append({
                    "shift_id":sid,
                    "opening_reading":ov,
                    "closing_reading":cv,
                    "meter_delta_liters":segment_delta
                })
        delta=sum(float(x.get("meter_delta_liters") or 0) for x in meter_segments) if meter_segments else None
        stat["meter_segments"]=meter_segments
        stat["meter_delta_liters"]=delta
        stat["meter_difference_liters"]=(float(stat["sales_liters"])-delta) if delta is not None else None
        stat["meter_reconciliation_pct"]=(float(stat["sales_liters"])/delta*100.0) if delta and delta>0 else None

    # Build dispenser -> nozzle hierarchy. A dispenser card contains every
    # configured nozzle that participated in the selected report day.
    dispenser_detail_map={}
    for stat in nozzle_stats.values():
        did=str(stat.get("dispenser_id") or "")
        if not did: continue
        dispenser_detail_map.setdefault(did,{"dispenser_id":did,"dispenser":(dispenser_by_id.get(did) or {}).get("dispenser_code") or "—","nozzles":[],"shift_ids":set(),"attendants":set()})
        dispenser_detail_map[did]["nozzles"].append(stat)
        for z in stat.get("attendant_shifts") or []:
            dispenser_detail_map[did]["shift_ids"].add(str(z.get("shift_id")))
            dispenser_detail_map[did]["attendants"].add(str(z.get("attendant") or "Unknown"))

    dispenser_details=[]
    for did,item in dispenser_detail_map.items():
        item["nozzles"].sort(key=lambda z:int(z.get("nozzle_number") or 999))
        liters_total=sum(float(z.get("sales_liters") or 0) for z in item["nozzles"])
        amount_total=sum(float(z.get("sales_amount") or 0) for z in item["nozzles"])
        for z in item["nozzles"]:
            z["sales_share_pct"]=(float(z.get("sales_liters") or 0)/liters_total*100.0) if liters_total else 0
        first_start=min((str(z.get("started_at") or "") for n in item["nozzles"] for z in n.get("attendant_shifts") or []),default=None)
        last_end=max((str(z.get("ended_at") or "") for n in item["nozzles"] for z in n.get("attendant_shifts") or []),default=None)
        item["sales_liters"]=liters_total
        item["sales_amount"]=amount_total
        item["shift_count"]=len(item["shift_ids"])
        item["attendant_count"]=len(item["attendants"])
        item["attendants"]=sorted(item["attendants"])
        item["first_shift_started_at"]=first_start
        item["last_shift_ended_at"]=last_end
        item["sales_share_pct"]=(liters_total/station_l*100.0) if station_l else 0
        item.pop("shift_ids",None)
        dispenser_details.append(item)

    dispenser_details.sort(key=lambda z:str(z.get("dispenser") or ""))

    # Tank <-> nozzle reconciliation. Roll up authoritative handover nozzle sales by physical tank.\n    # Never join raw sales rows to nozzle rows here because that can multiply totals.\n    tank_nozzle_sales_by_shift={}\n    for sh in day_shifts:\n        sid=str(sh.get("id") or "")\n        hrow=handover_by_shift_id.get(sid) or {}\n        for sale in _json_list(hrow.get("nozzle_sales_liters")):\n            code=str((sale or {}).get("nozzle_id") or "")\n            dn=dn_by_code.get(code) or {}\n            tid=str(dn.get("tank_id") or hrow.get("tank_id") or "")\n            if not tid:\n                continue\n            tank_nozzle_sales_by_shift.setdefault(tid,{})\n            tank_nozzle_sales_by_shift[tid][sid]=tank_nozzle_sales_by_shift[tid].get(sid,0.0)+float((sale or {}).get("liters_sold") or 0)\n\n    # Tank detail: first shift opening, last shift closing, discharged
    # purchases, sales and stock difference for each tank.
    tank_shift_rows={}
    for sh in day_shifts:
        hrow=handover_by_shift_id.get(str(sh.get("id"))) or {}
        tid=str(hrow.get("tank_id") or "")
        if tid:
            tank_shift_rows.setdefault(tid,[]).append((sh,hrow))
    # Use actual discharge operations as the DSR purchase ledger. A purchase
    # may be discharged in multiple operations and into different tanks.
    purchase_by_tank={}
    purchase_adjustment_by_tank={}
    discharge_operations_by_tank={}

    # Discharge operations are attributed by their actual timestamp, not by
    # purchase.shift_id (which may be null for multi-operation purchases).
    # The overlapping shift windows were loaded before purchase filtering so
    # cross-midnight purchases are included in the correct DSR.
    def _parse_aware_dt(value):
        return _parse_aware_dt_for_report(value)

    def _attribute_discharge_to_shift(discharge_datetime):
        dt=_parse_aware_dt(discharge_datetime)
        if not dt:
            return {
                "shift_id":None,
                "shift_started_at":None,
                "shift_ended_at":None,
                "shift_attribution_status":"invalid_timestamp"
            }
        matches=[]
        for sh in discharge_attribution_shifts:
            started=_parse_aware_dt(sh.get("start_time"))
            ended=_parse_aware_dt(sh.get("end_time"))
            if not started:
                continue
            # Half-open interval [start, end) prevents a discharge exactly at
            # a handover boundary from being attributed to both shifts.
            if report_start_utc <= started < report_end_utc and started <= dt and (ended is None or dt < ended):
                matches.append(sh)
        if len(matches)==1:
            sh=matches[0]
            return {
                "shift_id":sh.get("id"),
                "shift_employee_id":sh.get("employee_id"),
                "shift_employee_name":(employee_map.get(str(sh.get("employee_id"))) or {}).get("name") or "Unknown",
                "shift_nozzle_id":sh.get("nozzle_id"),
                "shift_started_at":sh.get("start_time"),
                "shift_ended_at":sh.get("end_time"),
                "shift_status":sh.get("status"),
                "shift_attribution_status":"inside_shift"
            }
        if len(matches)>1:
            return {
                "shift_id":None,
                "shift_started_at":None,
                "shift_ended_at":None,
                "shift_attribution_status":"ambiguous_overlap",
                "overlapping_shift_ids":[str(x.get("id")) for x in matches if x.get("id")]
            }
        return {
            "shift_id":None,
            "shift_started_at":None,
            "shift_ended_at":None,
            "shift_attribution_status":"outside_shift"
        }

    seen_discharge_operations=set()
    for p in purchase_rows:
        history=_json_list(p.get("discharge_history"))
        used_history=False
        for op_index,op in enumerate(history):
            # Attribute every recorded operation for purchases visible in
            # this DSR. Only an operation attributed inside exactly one shift
            # contributes to the physical purchase ledger. Outside/ambiguous/
            # invalid operations remain visible in the audit and never alter
            # station totals.
            tid=str(op.get("tank_id") or "")
            if not tid:
                continue
            discharged=float(op.get("discharged_quantity_liters") or sum(float(v or 0) for v in _json_list(op.get("compartment_liters"))))
            discharge_attribution=_attribute_discharge_to_shift(op.get("discharge_datetime"))
            # Prefer a persisted operation id. For legacy rows, use a stable
            # transaction fingerprint so the same operation represented twice
            # cannot increase the DSR purchase contribution twice.
            operation_id=str(op.get("operation_id") or "").strip()
            if operation_id:
                operation_key="id:"+operation_id
            else:
                fingerprint={
                    "purchase_id":str(p.get("id") or ""),
                    "tank_id":tid,
                    "discharge_datetime":str(op.get("discharge_datetime") or ""),
                    "discharged_liters":round(discharged,6),
                    "compartment_indexes":op.get("compartment_indexes") or [],
                    "compartment_liters":op.get("compartment_liters") or []
                }
                operation_key="fp:"+hashlib.sha256(json.dumps(fingerprint,sort_keys=True,separators=(",",":")).encode()).hexdigest()
            if operation_key in seen_discharge_operations:
                continue
            seen_discharge_operations.add(operation_key)

            before=op.get("tank_liters_before")
            recorded=op.get("tank_stock_recorded_liters")
            stock_adjustment=None
            if before is not None and recorded is not None:
                # Post-discharge physical variance:
                # recorded closing - physical before - delivered.
                stock_adjustment=float(recorded)-float(before)-discharged

            # The discharge RPC also records the difference between the
            # physical tank reading supplied immediately before discharge and
            # the system balance. This is a genuine pre-discharge variance and
            # must remain visible in the DSR equation instead of being hidden
            # inside the purchase quantity.
            pre_discharge_adjustment=float(op.get("system_before_adjustment_liters") or 0)

            if discharge_attribution.get("shift_attribution_status")=="inside_shift":
                purchase_by_tank[tid]=purchase_by_tank.get(tid,0.0)+discharged
                total_operation_adjustment=(pre_discharge_adjustment + (stock_adjustment or 0))
                if abs(total_operation_adjustment)>0.000001:
                    purchase_adjustment_by_tank[tid]=purchase_adjustment_by_tank.get(tid,0.0)+total_operation_adjustment

            discharge_operations_by_tank.setdefault(tid,[]).append({
                "purchase_id":p.get("id"),
                "operation_index":op_index,
                "discharge_datetime":op.get("discharge_datetime"),
                "tank_code":op.get("tank_code"),
                **discharge_attribution,
                "discharged_liters":discharged,
                "tank_liters_before":float(before) if before is not None else None,
                "tank_liters_after":float(op.get("tank_liters_after")) if op.get("tank_liters_after") is not None else None,
                "tank_stock_recorded_liters":float(recorded) if recorded is not None else None,
                "pre_discharge_stock_adjustment_liters":pre_discharge_adjustment,
                "post_discharge_stock_adjustment_liters":stock_adjustment,
                "stock_adjustment_liters":(pre_discharge_adjustment + (stock_adjustment or 0)),
                "compartment_indexes":op.get("compartment_indexes") or [],
            })
            used_history=True

        # Legacy aggregate fallback: only an explicit discharge timestamp and
        # positive discharged quantity can be used. Never infer a discharge
        # from purchase_date alone.
        if not used_history and p.get("discharged_at") and float(p.get("discharged_quantity_liters") or 0)>0:
            if _discharge_belongs_to_dsr_shift(p.get("discharged_at")):
                tid=str(p.get("tank_id") or "")
                if tid:
                    discharged=float(p.get("discharged_quantity_liters") or 0)
                    purchase_by_tank[tid]=purchase_by_tank.get(tid,0.0)+discharged
                    discharge_attribution=_attribute_discharge_to_shift(p.get("discharged_at"))
                    discharge_operations_by_tank.setdefault(tid,[]).append({
                        "purchase_id":p.get("id"),
                        "operation_index":None,
                        "discharge_datetime":p.get("discharged_at"),
                        "tank_code":(tank_all_by_id.get(tid) or {}).get("tank_code"),
                        **discharge_attribution,
                        "discharged_liters":discharged,
                        "tank_liters_before":None,
                        "tank_liters_after":None,
                        "tank_stock_recorded_liters":None,
                        "stock_adjustment_liters":None,
                        "compartment_indexes":[],
                    })

    # Only include tanks that actually participate in this DSR through a
    # shift, a nozzle, or a purchase/discharge recorded for this report date.
    relevant_tank_ids=set(tank_shift_rows.keys()) | set(purchase_by_tank.keys())
    relevant_tank_ids.update(
        str(x.get("tank_id"))
        for x in nozzle_stats.values()
        if x.get("tank_id")
    )

    tank_details=[]
    for tid,tank in tank_all_by_id.items():
        if str(tid) not in relevant_tank_ids:
            continue
        rows=sorted(tank_shift_rows.get(tid,[]),key=lambda z:str(z[0].get("start_time") or ""))
        first_h=rows[0][1] if rows else {}
        last_h=rows[-1][1] if rows else {}
        opening=float(first_h.get("tank_opening_liters") or 0) if rows else float(tank.get("opening_stock_liters") or 0)
        closing=float(last_h.get("tank_closing_liters") or 0) if rows else float(tank.get("current_liters") or 0)
        sales_l=float(sum(float(z[1].get("total_sales_liters") or 0) for z in rows))
        nozzle_sales_l=float(sum(float((tank_nozzle_sales_by_shift.get(tid) or {}).get(str(z[0].get("id") or "")) or 0) for z in rows))
        nozzle_sales_difference_l=sales_l-nozzle_sales_l
        purchased_l=float(purchase_by_tank.get(tid,0))
        stock_adjustment_l=float(purchase_adjustment_by_tank.get(tid,0))
        discharge_operations=discharge_operations_by_tank.get(tid,[])
        purchase_ids=sorted(set(str(x.get("purchase_id")) for x in discharge_operations if x.get("purchase_id")))
        purchase_operation_count=len(discharge_operations)
        purchase_count=len(purchase_ids)
        discharge_inside_shift_liters=sum(
            float(x.get("discharged_liters") or 0)
            for x in discharge_operations
            if x.get("shift_attribution_status")=="inside_shift"
        )
        discharge_outside_shift_liters=sum(
            float(x.get("discharged_liters") or 0)
            for x in discharge_operations
            if x.get("shift_attribution_status")=="outside_shift"
        )
        discharge_ambiguous_shift_liters=sum(
            float(x.get("discharged_liters") or 0)
            for x in discharge_operations
            if x.get("shift_attribution_status")=="ambiguous_overlap"
        )
        discharge_outside_shift_count=sum(
            1 for x in discharge_operations
            if x.get("shift_attribution_status")=="outside_shift"
        )
        discharge_ambiguous_shift_count=sum(
            1 for x in discharge_operations
            if x.get("shift_attribution_status")=="ambiguous_overlap"
        )
        # For multiple shifts on the same tank, the next shift should normally
        # open at the previous shift's closing stock. Any difference is an
        # explicit stock adjustment/gap; do not silently hide it in the DSR.
        opening_adjustment_l=0.0
        continuity_gap_count=0
        for prev_pair,next_pair in zip(rows,rows[1:]):
            prev_close=float(prev_pair[1].get("tank_closing_liters") or 0)
            next_open=float(next_pair[1].get("tank_opening_liters") or 0)
            gap=next_open-prev_close
            if abs(gap)>0.0001:
                continuity_gap_count+=1
                opening_adjustment_l+=gap
        # Authoritative tank equation:
        # opening + discharged purchase + documented adjustments - nozzle sales = closing.
        # Each discharge operation contributes its delivered quantity once. Multiple
        # operations for the same purchase are intentionally summed by operation,
        # while purchase_count/purchase_ids identify the purchase only once.
        # The adjustment captures a genuine physical/documented variance and must
        # remain visible rather than being absorbed into the purchase total.
        expected=opening+opening_adjustment_l+purchased_l+stock_adjustment_l-nozzle_sales_l
        diff=expected-closing
        basis=opening+opening_adjustment_l+purchased_l+stock_adjustment_l
        shift_reconciliation=[]
        running_adjustment=0.0
        for idx,(sh,h) in enumerate(rows):
            sid=str(sh.get("id") or "")
            shift_open=float(h.get("tank_opening_liters") or 0)
            shift_close=float(h.get("tank_closing_liters") or 0)
            shift_sales=float(h.get("tank_sales_liters") or h.get("total_sales_liters") or 0)
            shift_nozzle_sales=float((tank_nozzle_sales_by_shift.get(tid) or {}).get(sid) or 0)
            shift_nozzle_difference=shift_sales-shift_nozzle_sales
            # Attribute each distinct discharge operation to the shift
            # containing its discharge timestamp. A purchase can have multiple
            # legitimate operations: count the purchase entity once at tank
            # level, but include every distinct operation in its responsible
            # shift reconciliation.
            shift_purchase=sum(
                float(op.get("discharged_liters") or 0)
                for op in discharge_operations
                if op.get("shift_attribution_status")=="inside_shift"
                and str(op.get("shift_id") or "")==sid
                and str(op.get("tank_id") or "")==tid
            )
            # Discharge-operation stock adjustments are physical/documented
            # variances tied to the operation. Attribute them to the same
            # responsible shift so shift-level reconciliation uses the same
            # accounting basis as the tank-level equation.
            shift_adjustment=sum(
                (
                    float(op.get("pre_discharge_stock_adjustment_liters") or 0)
                    + float(op.get("post_discharge_stock_adjustment_liters") or 0)
                )
                for op in discharge_operations
                if op.get("shift_attribution_status")=="inside_shift"
                and str(op.get("shift_id") or "")==sid
                and str(op.get("tank_id") or "")==tid
            )
            continuity_adjustment=0.0
            if idx>0:
                prev_close=float(rows[idx-1][1].get("tank_closing_liters") or 0)
                continuity_adjustment=shift_open-prev_close
                running_adjustment+=continuity_adjustment
            # Use authoritative nozzle sales in the stock equation.
            # Tank-reported sales remain visible separately as a reconciliation
            # check and must not replace the physical nozzle-sales ledger.
            shift_expected=shift_open+continuity_adjustment+shift_purchase+shift_adjustment-shift_nozzle_sales
            shift_diff=shift_expected-shift_close
            shift_basis=shift_open+continuity_adjustment+shift_purchase+shift_adjustment
            shift_reconciliation.append({
                "shift_id":sh.get("id"),
                "started_at":sh.get("start_time"),
                "ended_at":sh.get("end_time"),
                "opening_liters":shift_open,
                "closing_liters":shift_close,
                "sales_liters":shift_sales,
                "nozzle_sales_liters":shift_nozzle_sales,
                "nozzle_sales_difference_liters":shift_nozzle_difference,
                "nozzle_reconciliation_pct":(shift_nozzle_sales/shift_sales*100.0) if shift_sales else (100.0 if shift_nozzle_sales == 0 else 0.0),
                "purchase_liters":shift_purchase,
                "documented_stock_adjustment_liters":shift_adjustment,
                "continuity_adjustment_liters":continuity_adjustment,
                "expected_closing_liters":shift_expected,
                "difference_liters":shift_diff,
                "variance_pct":(shift_diff/shift_basis*100.0) if shift_basis else 0,
                "reconciliation_pct":max(0.0,100.0-(abs(shift_diff)/shift_basis*100.0)) if shift_basis else 100.0
            })
        tank_details.append({
            "tank_id":tid,
            "tank":tank.get("tank_code") or "—",
            "product":tank.get("product") or "Unknown",
            "capacity_liters":float(tank.get("capacity_liters") or 0),
            "opening_stock_liters":opening,
            "closing_stock_liters":closing,
            "purchase_discharged_liters":purchased_l,
            "purchase_count":purchase_count,
            "purchase_operation_count":purchase_operation_count,
            "purchase_ids":purchase_ids,
            "documented_stock_adjustment_liters":stock_adjustment_l,
            "pre_discharge_stock_adjustment_liters":sum(float(x.get("pre_discharge_stock_adjustment_liters") or 0) for x in discharge_operations if x.get("shift_attribution_status")=="inside_shift"),
            "post_discharge_stock_adjustment_liters":sum(float(x.get("post_discharge_stock_adjustment_liters") or 0) for x in discharge_operations if x.get("shift_attribution_status")=="inside_shift"),
            "nozzle_sales_liters":nozzle_sales_l,
            "discharge_operation_count":len(discharge_operations),
            "discharge_operations":discharge_operations,
            "discharge_inside_shift_liters":discharge_inside_shift_liters,
            "discharge_outside_shift_liters":discharge_outside_shift_liters,
            "discharge_ambiguous_shift_liters":discharge_ambiguous_shift_liters,
            "discharge_outside_shift_count":discharge_outside_shift_count,
            "discharge_ambiguous_shift_count":discharge_ambiguous_shift_count,
            "discharge_invalid_timestamp_count":sum(1 for x in discharge_operations if x.get("shift_attribution_status")=="invalid_timestamp"),
            "opening_adjustment_liters":opening_adjustment_l,
            "continuity_adjustment_liters":opening_adjustment_l,
            "continuity_gap_count":continuity_gap_count,
            "sales_liters":sales_l,
            "nozzle_sales_liters":nozzle_sales_l,
            "nozzle_sales_difference_liters":nozzle_sales_difference_l,
            "nozzle_reconciliation_pct":(nozzle_sales_l/sales_l*100.0) if sales_l else (100.0 if nozzle_sales_l == 0 else 0.0),
            "expected_closing_liters":expected,
            "difference_liters":diff,
            "variance_pct":(diff/basis*100.0) if basis else 0,
            "reconciliation_pct":max(0.0,100.0-(abs(diff)/basis*100.0)) if basis else 100.0,
            "shift_count":len(rows),
            "shift_reconciliation":shift_reconciliation
        })

    # Sum the already deduplicated physical discharge ledger once per tank.
    total_p=sum(float(v or 0) for v in purchase_by_tank.values())

    sales_type_rows=[]
    total_sales_amount=float(station_a)
    for typ,amount in sorted((sales_by_type or {}).items(),key=lambda z:-float(z[1] or 0)):
        val=float(amount or 0)
        sales_type_rows.append({"type":typ,"amount":val,"percentage":(val/total_sales_amount*100.0) if total_sales_amount else 0})
    product_rows=[]
    for prod,val in sorted((by_product or {}).items(),key=lambda z:-float(z[1].get("liters") or 0)):
        product_rows.append({
            "product":prod,
            "liters":float(val.get("liters") or 0),
            "amount":float(val.get("amount") or 0),
            "percentage":(float(val.get("liters") or 0)/station_l*100.0) if station_l else 0
        })
    tank_diff_total=sum(float(x.get("difference_liters") or 0) for x in tank_details)
    # Discharge attribution is an audit layer only. These totals describe
    # timestamp/shift matching and must never alter the station-wide DSR
    # purchase ledger or tank reconciliation totals.
    discharge_audit_operations=sum(int(x.get("discharge_operation_count") or 0) for x in tank_details)
    discharge_audit_inside=sum(
        1 for tank in tank_details
        for op in (tank.get("discharge_operations") or [])
        if op.get("shift_attribution_status")=="inside_shift"
    )
    discharge_audit_outside=sum(
        1 for tank in tank_details
        for op in (tank.get("discharge_operations") or [])
        if op.get("shift_attribution_status")=="outside_shift"
    )
    discharge_audit_ambiguous=sum(
        1 for tank in tank_details
        for op in (tank.get("discharge_operations") or [])
        if op.get("shift_attribution_status")=="ambiguous_overlap"
    )
    discharge_audit_invalid=sum(
        1 for tank in tank_details
        for op in (tank.get("discharge_operations") or [])
        if op.get("shift_attribution_status")=="invalid_timestamp"
    )
    avg_liters_per_shift=(station_l/len(shift_summary)) if shift_summary else 0
    avg_sales_per_shift=(station_a/len(shift_summary)) if shift_summary else 0
    for disp in dispenser_details:
        disp["average_liters_per_shift"]=(float(disp.get("sales_liters") or 0)/max(1,int(disp.get("shift_count") or 0)))
        disp["average_sales_per_shift"]=(float(disp.get("sales_amount") or 0)/max(1,int(disp.get("shift_count") or 0)))
    dsr_performance={
        "total_sales_liters":station_l,
        "total_sales_amount":station_a,
        "calculated_sales_amount":calculated_station_a,
        "sales_amount_difference":station_a-calculated_station_a,
        "dispenser_count":len(dispenser_details),
        "nozzle_count":len(nozzle_stats),
        "tank_count":len(tank_details),
        "shift_count":len(shift_summary),
        "attendant_count":len({str(x.get("employee_id")) for x in day_shifts if x.get("employee_id")}),
        "average_liters_per_shift":avg_liters_per_shift,
        "average_sales_per_shift":avg_sales_per_shift,
        "tank_difference_liters":tank_diff_total,
        "discharge_attribution":{
            "operation_count":discharge_audit_operations,
            "inside_shift_count":discharge_audit_inside,
            "outside_shift_count":discharge_audit_outside,
            "ambiguous_overlap_count":discharge_audit_ambiguous,
            "invalid_timestamp_count":discharge_audit_invalid,
            "outside_shift_liters":sum(float(x.get("discharge_outside_shift_liters") or 0) for x in tank_details),
            "ambiguous_overlap_liters":sum(float(x.get("discharge_ambiguous_shift_liters") or 0) for x in tank_details),
            "audit_only":True
        },
        "average_nozzle_reconciliation_pct":(
            sum(float(x.get("meter_reconciliation_pct")) for x in nozzle_stats.values() if x.get("meter_reconciliation_pct") is not None)/
            max(1,len([x for x in nozzle_stats.values() if x.get("meter_reconciliation_pct") is not None]))
        ) if nozzle_stats else 0,
        "dispenser_contribution":[
            {"dispenser":x.get("dispenser"),"sales_liters":float(x.get("sales_liters") or 0),"percentage":float(x.get("sales_share_pct") or 0)}
            for x in dispenser_details
        ],
        "sales_method_performance":sales_type_rows,
        "tank_reconciliation":[
            {"tank":x.get("tank"),"difference_liters":float(x.get("difference_liters") or 0),"reconciliation_pct":float(x.get("reconciliation_pct") or 0)}
            for x in tank_details
        ]
    }

    return jsonify({
        "date":report_date,
        "report_ready":report_ready,
        "report_status":"ready" if report_ready else "waiting_for_shifts",
        "completion":{
            "total_shifts":len(day_shifts),
            "completed_shifts":len(day_shifts)-len(incomplete_shifts),
            "incomplete_shift_count":len(incomplete_shifts),
            "unconfirmed_shift_count":len(unconfirmed_shifts)
        },
        "sales":sales_rows,
        "purchases":purchase_rows,
        "handovers":handover_rows,
        "shift_summary":shift_summary,
        "dispenser_summary":dispenser_summary,
        "station_summary":station_summary,
        "tank_details":tank_details,
        "performance":dsr_performance,
        "dsr_performance":dsr_performance,
        "total_purchase_discharged_liters":total_p,
        "total_sales_liters":station_l,
        "total_sales_amount":station_a
    })

@app.post("/api/reports/daily")
def generate_report():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    report_date=data.get("date") or date.today().isoformat()
    try: report_day=date.fromisoformat(report_date)
    except ValueError:return jsonify({"error":"Invalid date"}),400
    day_start=report_date+"T00:00:00+03:00"
    day_end=(report_day+timedelta(days=1)).isoformat()+"T00:00:00+03:00"
    ss,day_shifts=sb("shifts",params={
        "and":"(start_time.gte."+day_start+",start_time.lt."+day_end+")",
        "select":"id,end_time","limit":"5000"
    })
    if ss!=200:return jsonify({"error":day_shifts}),ss
    shift_ids=[str(x.get("id")) for x in day_shifts if x.get("id")]
    if any(not x.get("end_time") for x in day_shifts):
        return jsonify({"error":"Daily report is not ready: all shifts that started on this date must be completed first.","report_ready":False,"total_shifts":len(day_shifts),"completed_shifts":sum(1 for x in day_shifts if x.get("end_time"))}),409
    filt="in.("+",".join(shift_ids)+")" if shift_ids else "in.(00000000-0000-0000-0000-000000000000)"
    hs,day_handovers=sb("shift_takeovers",params={"shift_id":filt,"select":"shift_id,sales_status,sales_submitted_at","limit":"5000"})
    if hs!=200:return jsonify({"error":day_handovers}),hs
    handover_by_shift={str(x.get("shift_id")):x for x in day_handovers if x.get("shift_id")}
    if len(handover_by_shift)!=len(day_shifts):
        return jsonify({"error":"Daily report is not ready: every completed shift must finish handover before the DSR can be generated.","report_ready":False}),409
    if any(str(x.get("sales_status") or "")!="confirmed" or not x.get("sales_submitted_at") for x in day_handovers):
        return jsonify({"error":"Daily report is not ready: every shift sale must be recorded and individually confirmed or confirmed through the DSR.","report_ready":False}),409
    cs,confirmation=sb("daily_report_confirmations",params={"report_date":"eq."+report_date,"status":"eq.confirmed","select":"id","limit":"1"})
    if cs!=200:return jsonify({"error":confirmation}),cs
    if not confirmation:
        return jsonify({"error":"Daily report requires final admin confirmation before it can be generated.","report_ready":False}),409
    status,result=rpc("generate_daily_report",{"p_report_date":report_date,"p_generated_by":session["employee_id"]})
    if status>=400:return jsonify(result),status
    return jsonify(result),201

@app.route("/", defaults={"path":""})
@app.route("/<path:path>")
def frontend(path=""):
    assets=request.environ["workers.env"].ASSETS
    from pyodide.ffi import run_sync
    from flask import Response
    r=run_sync(assets.fetch("https://assets.local/"+path))
    return Response(run_sync(r.bytes()),status=r.status,headers=r.headers)

Default=wsgi.entrypoint(app)