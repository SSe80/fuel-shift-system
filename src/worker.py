from flask import Flask, jsonify, request, session
from workers import wsgi
import os, base64, hmac, secrets
from datetime import datetime, timezone, date
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
        "select":"id,tank_code,product,product_id,capacity_liters,current_mm,current_liters,opening_stock_liters,active,updated_at",
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

    previous=float(tank.get("current_liters") or 0)
    delta=stock-previous
    now=datetime.now(timezone.utc).isoformat()
    event["tank_stock_recorded"]=True
    event["tank_stock_recorded_liters"]=stock
    event["tank_stock_recorded_at"]=now
    event["tank_stock_adjustment_liters"]=delta
    event["tank_stock_remark"]=remark
    history[event_index]=event

    body={"current_liters":stock,"updated_at":now}
    status,result=sb("tanks",method="PATCH",params={"id":"eq."+tank_id},body=body,prefer="return=representation")
    if status>=400:return jsonify(result),status

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

    if "tank_order" in data or "capacity_liters" in data or "active" in data:
        ts, rows = sb("tanks", params={"id":"eq."+tank_id,"select":"id,tank_code,product,capacity_liters,current_liters"})
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

@app.get("/api/reports/daily")
def daily_report():
    auth=require_admin()
    if auth:return auth
    report_date=request.args.get("date") or date.today().isoformat()
    try: date.fromisoformat(report_date)
    except ValueError:return jsonify({"error":"Invalid date"}),400

    sales_status,sales_rows=sb("sales",params={
        "sale_time":"gte."+report_date+"T00:00:00Z",
        "select":"id,shift_id,product,quantity_liters,unit_price,amount,payment_method,sale_time,employee_id,sale_type_id,sale_reason",
        "order":"sale_time.asc","limit":"5000"
    })
    handover_status,handover_rows=sb("shift_takeovers",params={
        "shift_ended_at":"gte."+report_date+"T00:00:00Z",
        "select":"id,shift_id,from_employee_id,to_employee_id,shift_started_at,shift_ended_at,total_sales_liters,total_sales_amount,tank_id,tank_opening_liters,tank_closing_liters,tank_purchases_liters,tank_sales_liters,tank_variance_liters,tank_variance_pct,sales_status,sales_submitted_at,sales_confirmed_at",
        "order":"shift_ended_at.asc","limit":"5000"
    })
    purchases_status,purchase_rows=sb("purchases",params={
        "purchase_date":"gte."+report_date+"T00:00:00Z",
        "select":"id,product,quantity_liters,supplier,invoice_number,tank_id,purchase_date,status",
        "order":"purchase_date.asc","limit":"5000"
    })
    if sales_status==200:sales_rows=[x for x in sales_rows if str(x.get("sale_time",""))[:10]==report_date]
    if handover_status==200:handover_rows=[x for x in handover_rows if str(x.get("shift_ended_at",""))[:10]==report_date]
    if purchases_status==200:purchase_rows=[x for x in purchase_rows if str(x.get("purchase_date",""))[:10]==report_date]
    if sales_status!=200:return jsonify({"error":sales_rows}),sales_status
    if handover_status!=200:return jsonify({"error":handover_rows}),handover_status
    if purchases_status!=200:return jsonify({"error":purchase_rows}),purchases_status

    takeover_shift_ids={str(x.get("shift_id")) for x in handover_rows if x.get("shift_id")}
    fuel_sale_rows=[x for x in sales_rows if float(x.get("quantity_liters") or 0)>0]
    direct_fuel_rows=[x for x in fuel_sale_rows if str(x.get("shift_id") or "") not in takeover_shift_ids]
    direct_fuel_liters=sum(float(x.get("quantity_liters") or 0) for x in direct_fuel_rows)
    handover_fuel_liters=sum(float(x.get("total_sales_liters") or 0) for x in handover_rows)
    total_l=direct_fuel_liters+handover_fuel_liters
    total_a=sum(float(x.get("amount") or 0) for x in sales_rows)
    fuel_amount=sum(float(x.get("amount") or 0) for x in fuel_sale_rows)
    other_amount=total_a-fuel_amount
    total_p=sum(float(x.get("quantity_liters") or 0) for x in purchase_rows)

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
        p=(tank_map.get(str(x.get("tank_id"))) or {}).get("product") or "Unknown"
        row=by_product.setdefault(p,{"liters":0,"amount":0})
        row["liters"]+=float(x.get("total_sales_liters") or 0)

    payment_methods={}
    sales_by_type={}
    for x in sales_rows:
        method=x.get("payment_method") or "other"
        payment_methods[method]=payment_methods.get(method,0)+float(x.get("amount") or 0)
        sale_type=x.get("product") or "Unknown"
        sales_by_type[sale_type]=sales_by_type.get(sale_type,0)+float(x.get("amount") or 0)

    employee_ids={str(x.get("employee_id")) for x in sales_rows if x.get("employee_id")}
    employee_ids.update(str(x.get("from_employee_id")) for x in handover_rows if x.get("from_employee_id"))
    employee_ids.update(str(x.get("to_employee_id")) for x in handover_rows if x.get("to_employee_id"))
    employee_map={}
    if employee_ids:
        es,er=sb("employees",params={"id":"in.("+",".join(employee_ids)+")","select":"id,name,operator_id"})
        if es==200:employee_map={str(x.get("id")):x for x in er}

    all_tank_ids={str(x.get("tank_id")) for x in handover_rows+purchase_rows if x.get("tank_id")}
    if all_tank_ids and not tank_map:
        ts,tr=sb("tanks",params={"id":"in.("+",".join(all_tank_ids)+")","select":"id,tank_code,product"})
        if ts==200:tank_map={str(x.get("id")):x for x in tr}
    elif all_tank_ids:
        missing=all_tank_ids-set(tank_map)
        if missing:
            ts,tr=sb("tanks",params={"id":"in.("+",".join(missing)+")","select":"id,tank_code,product"})
            if ts==200:tank_map.update({str(x.get("id")):x for x in tr})

    shift_summary=[]
    for x in handover_rows:
        from_emp=employee_map.get(str(x.get("from_employee_id"))) or {}
        to_emp=employee_map.get(str(x.get("to_employee_id"))) or {}
        tank=tank_map.get(str(x.get("tank_id"))) or {}
        shift_summary.append({
            "shift_id":x.get("shift_id"),
            "attendant":from_emp.get("name") or "Unknown",
            "receiver":to_emp.get("name") or "—",
            "tank":tank.get("tank_code") or "—",
            "product":tank.get("product") or "Unknown",
            "started_at":x.get("shift_started_at"),
            "ended_at":x.get("shift_ended_at"),
            "sales_liters":float(x.get("total_sales_liters") or 0),
            "sales_amount":float(x.get("total_sales_amount") or 0),
            "tank_opening_liters":float(x.get("tank_opening_liters") or 0),
            "tank_closing_liters":float(x.get("tank_closing_liters") or 0),
            "tank_purchases_liters":float(x.get("tank_purchases_liters") or 0),
            "tank_sales_liters":float(x.get("tank_sales_liters") or 0),
            "tank_variance_liters":float(x.get("tank_variance_liters") or 0),
            "tank_variance_pct":float(x.get("tank_variance_pct") or 0),
            "sales_status":x.get("sales_status"),
            "sales_submitted_at":x.get("sales_submitted_at"),
            "sales_confirmed_at":x.get("sales_confirmed_at")
        })

    return jsonify({"date":report_date,"sales":sales_rows,"purchases":purchase_rows,"handovers":handover_rows,"shift_summary":shift_summary,"tanks_by_id":tank_map,"summary":{
        "sales_liters":total_l,"sales_amount":total_a,"fuel_sales_amount":fuel_amount,"other_sales_amount":other_amount,
        "purchases_liters":total_p,"by_product":by_product,"payment_methods":payment_methods,"sales_by_type":sales_by_type,"completed_shifts":len(handover_rows)
    }})

@app.post("/api/reports/daily")
def generate_report():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    report_date=data.get("date") or date.today().isoformat()
    try: date.fromisoformat(report_date)
    except ValueError:return jsonify({"error":"Invalid date"}),400
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
