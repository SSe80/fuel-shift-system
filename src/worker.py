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
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

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
    if not session.get("employee_id"):
        return jsonify({"error": "Unauthorized"}), 401
    if session.get("role") != "admin":
        return jsonify({"error": "Admin access required"}), 403
    return None

def rpc(name, body):
    return sb("rpc/" + name, method="POST", body=body)

@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "fuel-shift", "database": "supabase"})

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    phone, pin = str(data.get("phone", "")).strip(), str(data.get("pin", ""))
    if not phone or not pin:
        return jsonify({"error": "Phone and PIN are required"}), 400
    status, rows = sb("employees", params={
        "phone": "eq." + phone, "active": "eq.true",
        "select": "id,name,phone,role,pin_hash,active"
    })
    if status != 200 or not rows:
        return jsonify({"error": "Invalid credentials"}), 401
    emp = rows[0]
    if not verify_pin(pin, emp.get("pin_hash", "")):
        return jsonify({"error": "Invalid credentials"}), 401
    session.clear()
    session["employee_id"], session["role"] = emp["id"], emp["role"]
    return jsonify({k: emp[k] for k in ("id","name","phone","role")})

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
        "select": "id,name,phone,role,active"
    })
    if status != 200 or not rows or not rows[0].get("active"):
        session.clear()
        return jsonify({"authenticated": False}), 401
    session["role"] = rows[0]["role"]
    return jsonify({"authenticated": True, "employee": rows[0]})

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
        if not name or not phone or not pin or len(pin) < 4 or not pin.isdigit():
            return jsonify({"error": "Name, phone and a numeric PIN of at least 4 digits are required"}), 400
        status, result = sb("employees", method="POST", body={
            "name": name, "phone": phone, "role": "admin",
            "pin_hash": hash_pin(pin), "active": True
        }, prefer="return=representation")
        if status >= 400:
            return jsonify({"error": {"status": status, "response": result}}), status
        return jsonify(result), 201
    except Exception as exc:
        return jsonify({"error": {"type": type(exc).__name__, "message": str(exc)}}), 500

@app.get("/api/employees")
def employees():
    auth = require_login()
    if auth: return auth
    select = "id,name,phone,role,active,created_at" if session.get("role") == "admin" else "id,name,phone,role"
    params = {"select": select, "order": "name.asc"}
    if session.get("role") != "admin": params["active"] = "eq.true"
    status, rows = sb("employees", params=params)
    return jsonify(rows), status

@app.post("/api/employees")
def create_employee():
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    name, phone, pin = str(data.get("name","")).strip(), str(data.get("phone","")).strip(), str(data.get("pin",""))
    role = str(data.get("role","employee")).strip()
    if role not in ("employee","admin") or not name or not phone or len(pin) < 4 or not pin.isdigit():
        return jsonify({"error":"Valid name, phone, role and numeric PIN are required"}), 400
    status, result = sb("employees", method="POST", body={
        "name":name,"phone":phone,"role":role,"pin_hash":hash_pin(pin),"active":True
    }, prefer="return=representation")
    if status >= 400: return jsonify({"error":result}), status
    return jsonify(result), 201

@app.patch("/api/employees/<employee_id>")
def update_employee(employee_id):
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    body = {}
    if "name" in data: body["name"] = str(data["name"]).strip()
    if "phone" in data: body["phone"] = str(data["phone"]).strip()
    if "active" in data: body["active"] = bool(data["active"])
    if "role" in data:
        role = str(data["role"]).strip()
        if role not in ("employee","admin"): return jsonify({"error":"Invalid role"}), 400
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

@app.get("/api/tanks")
def tanks():
    auth = require_login()
    if auth: return auth
    status, rows = sb("tanks", params={"select":"id,tank_code,product,capacity_liters,current_mm,current_liters,updated_at","order":"tank_code.asc"})
    return jsonify(rows), status

@app.post("/api/tanks")
def create_tank():
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    try:
        capacity,current,mm = float(data.get("capacity_liters",0)),float(data.get("current_liters",0)),float(data.get("current_mm",0))
    except (TypeError,ValueError): return jsonify({"error":"Invalid tank values"}),400
    code,product = str(data.get("tank_code","")).strip(),str(data.get("product","")).strip()
    if not code or not product or capacity <= 0 or current < 0 or current > capacity or mm < 0:
        return jsonify({"error":"Valid tank code, product, capacity and current liters are required"}),400
    status,result=sb("tanks",method="POST",body={"tank_code":code,"product":product,"capacity_liters":capacity,"current_liters":current,"current_mm":mm},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.patch("/api/tanks/<tank_id>")
def update_tank(tank_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    if "current_liters" not in data:return jsonify({"error":"current_liters is required"}),400
    try: liters=float(data["current_liters"]); mm=float(data.get("current_mm",0)); 
    except (TypeError,ValueError): return jsonify({"error":"Invalid inventory values"}),400
    status,result=rpc("adjust_tank_inventory",{"p_tank_id":tank_id,"p_new_liters":liters,"p_new_mm":mm,"p_created_by":session["employee_id"],"p_notes":data.get("notes","Admin inventory adjustment")})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.get("/api/nozzles")
def nozzles():
    auth=require_login()
    if auth:return auth
    params={"select":"id,nozzle_code,product,tank_id,active","order":"nozzle_code.asc"}
    if session.get("role") != "admin": params["active"]="eq.true"
    status,rows=sb("nozzles",params=params)
    return jsonify(rows),status

@app.post("/api/nozzles")
def create_nozzle():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    code,product,tank_id=str(data.get("nozzle_code","")).strip(),str(data.get("product","")).strip(),str(data.get("tank_id","")).strip()
    if not code or not product or not tank_id:return jsonify({"error":"Nozzle code, product and tank are required"}),400
    ts,tr=sb("tanks",params={"id":"eq."+tank_id,"select":"id,product"})
    if ts!=200 or not tr:return jsonify({"error":"Tank not found"}),404
    if product.lower()!=str(tr[0]["product"]).lower():return jsonify({"error":"Nozzle product must match tank product"}),400
    status,result=sb("nozzles",method="POST",body={"nozzle_code":code,"product":product,"tank_id":tank_id,"active":True},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.patch("/api/nozzles/<nozzle_id>")
def update_nozzle(nozzle_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    body={}
    if "active" in data: body["active"]=bool(data["active"])
    if "tank_id" in data:
        tank_id=str(data["tank_id"]).strip()
        ts,tr=sb("tanks",params={"id":"eq."+tank_id,"select":"id,product"})
        if ts!=200 or not tr:return jsonify({"error":"Tank not found"}),404
        body["tank_id"]=tank_id
        if "product" not in data: body["product"]=tr[0]["product"]
    if "product" in data:
        body["product"]=str(data["product"]).strip()
    if "tank_id" in body and "product" in body:
        ts,tr=sb("tanks",params={"id":"eq."+body["tank_id"],"select":"id,product"})
        if ts!=200 or not tr:return jsonify({"error":"Tank not found"}),404
        if body["product"].lower()!=str(tr[0]["product"]).lower():
            return jsonify({"error":"Nozzle product must match tank product"}),400
    if not body:return jsonify({"error":"No changes supplied"}),400
    status,result=sb("nozzles",method="PATCH",params={"id":"eq."+nozzle_id},body=body,prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.get("/api/shifts")
def shifts():
    auth=require_login()
    if auth:return auth
    params={"select":"*","order":"created_at.desc","limit":"100"}
    if session.get("role")!="admin":params["employee_id"]="eq."+session["employee_id"]
    status,rows=sb("shifts",params=params)
    return jsonify(rows),status

@app.post("/api/shifts")
def create_shift():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    employee_id,nozzle_id=str(data.get("employee_id","")).strip(),str(data.get("nozzle_id","")).strip()
    if not employee_id or not nozzle_id:return jsonify({"error":"Employee and nozzle are required"}),400
    es,er=sb("employees",params={"id":"eq."+employee_id,"active":"eq.true","select":"id"})
    ns,nr=sb("nozzles",params={"id":"eq."+nozzle_id,"active":"eq.true","select":"id"})
    if es!=200 or not er:return jsonify({"error":"Active employee not found"}),404
    if ns!=200 or not nr:return jsonify({"error":"Active nozzle not found"}),404
    ss,sr=sb("shifts",params={"employee_id":"eq."+employee_id,"status":"in.(assigned,active)","select":"id","limit":"1"})
    if ss!=200:return jsonify({"error":sr}),ss
    if sr:return jsonify({"error":"Employee already has an assigned or active shift"}),409
    ss,sr=sb("shifts",params={"nozzle_id":"eq."+nozzle_id,"status":"eq.active","select":"id","limit":"1"})
    if ss!=200:return jsonify({"error":sr}),ss
    if sr:return jsonify({"error":"Nozzle already has an active shift"}),409
    status,result=sb("shifts",method="POST",body={"employee_id":employee_id,"nozzle_id":nozzle_id,"status":"assigned","assigned_by":session["employee_id"]},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.post("/api/shifts/<shift_id>/start")
def start_shift(shift_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    try: opening,mm,liters=float(data.get("opening_reading",0)),float(data.get("opening_mm",0)),float(data.get("opening_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid opening readings"}),400
    if min(opening,mm,liters)<0:return jsonify({"error":"Opening readings cannot be negative"}),400
    status,rows=sb("shifts",params={"id":"eq."+shift_id,"employee_id":"eq."+eid,"status":"eq.assigned","select":"id,nozzle_id"})
    if status!=200 or not rows:return jsonify({"error":"Assigned shift not found"}),404
    # Opening readings are a shift snapshot; tank inventory is not silently overwritten here.
    patch={"status":"active","start_time":datetime.now(timezone.utc).isoformat(),"opening_reading":opening,"opening_mm":mm,"opening_liters":liters}
    status,result=sb("shifts",method="PATCH",params={"id":"eq."+shift_id},body=patch,prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.post("/api/shifts/<shift_id>/close")
def close_shift(shift_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    try: reading,mm,liters=float(data.get("closing_reading",0)),float(data.get("closing_mm",0)),float(data.get("closing_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid closing readings"}),400
    status,result=rpc("close_shift",{"p_shift_id":shift_id,"p_employee_id":eid,"p_closing_reading":reading,"p_closing_mm":mm,"p_closing_liters":liters})
    if status>=400:return jsonify({"error":result}),status
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
    ss,sr=sb("shifts",params={"employee_id":"eq."+eid,"status":"eq.active","select":"id,nozzle_id","order":"created_at.desc","limit":"1"})
    if ss!=200 or not sr:return jsonify({"error":"No active shift assigned to this employee"}),409
    pending_status,pending_rows=sb("handovers",params={"shift_id":"eq."+sr[0]["id"],"status":"eq.pending","select":"id","limit":"1"})
    if pending_status==200 and pending_rows:return jsonify({"error":"This shift has a pending handover and cannot record new sales"}),409
    status,result=rpc("record_fuel_sale",{"p_shift_id":sr[0]["id"],"p_employee_id":eid,"p_nozzle_id":sr[0]["nozzle_id"],"p_product":product,"p_quantity_liters":qty,"p_unit_price":price,"p_payment_method":payment})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.get("/api/purchases")
def purchases():
    auth=require_admin()
    if auth:return auth
    status,rows=sb("purchases",params={"select":"*","order":"purchase_date.desc","limit":"200"})
    return jsonify(rows),status

@app.post("/api/purchases")
def create_purchase():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    product,tank_id=str(data.get("product","")).strip(),str(data.get("tank_id","")).strip()
    try: qty=float(data.get("quantity_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid quantity"}),400
    if not product or not tank_id or qty<=0:return jsonify({"error":"Product, tank and positive quantity are required"}),400
    status,result=rpc("record_fuel_purchase",{"p_product":product,"p_quantity_liters":qty,"p_tank_id":tank_id,"p_supplier":data.get("supplier",""),"p_invoice_number":data.get("invoice_number",""),"p_created_by":session["employee_id"]})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.get("/api/tank-movements")
def tank_movements():
    auth=require_admin()
    if auth:return auth
    params={"select":"*","order":"created_at.desc","limit":"300"}
    if request.args.get("tank_id"):params["tank_id"]="eq."+request.args["tank_id"]
    status,rows=sb("tank_movements",params=params)
    return jsonify(rows),status

@app.get("/api/handovers")
def handovers():
    auth=require_login()
    if auth:return auth
    params={"select":"*","order":"created_at.desc","limit":"100"}
    if session.get("role")!="admin":
        eid=session["employee_id"]
        params["or"]="from_employee_id.eq.%s,to_employee_id.eq.%s"%(eid,eid)
    status,rows=sb("handovers",params=params)
    return jsonify(rows),status

@app.post("/api/handovers")
def create_handover():
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    try: reading,mm,liters=float(data.get("closing_reading",0)),float(data.get("closing_mm",0)),float(data.get("closing_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid closing readings"}),400
    to_id=str(data.get("to_employee_id","")).strip()
    shift_id=str(data.get("shift_id","")).strip()
    if not shift_id or not to_id:return jsonify({"error":"Shift and receiving employee are required"}),400
    status,result=rpc("submit_shift_handover",{"p_shift_id":shift_id,"p_from_employee_id":eid,"p_to_employee_id":to_id,"p_closing_reading":reading,"p_closing_mm":mm,"p_closing_liters":liters})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.post("/api/handovers/<handover_id>/confirm")
def confirm_handover(handover_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    try: reading,mm,liters=float(data.get("opening_reading",0)),float(data.get("opening_mm",0)),float(data.get("opening_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid opening readings"}),400
    status,result=rpc("confirm_shift_handover",{"p_handover_id":handover_id,"p_to_employee_id":eid,"p_opening_reading":reading,"p_opening_mm":mm,"p_opening_liters":liters})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),200

@app.get("/api/reports/daily")
def daily_report():
    auth=require_admin()
    if auth:return auth
    report_date=request.args.get("date") or date.today().isoformat()
    try: date.fromisoformat(report_date)
    except ValueError:return jsonify({"error":"Invalid date"}),400
    sales_status,sales_rows=sb("sales",params={"sale_time":"gte."+report_date+"T00:00:00Z","select":"product,quantity_liters,unit_price,amount,payment_method,sale_time,employee_id","order":"sale_time.asc","limit":"1000"})
    if sales_status==200:
        sales_rows=[x for x in sales_rows if str(x.get("sale_time",""))[:10]==report_date]
    purchases_status,purchase_rows=sb("purchases",params={"purchase_date":"gte."+report_date+"T00:00:00Z","select":"product,quantity_liters,supplier,tank_id,purchase_date","order":"purchase_date.asc","limit":"1000"})
    if purchases_status==200:
        purchase_rows=[x for x in purchase_rows if str(x.get("purchase_date",""))[:10]==report_date]
    if sales_status!=200:return jsonify({"error":sales_rows}),sales_status
    if purchases_status!=200:return jsonify({"error":purchase_rows}),purchases_status
    total_l=sum(float(x.get("quantity_liters") or 0) for x in sales_rows)
    total_a=sum(float(x.get("amount") or 0) for x in sales_rows)
    total_p=sum(float(x.get("quantity_liters") or 0) for x in purchase_rows)
    by_product={}
    for x in sales_rows:
        p=x.get("product","Unknown"); by_product.setdefault(p,{"liters":0,"amount":0}); by_product[p]["liters"]+=float(x.get("quantity_liters") or 0); by_product[p]["amount"]+=float(x.get("amount") or 0)
    return jsonify({"date":report_date,"sales":sales_rows,"purchases":purchase_rows,"summary":{"sales_liters":total_l,"sales_amount":total_a,"purchases_liters":total_p,"by_product":by_product}})

@app.post("/api/reports/daily")
def generate_report():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    report_date=data.get("date") or date.today().isoformat()
    try: date.fromisoformat(report_date)
    except ValueError:return jsonify({"error":"Invalid date"}),400
    status,result=rpc("generate_daily_report",{"p_report_date":report_date,"p_generated_by":session["employee_id"]})
    if status>=400:return jsonify({"error":result}),status
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
