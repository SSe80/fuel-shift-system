from flask import Flask, jsonify, request, session, redirect
from workers import wsgi
import os, base64, hmac, secrets, hashlib, json, math, re
from datetime import datetime, timezone, date, timedelta
from functools import wraps
from pyodide.ffi import run_sync, to_js
from js import crypto, Uint8Array, Object, fetch
from supabase_rest import request as sb_request
import drive

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

def _json_safe(value):
    """Convert Worker/Supabase values into JSON-safe primitives."""
    if value is None or isinstance(value,(str,int,float,bool)):
        if isinstance(value,float) and (value != value or value in (float("inf"),float("-inf"))):
            return None
        return value
    if isinstance(value,(datetime,date)):
        return value.isoformat()
    if isinstance(value,dict):
        return {str(k):_json_safe(v) for k,v in value.items()}
    if isinstance(value,(list,tuple,set)):
        return [_json_safe(v) for v in value]
    try:
        return str(value)
    except Exception:
        return None

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

ROLE_SESSION_COOKIE = {
    "admin": "__Host-fuel_admin_session",
    "attendant": "__Host-fuel_attendant_session"
}
# Both role cookies are long-lived. Sessions end through explicit logout or
# the existing account/role validity checks, not an elapsed-time timeout.
ROLE_SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10

def _session_secret_bytes():
    return str(app.secret_key).encode("utf-8")

def _make_role_token(employee_id, role):
    payload = {
        "employee_id": str(employee_id),
        "role": str(role),
        "nonce": secrets.token_urlsafe(12)
    }
    # Role tokens do not expire automatically. Account deactivation and
    # explicit logout still invalidate access.
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_session_secret_bytes(), raw.encode(), hashlib.sha256).hexdigest()
    return raw + "." + sig

def _read_role_token(token, expected_role):
    try:
        raw, sig = str(token or "").rsplit(".", 1)
        expected = hmac.new(_session_secret_bytes(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(raw + "==").decode())
        if payload.get("role") != expected_role:
            return None
        # Ignore legacy token expiry fields so existing attendant sessions
        # remain valid; new tokens are issued without an automatic expiry.
        if not payload.get("employee_id"):
            return None
        return payload
    except Exception:
        return None

def _requested_role():
    role = str(request.headers.get("X-Fuel-Role", "")).strip().lower()
    return role if role in ROLE_SESSION_COOKIE else None

def _load_role_session():
    role = _requested_role()
    if not role:
        session.clear()
        session.modified = False
        return None
    payload = _read_role_token(request.cookies.get(ROLE_SESSION_COOKIE[role]), role)
    session.clear()
    if payload:
        session["employee_id"] = payload["employee_id"]
        session["role"] = role
    session.modified = False
    return payload

@app.before_request
def load_role_session():
    # OAuth endpoints are browser navigations/Google redirects and cannot carry
    # the X-Fuel-Role header used by API fetches. They restore the admin role
    # from its dedicated HttpOnly cookie inside the route instead.
    if request.path in ("/api/drive/oauth/start", "/api/drive/oauth/callback"):
        session.clear()
        session.modified = False
        return
    if request.path.startswith("/api/") and request.path not in ("/api/admin-login", "/api/attendant-login", "/api/login"):
        _load_role_session()


def _load_drive_oauth_admin_session():
    payload = _read_role_token(request.cookies.get(ROLE_SESSION_COOKIE["admin"]), "admin")
    session.clear()
    if payload:
        session["employee_id"] = payload["employee_id"]
        session["role"] = "admin"
    session.modified = False
    return payload

@app.after_request
def prevent_legacy_session_overlap(response):
    if request.path == "/api/drive/oauth/callback":
        response.delete_cookie("__Host-fuel_drive_oauth_state", path="/")
    # Role sessions are independent HttpOnly cookies. Refresh an authenticated
    # attendant cookie on normal API activity so sessions created before this
    # change are migrated to the long-lived, non-expiring token/cookie.
    role = session.get("role")
    employee_id = session.get("employee_id")
    if role in ROLE_SESSION_COOKIE and employee_id and request.path != "/api/logout":
        _set_role_cookie(response, role, employee_id)
    session.modified = False
    response.delete_cookie("__Host-fuel_shift_session", path="/", secure=True, httponly=True, samesite="Lax")
    return response

def _set_role_cookie(response, role, employee_id):
    response.set_cookie(
        ROLE_SESSION_COOKIE[role],
        _make_role_token(employee_id, role),
        max_age=ROLE_SESSION_COOKIE_MAX_AGE,
        secure=True,
        httponly=True,
        samesite="Lax",
        path="/"
    )

def _clear_role_cookie(response, role):
    response.delete_cookie(ROLE_SESSION_COOKIE[role], path="/", secure=True, httponly=True, samesite="Lax")

def _audit_record_locator(path, payload=None):
    """Return a safe table/filter pair for tracked records that can be compared around a mutation."""
    parts = [p for p in (path or "").strip("/").split("/") if p]
    if len(parts) >= 2 and parts[:2] == ["api", "settings"]:
        return "station_settings", {"id": "eq.true"}
    if parts == ["api", "drive", "settings"]:
        return "drive_settings", {"id": "eq.1"}
    # Collection routes have no pre-existing row; their created ID is read
    # from the successful response and used for the after-snapshot.
    if parts == ["api", "products"]:
        return "products", None
    if parts in (["api", "users"], ["api", "employees"]):
        return "employees", None
    if parts == ["api", "tanks"]:
        return "tanks", None
    if parts == ["api", "nozzles"]:
        return "nozzles", None
    if parts == ["api", "sale-types"]:
        return "sale_types", None
    if len(parts) >= 3 and parts[:2] == ["api", "products"] and parts[2] not in ("",):
        return "products", {"id": "eq." + parts[2]}
    if len(parts) >= 3 and parts[:2] in (["api", "users"], ["api", "employees"]):
        return "employees", {"id": "eq." + parts[2]}
    if len(parts) >= 3 and parts[:2] == ["api", "tanks"]:
        return "tanks", {"id": "eq." + parts[2]}
    if len(parts) >= 3 and parts[:2] == ["api", "nozzles"]:
        return "nozzles", {"id": "eq." + parts[2]}
    if len(parts) >= 3 and parts[:2] == ["api", "sale-types"]:
        return "sale_types", {"id": "eq." + parts[2]}
    return None, None


def _audit_fetch_record(table, filters):
    """Fetch one current record for audit comparison; never allow lookup errors to affect the request."""
    try:
        status, rows = sb(table, params=dict(filters, **{"select": "*", "limit": "1"}))
        if status == 200 and rows:
            return _audit_safe_details(rows[0])
    except Exception:
        app.logger.exception("Audit record snapshot failed for %s", table)
    return None


@app.before_request
def snapshot_admin_mutation_before():
    """Capture the current record before an authenticated admin mutation."""
    try:
        if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
            return
        if session.get("role") != "admin" or not session.get("employee_id"):
            return
        path = request.path or ""
        tracked = ("/api/settings", "/api/users", "/api/employees", "/api/products",
                   "/api/tanks", "/api/nozzles", "/api/sale-types", "/api/drive/settings")
        if not any(path == prefix or path.startswith(prefix + "/") for prefix in tracked):
            return
        table, filters = _audit_record_locator(path)
        request.environ["fuel_audit_table"] = table
        request.environ["fuel_audit_filters"] = filters
        request.environ["fuel_audit_before"] = _audit_fetch_record(table, filters) if table and filters else None
    except Exception:
        app.logger.exception("Admin audit pre-mutation snapshot failed")


def _audit_display_label(key):
    return str(key).replace("_", " ").strip().title()


def _audit_display_value(key, value):
    """Format common audit values for a readable spreadsheet cell."""
    low = str(key).lower()
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)) and any(term in low for term in ("price", "amount", "total", "cost", "balance")):
        return "ETB {:,.2f}".format(value)
    if isinstance(value, str):
        text = value
        if "T" in text and (text.endswith("Z") or "+" in text[10:] or text[10:].count(":") >= 2):
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
                if parsed.tzinfo is not None:
                    text = parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            except Exception:
                pass
        return text
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, indent=2)
    return str(value)


def _audit_format_details(details):
    """Keep spreadsheet audit cells concise: list only meaningful field changes."""
    lines = []
    changes = details.get("changed_fields")
    ignored_fields = {"updated_at", "created_at"}

    if isinstance(changes, dict):
        meaningful = [(key, value) for key, value in changes.items()
                      if str(key).lower() not in ignored_fields]
        if meaningful:
            lines.append("CHANGED FIELDS")
            for key, change in meaningful:
                label = _audit_display_label(key)
                if isinstance(change, dict) and ("before" in change or "after" in change):
                    before = _audit_display_value(key, change.get("before"))
                    after = _audit_display_value(key, change.get("after"))
                    lines.append("Field: {}".format(label))
                    lines.append("Before: {}".format(before))
                    lines.append("After: {}".format(after))
                else:
                    lines.append("{}: {}".format(label, _audit_display_value(key, change)))

    # Failed attempts may not produce a changed-field diff. Keep the submitted
    # values only in that case, so successful updates do not repeat the same data.
    if not lines and details.get("submitted_changes") not in (None, {}, []):
        submitted = details["submitted_changes"]
        lines.append("SUBMITTED VALUES")
        if isinstance(submitted, dict):
            for key, value in submitted.items():
                lines.append("{}: {}".format(_audit_display_label(key), _audit_display_value(key, value)))
        else:
            lines.append(_audit_display_value("submitted_changes", submitted))

    if "error" in details:
        if lines:
            lines.append("")
        lines.append("ERROR")
        error = details["error"]
        lines.append(error if isinstance(error, str) else json.dumps(error, ensure_ascii=False, indent=2))

    if not lines:
        lines.append("No persisted field changes detected")

    return "\n".join(lines)[:12000]


def _audit_safe_details(value):
    """Remove credentials and PIN material before sending admin change details to Sheets."""
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            low = str(key).lower()
            if any(term in low for term in ("pin", "password", "secret", "token", "hash", "credential", "private", "api_key", "authorization", "service_account")):
                out[str(key)] = "[redacted]"
            else:
                out[str(key)] = _audit_safe_details(item)
        return out
    if isinstance(value, list):
        return [_audit_safe_details(item) for item in value[:100]]
    if isinstance(value, str):
        return value[:500]
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return str(value)[:500]


@app.after_request
def audit_admin_settings_mutations(response):
    """Best-effort audit trail for admin mutation attempts, including before/after state.
    The application response is preserved even if snapshots or Google Sheets are unavailable.
    """
    try:
        if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
            return response
        # Record both successful changes and rejected/failed mutation attempts.
        # Requests that never reached a valid admin session are intentionally excluded.
        if response.status_code < 200:
            return response
        if session.get("role") != "admin" or not session.get("employee_id"):
            return response
        path = request.path or ""
        tracked = ("/api/settings", "/api/users", "/api/employees", "/api/products",
                   "/api/tanks", "/api/nozzles", "/api/sale-types", "/api/drive/settings")
        if not any(path == prefix or path.startswith(prefix + "/") for prefix in tracked):
            return response

        config_status, config_rows = sb("drive_settings", params={
            "id": "eq.1",
            "select": "admin_audit_folder_id,admin_audit_sheet_id"
        })
        if config_status >= 400 or not config_rows:
            return response
        config = config_rows[0]
        folder_id = config.get("admin_audit_folder_id")
        if not folder_id:
            return response

        actor_record_id = str(session.get("employee_id"))
        actor_id = actor_record_id
        actor_name = actor_record_id
        actor_status, actor_rows = sb("employees", params={
            "id": "eq." + actor_record_id, "select": "id,name,operator_id,role", "limit": "1"
        })
        if actor_status == 200 and actor_rows:
            actor = actor_rows[0]
            actor_name = str(actor.get("name") or actor_record_id)
            # The audit sheet's Admin ID column should show the human-facing
            # operator ID, not the internal employee UUID.
            actor_id = str(actor.get("operator_id") or actor_record_id)

        raw = request.get_json(silent=True)
        submitted = _audit_safe_details(raw if isinstance(raw, (dict, list)) else {})
        details = {"submitted_changes": submitted}
        result_label = "Success" if 200 <= response.status_code < 300 else "Failed"
        if result_label == "Failed":
            # Capture a sanitized API error for investigation, without changing
            # the original response or allowing audit logging to affect the request.
            try:
                error_payload = response.get_json(silent=True)
            except Exception:
                error_payload = None
            if isinstance(error_payload, (dict, list)):
                details["error"] = _audit_safe_details(error_payload)
            else:
                details["error"] = "Request failed; response body unavailable"

        # Compare persisted state before and after the request. For create routes,
        # discover the new record ID from the API response and then fetch it.
        table = request.environ.get("fuel_audit_table")
        filters = request.environ.get("fuel_audit_filters")
        before = request.environ.get("fuel_audit_before")
        after = None
        try:
            response_payload = response.get_json(silent=True)
        except Exception:
            response_payload = None
        if table and filters:
            after_filters = filters
            if request.method == "POST" and not any(k == "id" for k in filters):
                created = response_payload[0] if isinstance(response_payload, list) and response_payload else response_payload
                if isinstance(created, dict) and created.get("id"):
                    after_filters = {"id": "eq." + str(created["id"])}
            after = _audit_fetch_record(table, after_filters)
        elif request.method == "POST" and 200 <= response.status_code < 300 and isinstance(response_payload, (dict, list)):
            created = response_payload[0] if isinstance(response_payload, list) and response_payload else response_payload
            if isinstance(created, dict) and created.get("id"):
                table, filters = _audit_record_locator(path)
                if table:
                    after = _audit_fetch_record(table, {"id": "eq." + str(created["id"])})

        if before is not None or after is not None:
            details["before"] = before
            details["after"] = after
            if isinstance(before, dict) and isinstance(after, dict):
                keys = sorted(set(before) | set(after))
                changes = {}
                for key in keys:
                    if before.get(key) != after.get(key):
                        changes[key] = {"before": before.get(key), "after": after.get(key)}
                if changes:
                    details["changed_fields"] = changes
            elif before is None and after is not None:
                details["changed_fields"] = {"record": {"before": None, "after": after}}
            elif before is not None and after is None and request.method == "DELETE" and 200 <= response.status_code < 300:
                details["changed_fields"] = {"record": {"before": before, "after": None}}

        details = _audit_safe_details(details)
        method_action = {"POST": "Created", "PUT": "Updated", "PATCH": "Updated", "DELETE": "Deleted"}.get(request.method, request.method.title())
        parts = [part for part in path.strip("/").split("/") if part]
        resource_key = parts[1] if len(parts) > 1 and parts[0] == "api" else (parts[0] if parts else "settings")
        resource_labels = {
            "settings": "Station Settings",
            "drive": "Google Drive Settings",
            "products": "Product",
            "users": "User",
            "employees": "Employee",
            "tanks": "Tank",
            "nozzles": "Dispenser",
            "sale-types": "Sale Type",
        }
        resource_label = resource_labels.get(resource_key, _audit_display_label(resource_key))
        if resource_key == "drive":
            resource_label = "Google Drive Settings"
        elif resource_key == "settings":
            resource_label = "Station Settings"

        # Turn field-level state changes into plain-language audit actions.
        # Ignore timestamp-only metadata when deciding what the action means.
        changes = details.get("changed_fields")
        meaningful_changes = {
            str(key): value for key, value in changes.items()
            if str(key).lower() not in ("updated_at", "created_at")
        } if isinstance(changes, dict) else {}
        active_change = meaningful_changes.get("active")
        if isinstance(active_change, dict) and "before" in active_change and "after" in active_change:
            before_active, after_active = active_change.get("before"), active_change.get("after")
            if before_active is True and after_active is False:
                action = "Deactivated {}".format(resource_label)
            elif before_active is False and after_active is True:
                action = "Activated {}".format(resource_label)
            else:
                action = "{} {}".format(method_action, resource_label)
        elif request.method == "POST":
            action = "Created {}".format(resource_label)
        elif request.method == "DELETE":
            action = "Deleted {}".format(resource_label)
        elif request.method in ("PUT", "PATCH") and len(meaningful_changes) == 1:
            field_key = next(iter(meaningful_changes))
            field_label = _audit_display_label(field_key)
            action_field_labels = {
                "selling_price": "Selling Price",
                "purchase_price": "Purchase Price",
                "price": "Price",
                "name": "Name",
                "phone": "Phone Number",
                "role": "Role",
                "operator_id": "Operator ID",
                "tank_code": "Tank Code",
                "nozzle_code": "Dispenser Code",
                "active": "Status",
                "description": "Description",
                "reason_required": "Reason Requirement",
            }
            field_label = action_field_labels.get(field_key.lower(), field_label)
            action = "Changed {} {}".format(resource_label, field_label)
        elif request.method in ("PUT", "PATCH") and meaningful_changes:
            action = "Updated {} Details".format(resource_label)
        else:
            action = "{} {}".format(method_action, resource_label)

        # Prefer a meaningful record name/code over a route UUID. Collection
        # routes use the created response/snapshot; record routes use the
        # persisted before/after snapshot, then submitted values as fallback.
        target = {
            "settings": "Station Configuration",
            "drive": "Drive Configuration",
        }.get(resource_key)
        record_candidates = [after, before]
        if isinstance(response_payload, dict):
            record_candidates.append(response_payload)
        if isinstance(submitted, dict):
            record_candidates.append(submitted)
        identity_fields = (
            "name", "product_name", "employee_name", "tank_code", "nozzle_code",
            "sale_type_name", "code_name", "operator_id", "phone"
        )
        for candidate in record_candidates:
            if not isinstance(candidate, dict):
                continue
            identity = next((str(candidate.get(key)).strip() for key in identity_fields
                             if candidate.get(key) not in (None, "")), "")
            if identity:
                target = identity
                code_name = candidate.get("code_name")
                if code_name and str(code_name).strip() != identity:
                    target = "{} ({})".format(identity, str(code_name).strip())
                break
        if not target:
            if len(parts) >= 3 and parts[2]:
                target = "{} record".format(resource_label)
            else:
                target = resource_label
        timestamp = datetime.now(timezone.utc).isoformat()
        row = [timestamp, actor_name, actor_id, action, target,
               _audit_format_details(details),
               result_label + " (HTTP " + str(response.status_code) + ")", path]
        sheet_id = drive.append_audit_row(env(), folder_id, config.get("admin_audit_sheet_id"), row)
        if not config.get("admin_audit_sheet_id") and sheet_id:
            sb("drive_settings", method="PATCH", params={"id": "eq.1"},
               body={"admin_audit_sheet_id": sheet_id, "updated_at": timestamp})
    except Exception:
        app.logger.exception("Admin audit sheet append failed")
    return response


def require_login():
    role = _requested_role()
    if not role or not session.get("employee_id") or session.get("role") != role:
        return jsonify({"error": "Unauthorized"}), 401
    return None

def require_admin():
    if not session.get("employee_id") or session.get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401

    # Refresh the role from Supabase on every protected admin request.
    status, rows = sb("employees", params={
        "id": "eq." + str(session.get("employee_id")),
        "select": "id,role,active",
        "limit": "1"
    })
    if status != 200:
        return jsonify({"error": "Unable to verify the current session"}), 503
    if not rows or not rows[0].get("active"):
        session.clear()
        return jsonify({"error": "Unauthorized"}), 401

    session["role"] = rows[0].get("role")
    if session["role"] != "admin":
        return jsonify({"error": "Admin access required"}), 403
    return None

def rpc(name, body):
    return sb("rpc/" + name, method="POST", body=body)


def _inbox_now():
    return datetime.now(timezone.utc).isoformat()

def _inbox_key_is_valid(value):
    value=str(value or "")
    return bool(value) and len(value)<=180 and all(c.isalnum() or c in "-_:" for c in value)

def _inbox_date(value):
    if value is None or not str(value).strip():
        return None
    text=str(value).strip()
    try:
        datetime.fromisoformat(text.replace("Z","+00:00"))
        return text
    except (TypeError,ValueError):
        return None

@app.get("/api/inbox")
def get_station_inbox():
    auth=require_admin()
    if auth:return auth
    status,rows=sb("station_inbox_notifications",params={
        "is_active":"eq.true",
        "select":"id,notification_key,level,title,detail,href,meta,source_date,first_seen_at,last_seen_at",
        "order":"source_date.desc",
        "limit":"1000"
    })
    if status!=200:return jsonify({"error":"Unable to load station inbox","details":rows}),status
    employee_id=str(session.get("employee_id") or "")
    ss,states=sb("station_inbox_notification_states",params={
        "employee_id":"eq."+employee_id,
        "select":"notification_id,read_at,favorited_at",
        "limit":"5000"
    })
    if ss!=200:return jsonify({"error":"Unable to load inbox preferences","details":states}),ss
    state_by_id={str(x.get("notification_id")):x for x in (states or [])}
    items=[]
    for row in rows or []:
        state=state_by_id.get(str(row.get("id")),{})
        items.append({
            "id":row.get("id"),
            "key":row.get("notification_key"),
            "level":row.get("level"),
            "title":row.get("title"),
            "detail":row.get("detail"),
            "href":row.get("href"),
            "meta":row.get("meta") or "",
            "date":row.get("source_date"),
            "is_read":bool(state.get("read_at")),
            "is_favorite":bool(state.get("favorited_at")),
            "first_seen_at":row.get("first_seen_at"),
            "last_seen_at":row.get("last_seen_at")
        })
    return jsonify({"items":items,"count":len(items)})

@app.post("/api/inbox/sync")
def sync_station_inbox():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    incoming=data.get("items")
    if not isinstance(incoming,list) or len(incoming)>300:
        return jsonify({"error":"Inbox sync requires an items array with no more than 300 entries"}),400
    now=_inbox_now()
    records=[]
    seen=set()
    for item in incoming:
        if not isinstance(item,dict):continue
        key=str(item.get("key") or "").strip()
        level=str(item.get("level") or "").strip().lower()
        title=str(item.get("title") or "").strip()
        detail=str(item.get("detail") or "").strip()
        href=str(item.get("href") or "").strip()
        if not _inbox_key_is_valid(key) or level not in ("critical","warning","info") or not title or not detail:
            continue
        if not href or href.startswith("//") or "://" in href or href.lower().startswith("javascript:"):
            continue
        if key in seen:continue
        seen.add(key)
        meta=item.get("meta")
        record={
            "notification_key":key,
            "level":level,
            "title":title[:240],
            "detail":detail[:2000],
            "href":href[:500],
            "meta":str(meta)[:2000] if meta else None,
            "is_active":True,
            "last_seen_at":now,
            "resolved_at":None,
            "updated_at":now
        }
        source_date=_inbox_date(item.get("date"))
        if source_date:
            record["source_date"]=source_date
        records.append(record)
    if records:
        keys=sorted(seen)
        params={"notification_key":"in.("+",".join(keys)+")",
            "select":"id,notification_key,is_active","limit":str(len(keys))}
        existing_status,existing_rows=sb("station_inbox_notifications",params=params)
        if existing_status!=200:
            return jsonify({"error":"Unable to check existing inbox notifications","details":existing_rows}),existing_status
        reactivated=[row for row in (existing_rows or []) if not row.get("is_active")]
        reactivated_ids=[str(row.get("id")) for row in reactivated if row.get("id")]
        if reactivated_ids:
            state_status,state_result=sb("station_inbox_notification_states",method="DELETE",
                params={"notification_id":"in.("+",".join(reactivated_ids)+")"},
                prefer="return=minimal")
            if state_status>=400:
                return jsonify({"error":"Unable to reset resolved inbox preferences","details":state_result}),state_status
            reactivated_keys={str(row.get("notification_key")) for row in reactivated}
            for record in records:
                if record["notification_key"] in reactivated_keys:
                    record["first_seen_at"]=now
                    record.setdefault("source_date",now)
        status,result=sb("station_inbox_notifications",method="POST",
            params={"on_conflict":"notification_key"},body=records,
            prefer="resolution=merge-duplicates,return=representation")
        if status>=400:return jsonify({"error":"Unable to save inbox notifications","details":result}),status
    else:
        result=[]
    if data.get("complete") is True:
        params={"is_active":"eq.true"}
        if seen:
            params["notification_key"]="not.in.("+",".join(sorted(seen))+")"
        status,updated=sb("station_inbox_notifications",method="PATCH",params=params,
            body={"is_active":False,"resolved_at":now,"updated_at":now},
            prefer="return=minimal")
        if status>=400:return jsonify({"error":"Unable to update resolved inbox notifications","details":updated}),status
    return jsonify({"ok":True,"saved":len(records),"complete":data.get("complete") is True}),200

@app.patch("/api/inbox/<notification_key>/state")
def update_station_inbox_state(notification_key):
    auth=require_admin()
    if auth:return auth
    if not _inbox_key_is_valid(notification_key):
        return jsonify({"error":"Invalid notification key"}),400
    data=request.get_json(silent=True) or {}
    if "is_read" not in data and "is_favorite" not in data:
        return jsonify({"error":"Provide is_read and/or is_favorite"}),400
    if ("is_read" in data and not isinstance(data.get("is_read"),bool)) or ("is_favorite" in data and not isinstance(data.get("is_favorite"),bool)):
        return jsonify({"error":"Inbox state values must be boolean"}),400
    status,notifications=sb("station_inbox_notifications",params={
        "notification_key":"eq."+notification_key,
        "select":"id,notification_key",
        "limit":"1"
    })
    if status!=200:return jsonify({"error":"Unable to find inbox notification","details":notifications}),status
    if not notifications:return jsonify({"error":"Inbox notification not found"}),404
    notification_id=str(notifications[0]["id"])
    employee_id=str(session.get("employee_id") or "")
    ss,existing=sb("station_inbox_notification_states",params={
        "notification_id":"eq."+notification_id,
        "employee_id":"eq."+employee_id,
        "select":"read_at,favorited_at",
        "limit":"1"
    })
    if ss!=200:return jsonify({"error":"Unable to load inbox state","details":existing}),ss
    prior=existing[0] if existing else {}
    now=_inbox_now()
    read_at=prior.get("read_at")
    favorited_at=prior.get("favorited_at")
    if "is_read" in data:
        read_at=(read_at or now) if data["is_read"] else None
    if "is_favorite" in data:
        favorited_at=(favorited_at or now) if data["is_favorite"] else None
    payload={
        "notification_id":notification_id,
        "employee_id":employee_id,
        "read_at":read_at,
        "favorited_at":favorited_at,
        "updated_at":now
    }
    status,result=sb("station_inbox_notification_states",method="POST",
        params={"on_conflict":"notification_id,employee_id"},body=payload,
        prefer="resolution=merge-duplicates,return=representation")
    if status>=400:return jsonify({"error":"Unable to save inbox state","details":result}),status
    return jsonify({"ok":True,"is_read":bool(read_at),"is_favorite":bool(favorited_at)}),200

@app.get("/api/tank-difference-alerts")
def get_tank_difference_alerts():
    auth=require_admin()
    if auth:return auth
    settings_status,settings=sb("station_settings",params={
        "id":"eq.true",
        "select":"shift_handover_tank_difference_tolerance,purchase_discharge_tank_difference_tolerance",
        "limit":"1"
    })
    if settings_status!=200:return jsonify({"error":"Unable to load tank tolerance settings","details":settings}),settings_status
    config=(settings or [{}])[0]
    handover_value=config.get("shift_handover_tank_difference_tolerance")
    handover_tolerance=float(10 if handover_value is None else handover_value)
    purchase_value=config.get("purchase_discharge_tank_difference_tolerance")
    purchase_tolerance=float(10 if purchase_value is None else purchase_value)
    hs,handovers=sb("shift_takeovers",params={
        "select":"id,shift_id,tank_id,tank_variance_liters,shift_started_at,shift_ended_at,created_at",
        "order":"created_at.desc","limit":"5000"
    })
    if hs!=200:return jsonify({"error":"Unable to check shift tank differences","details":handovers}),hs
    ps,purchases=sb("purchases",params={
        "select":"id,invoice_number,product,discharge_history,purchase_date",
        "order":"purchase_date.desc","limit":"5000"
    })
    if ps!=200:return jsonify({"error":"Unable to check purchase discharge tank differences","details":purchases}),ps
    alerts=[]
    # Reconcile tank differences at DSR level, not from individual handover
    # variance. This is essential when several dispensers draw from the same
    # physical tank: individual shift variances are not the final tank balance.
    # Reuse the DSR's existing calculation so the alert and report share one
    # stock equation; this is read-only and never blocks shift handover.
    report_dates=[]
    for row in handovers or []:
        stamp=row.get("shift_started_at") or row.get("shift_ended_at")
        local_day=_local_date_from_iso(stamp) if stamp else None
        report_day=local_day.isoformat() if local_day else None
        if report_day and report_day not in report_dates:
            report_dates.append(report_day)
    # Bound repeated Admin polling to the latest seven report dates.
    report_dates=sorted(report_dates,reverse=True)[:7]
    for report_day in report_dates:
        try:
            report_result=daily_report(report_day)
            report_response=report_result[0] if isinstance(report_result,tuple) else report_result
            report_status=report_result[1] if isinstance(report_result,tuple) and len(report_result)>1 else getattr(report_response,"status_code",200)
            if report_status!=200 or not hasattr(report_response,"get_json"):
                continue
            report_payload=report_response.get_json(silent=True) or {}
            # Only completed/confirmed DSRs are authoritative. In-progress
            # report days must not emit misleading tank-difference alerts.
            if report_payload.get("report_ready") is not True:
                continue
            for tank_row in report_payload.get("dsr_tank_details") or report_payload.get("tank_details") or []:
                try:difference=float(tank_row.get("difference_liters") or 0)
                except (TypeError,ValueError):continue
                if abs(difference)<=handover_tolerance:continue
                tank_id=str(tank_row.get("tank_id") or tank_row.get("id") or "")
                tank_label=str(tank_row.get("tank_code") or tank_row.get("tank") or tank_row.get("tank_name") or ("Tank "+tank_id[:8] if tank_id else "Tank"))
                alerts.append({
                    "key":"dsr-tank-difference:"+report_day+":"+tank_id,
                    "level":"warning",
                    "title":"DSR tank stock difference exceeds tolerance",
                    "detail":tank_label+" DSR expected closing stock differs from actual closing stock by "+str(round(abs(difference),2))+" L for "+report_day+". Configured tolerance is "+str(round(handover_tolerance,2))+" L. Review the DSR tank reconciliation.",
                    "href":"admin-dsr-detail.html?date="+report_day,
                    "meta":report_day+" · Difference "+("+" if difference>0 else "")+str(round(difference,2))+" L · Allowed "+str(round(handover_tolerance,2))+" L",
                    "date":report_day+"T23:59:59+03:00",
                    "tank_id":tank_id,
                    "report_date":report_day
                })
        except Exception:
            # A failed historical DSR calculation should not make this alert
            # endpoint unavailable; the purchase-discharge alerts still load.
            continue
    for purchase in purchases or []:
        history=purchase.get("discharge_history")
        if not isinstance(history,list):continue
        for index,event in enumerate(history):
            if not isinstance(event,dict) or not event.get("tank_stock_recorded"):continue
            try:difference=float(event.get("tank_stock_difference_liters"))
            except (TypeError,ValueError):continue
            if abs(difference)<=purchase_tolerance:continue
            record_id=str(purchase.get("id") or "")
            invoice=str(purchase.get("invoice_number") or "")
            label=("Invoice "+invoice) if invoice else ("Purchase "+record_id[:8])
            alerts.append({
                "key":"purchase-tank-difference:"+record_id+":"+str(index),
                "level":"warning",
                "title":"Purchase discharge tank difference exceeds tolerance",
                "detail":label+" physical tank reading differs from the expected post-discharge stock by "+str(round(abs(difference),2))+" L; configured tolerance is "+str(round(purchase_tolerance,2))+" L. Review the dip reading and discharge record.",
                "href":"admin-purchases.html"+("#purchase-"+record_id if record_id else ""),
                "meta":"Difference "+("+" if difference>0 else "")+str(round(difference,2))+" L · Allowed "+str(round(purchase_tolerance,2))+" L",
                "date":event.get("tank_stock_recorded_at") or event.get("discharge_datetime") or purchase.get("purchase_date")
            })
    alerts.sort(key=lambda x:str(x.get("date") or ""),reverse=True)
    return jsonify({"items":alerts[:300],"count":len(alerts)}),200

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

def _role_login(role):
    data = request.get_json(silent=True) or {}
    operator_id, pin = str(data.get("operator_id", "")).strip(), str(data.get("pin", ""))
    if not operator_id or not pin:
        return jsonify({"error": "Operator ID and PIN are required"}), 400
    status, rows = sb("employees", params={
        "operator_id": "eq." + operator_id, "active": "eq.true",
        "role": "eq." + role,
        "select": "id,name,phone,operator_id,role,pin_hash,active"
    })
    if status != 200 or not rows:
        return jsonify({"error": "Invalid credentials for this login"}), 401
    emp = rows[0]
    if not verify_pin(pin, emp.get("pin_hash", "")):
        return jsonify({"error": "Invalid credentials for this login"}), 401
    response = jsonify({k: emp[k] for k in ("id","name","phone","operator_id","role")})
    _set_role_cookie(response, role, emp["id"])
    response.delete_cookie("__Host-fuel_shift_session", path="/", secure=True, httponly=True, samesite="Lax")
    return response

@app.post("/api/admin-login")
def admin_login():
    return _role_login("admin")

@app.post("/api/attendant-login")
def attendant_login():
    return _role_login("attendant")

@app.post("/api/login")
def login_legacy():
    data = request.get_json(silent=True) or {}
    role = str(data.get("role", "")).strip().lower()
    if role not in ROLE_SESSION_COOKIE:
        return jsonify({"error": "A separate admin or attendant login is required"}), 400
    return _role_login(role)

@app.post("/api/logout")
def logout():
    role = _requested_role()
    response = jsonify({"ok": True})
    session.clear()
    if role:
        _clear_role_cookie(response, role)
    return response

@app.get("/api/me")
def me():
    if not require_login():
        pass
    else:
        return jsonify({"authenticated": False}), 401
    status, rows = sb("employees", params={
        "id": "eq." + str(session["employee_id"]),
        "select": "id,name,phone,operator_id,role,active"
    })
    if status != 200:
        return jsonify({"error": "Unable to verify the current session"}), 503
    if not rows or not rows[0].get("active") or rows[0].get("role") != session.get("role"):
        response = jsonify({"authenticated": False})
        _clear_role_cookie(response, session.get("role"))
        session.clear()
        return response, 401
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

@app.post("/api/accounting/close")
def accounting_close_period():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    period_id=str(data.get("period_id") or "").strip()
    if not period_id:return jsonify({"error":"period_id is required"}),400
    payload={"p_accounting_period_id":period_id,"p_closed_by":str(session.get("employee_id")) if session.get("employee_id") else None,"p_notes":str(data.get("notes") or "").strip() or None}
    status,result=rpc("close_control_period",payload)
    if status>=400:return jsonify(result),status
    return jsonify(result),200

@app.get("/api/accounting/closing")
def accounting_closing():
    auth=require_admin()
    if auth:return auth
    period_id=str(request.args.get("period_id") or "").strip()
    if not period_id:return jsonify({"error":"period_id is required"}),400
    ps,periods=sb("accounting_periods",params={"id":"eq."+period_id,"select":"id,name,status,starts_at,ends_at,opened_by,closed_by,notes,created_at,closed_at","limit":"1"})
    if ps!=200:return jsonify(periods),ps
    if not periods:return jsonify({"error":"Accounting period not found"}),404
    cs,closings=sb("tank_closing_snapshots",params={"accounting_period_id":"eq."+period_id,"select":"id,tank_id,physical_liters,physical_height_mm,measured_at,recorded_by,calibration_version,reason,notes,expected_closing_liters,difference_liters,variance_percent,variance_status,created_at","order":"created_at.asc"})
    if cs!=200:return jsonify(closings),cs
    return jsonify({"period":periods[0],"closings":closings or []}),200

@app.post("/api/accounting/closing")
def accounting_record_closing():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    period_id=str(data.get("period_id") or "").strip()
    tank_id=str(data.get("tank_id") or "").strip()
    try: physical=float(data.get("physical_liters"))
    except (TypeError,ValueError): return jsonify({"error":"Physical closing liters are required"}),400
    calibration=str(data.get("calibration_version") or "").strip()
    if not period_id or not tank_id:return jsonify({"error":"Accounting period and tank are required"}),400
    if not calibration:return jsonify({"error":"Calibration version is required"}),400
    payload={"p_accounting_period_id":period_id,"p_tank_id":tank_id,"p_physical_liters":physical,"p_physical_height_mm":data.get("physical_height_mm"),"p_measured_at":data.get("measured_at") or datetime.now(timezone.utc).isoformat(),"p_recorded_by":str(session.get("employee_id")) if session.get("employee_id") else None,"p_calibration_version":calibration,"p_notes":str(data.get("notes") or "").strip() or None}
    status,result=rpc("record_control_period_closing",payload)
    if status>=400:return jsonify(result),status
    return jsonify(result),201

@app.get("/api/accounting/current-period")
def accounting_current_period():
    auth=require_admin()
    if auth:return auth
    ps,periods=sb("accounting_periods",params={"status":"eq.OPEN","select":"id,name,status,starts_at,ends_at,opened_by,notes,created_at,closed_at","order":"created_at.desc","limit":"1"})
    if ps!=200:return jsonify(periods),ps
    if not periods:return jsonify({"open":False,"period":None,"openings":[]}),200
    period=periods[0]
    os,openings=sb("tank_opening_snapshots",params={"accounting_period_id":"eq."+str(period["id"]),"select":"id,tank_id,physical_liters,physical_height_mm,measured_at,recorded_by,calibration_version,reason,notes","order":"created_at.asc"})
    if os!=200:return jsonify(openings),os
    return jsonify({"open":True,"period":period,"openings":openings}),200

@app.post("/api/accounting/open-period")
def accounting_open_period():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    name=str(data.get("name","")).strip()
    starts_at=str(data.get("starts_at","")).strip()
    openings=data.get("openings")
    notes=data.get("notes")
    if not name:return jsonify({"error":"Accounting period name is required"}),400
    if not starts_at:return jsonify({"error":"Accounting period start time is required"}),400
    if not isinstance(openings,list):return jsonify({"error":"Opening measurements are required for every active tank"}),400
    payload={"p_name":name,"p_starts_at":starts_at,"p_openings":openings,"p_opened_by":str(session.get("employee_id")) if session.get("employee_id") else None,"p_notes":str(notes).strip() if notes is not None else None}
    try: status,result=rpc("open_control_period",payload)
    except Exception as exc:return jsonify({"error":"Unable to open accounting period","details":str(exc)}),500
    if status>=400:return jsonify({"error":result.get("message") if isinstance(result,dict) and result.get("message") else result}),status
    return jsonify(result),200

@app.get("/api/settings")
def get_settings():
    auth=require_login()
    if auth:return auth
    status,result=sb("station_settings",params={"id":"eq.true","select":"currency,item_orders,sales_difference_tolerance,shift_handover_tank_difference_tolerance,purchase_discharge_tank_difference_tolerance,updated_at","limit":"1"})
    if status!=200:return jsonify(result),status
    if not result:
        return jsonify({"currency":"ETB","item_orders":{},"sales_difference_tolerance":1.00,"shift_handover_tank_difference_tolerance":10.00,"purchase_discharge_tank_difference_tolerance":10.00}),200
    return jsonify(result[0]),200

@app.patch("/api/settings")
def update_settings():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    tolerance_fields={
        "sales_difference_tolerance":"Sales difference tolerance",
        "shift_handover_tank_difference_tolerance":"Shift handover tank difference tolerance",
        "purchase_discharge_tank_difference_tolerance":"Purchase discharge tank difference tolerance"
    }
    tolerance_updates={}
    for field,label in tolerance_fields.items():
        if field not in data or data[field] is None: continue
        try:
            value=float(data[field])
        except (TypeError,ValueError):
            return jsonify({"error":label+" must be a number"}),400
        if not math.isfinite(value) or value < 0 or value > 100000:
            return jsonify({"error":label+" must be between 0 and 100000"}),400
        tolerance_updates[field]=round(value,2)
    currency=str(data.get("currency","")).strip().upper()
    if not currency and not tolerance_updates:
        return jsonify({"error":"Provide a currency or tolerance value"}),400
    if currency and len(currency)>10:
        return jsonify({"error":"Currency must be 1-10 characters"}),400
    if currency and not all(ch.isalnum() or ch in " _-₿$€£¥" for ch in currency):
        return jsonify({"error":"Currency contains unsupported characters"}),400
    update_body={"updated_at":datetime.now(timezone.utc).isoformat()}
    if currency: update_body["currency"]=currency
    update_body.update(tolerance_updates)
    status,result=sb("station_settings",method="PATCH",params={"id":"eq.true"},body=update_body,prefer="return=representation")
    if status>=400:return jsonify(result),status
    if not result:
        insert_body={"id":True,"currency":currency or "ETB","sales_difference_tolerance":1.00,"shift_handover_tank_difference_tolerance":10.00,"purchase_discharge_tank_difference_tolerance":10.00}
        insert_body.update(tolerance_updates)
        status,result=sb("station_settings",method="POST",body=insert_body,prefer="return=representation")
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

        # The legacy nozzles table and normalized dispensers/nozzles tables
        # share human-readable codes. Keep all three in sync during reorder;
        # stable UUIDs remain unchanged so existing shifts and sales still link.
        normalized_by_legacy_id={}
        physical_by_dispenser={}
        if key=="dispensers":
            ds,normalized=sb("dispensers",params={"select":"id,dispenser_code"})
            if ds!=200:return jsonify({"error":"Could not load physical dispenser records"}),ds
            normalized_by_code={str(x.get("dispenser_code","")):x for x in normalized}
            dn,physical=sb("dispenser_nozzles",params={"select":"id,dispenser_id,nozzle_number,nozzle_code"})
            if dn!=200:return jsonify({"error":"Could not load physical nozzle records"}),dn
            for item_id in ordered:
                old_code=str(by_id[item_id].get("nozzle_code",""))
                normalized_row=normalized_by_code.get(old_code)
                if not normalized_row:
                    return jsonify({"error":"A physical dispenser record is missing for "+old_code+"; naming order was not changed."}),409
                normalized_by_legacy_id[item_id]=normalized_row
            for nozzle in physical:
                physical_by_dispenser.setdefault(str(nozzle.get("dispenser_id")),[]).append(nozzle)

        # First move every affected code to a temporary unique value so the
        # unique constraints cannot collide mid-swap. Apply this to normalized
        # physical records as well as the legacy display records.
        for item_id in ordered:
            temp_code="__reorder__"+item_id
            if key=="tanks":
                st,_=sb("tanks",method="PATCH",params={"id":"eq."+item_id},body={"tank_code":temp_code},prefer="return=minimal")
            else:
                st,_=sb("nozzles",method="PATCH",params={"id":"eq."+item_id},body={"nozzle_code":temp_code},prefer="return=minimal")
                if st<400:
                    normalized_row=normalized_by_legacy_id[item_id]
                    st,_=sb("dispensers",method="PATCH",params={"id":"eq."+str(normalized_row["id"])},body={"dispenser_code":temp_code},prefer="return=minimal")
                if st<400:
                    for physical_nozzle in physical_by_dispenser.get(str(normalized_by_legacy_id[item_id]["id"]),[]):
                        temp_nozzle_code=temp_code+"-N•"+str(physical_nozzle.get("nozzle_number") or 1)
                        st,_=sb("dispenser_nozzles",method="PATCH",params={"id":"eq."+str(physical_nozzle["id"])},body={"nozzle_code":temp_nozzle_code},prefer="return=minimal")
                        if st>=400:break
            if st>=400:return jsonify({"error":"Could not prepare item order change across dispenser records"}),st

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
                    if st<400:
                        normalized_row=normalized_by_legacy_id[item_id]
                        st,_=sb("dispensers",method="PATCH",params={"id":"eq."+str(normalized_row["id"])},body={"dispenser_code":final_code},prefer="return=minimal")
                    if st<400:
                        physical_rows=physical_by_dispenser.get(str(normalized_by_legacy_id[item_id]["id"]),[])
                        for physical_nozzle in physical_rows:
                            nozzle_number=int(physical_nozzle.get("nozzle_number") or 1)
                            if nozzle_number>count:
                                # Preserve historical UUID references; only remove an extra physical
                                # nozzle if it has never been referenced by a shift reading.
                                rs,refs=sb("shift_nozzle_readings",params={"nozzle_id":"eq."+str(physical_nozzle["id"]),"select":"id","limit":"1"})
                                if rs!=200 or refs:
                                    st=409
                                    break
                                st,_=sb("dispenser_nozzles",method="DELETE",params={"id":"eq."+str(physical_nozzle["id"])},prefer="return=minimal")
                            else:
                                st,_=sb("dispenser_nozzles",method="PATCH",params={"id":"eq."+str(physical_nozzle["id"])},body={"nozzle_code":f"{final_code}-N•{nozzle_number}"},prefer="return=minimal")
                            if st>=400:break
                if st>=400:return jsonify({"error":"Could not save item naming order across dispenser records"}),st

    body={"item_orders":item_orders,"updated_at":datetime.now(timezone.utc).isoformat()}
    us,ur=sb("station_settings",method="PATCH",params={"id":"eq.true"},body=body,prefer="return=representation")
    if us>=400:return jsonify(ur),us
    # A fresh installation may not have a station_settings row yet. PATCHing
    # an absent id returns an empty successful result, so create the row rather
    # than reporting success while silently losing the saved order.
    if not ur:
        us,ur=sb("station_settings",method="POST",body={"id":True,"currency":"ETB",**body},prefer="return=representation")
        if us>=400:return jsonify(ur),us
    return jsonify({"ok":True,"key":key,"ids":ordered,"item_orders":item_orders}),200

def _logistics_admin_auth():
    return require_admin()

def _logistics_truck_to_ui(row, compartments):
    calibrations=[]
    for item in sorted(compartments, key=lambda x: int(x.get("compartment_number") or 0)):
        details=item.get("calibration_points")
        if not isinstance(details,dict):
            details={}
        points=details.get("calibrationTable", details.get("points", []))
        if not isinstance(points,list):
            points=[]
        calibrations.append({
            "compartment":item.get("compartment_number"),
            "fileName":details.get("fileName"),
            "fileType":details.get("fileType") or "text/csv",
            "fileSize":details.get("fileSize"),
            "verifiedMm":details.get("verifiedMm"),
            "verifiedLitres":details.get("verifiedLitres"),
            "calibrationTable":points
        })
    return {
        "id":row.get("legacy_local_id") or row.get("id"),
        "databaseId":row.get("id"),
        "driverName":row.get("driver_name") or "",
        "driverPhone":row.get("driver_phone") or "",
        "plate":row.get("truck_code") or "",
        "trailerPlate":row.get("trailer_plate") or "",
        "compartmentCount":row.get("compartment_count") or len(compartments),
        "calibrations":calibrations,
        "createdAt":row.get("created_at"),
        "updatedAt":row.get("updated_at"),
        "isActive":row.get("active", True)
    }

@app.get("/api/logistics/trucks")
def logistics_list_trucks():
    auth=_logistics_admin_auth()
    if auth:return auth
    status,rows=sb("logistics_trucks",params={"select":"*","order":"created_at.asc","limit":"1000"})
    if status!=200:return jsonify({"error":"Unable to load logistics trucks","details":rows}),status
    cs,compartments=sb("logistics_truck_compartments",params={"select":"*","order":"compartment_number.asc","limit":"5000"})
    if cs!=200:return jsonify({"error":"Unable to load truck compartments","details":compartments}),cs
    grouped={}
    for item in compartments or []:
        grouped.setdefault(str(item.get("truck_id")),[]).append(item)
    return jsonify([_logistics_truck_to_ui(row,grouped.get(str(row.get("id")),[])) for row in rows or []]),200

@app.post("/api/logistics/trucks")
def logistics_save_truck():
    auth=_logistics_admin_auth()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    local_id=str(data.get("id") or "").strip()
    plate=str(data.get("plate") or "").strip().upper()
    driver=str(data.get("driverName") or "").strip()
    phone=str(data.get("driverPhone") or "").strip()
    trailer=str(data.get("trailerPlate") or "").strip().upper()
    count=data.get("compartmentCount",0)
    calibrations=data.get("calibrations") if isinstance(data.get("calibrations"),list) else []
    if not plate or not driver or not phone:
        return jsonify({"error":"Truck plate, driver name and phone are required"}),400
    try:
        count=int(count)
        if count<1 or count>100: raise ValueError()
    except (TypeError,ValueError):
        return jsonify({"error":"Invalid compartment count"}),400
    if len(calibrations)>count:
        return jsonify({"error":"Calibration count exceeds compartment count"}),400
    existing=None
    if local_id:
        es,found=sb("logistics_trucks",params={"legacy_local_id":"eq."+local_id,"select":"id","limit":"1"})
        if es!=200:return jsonify({"error":"Unable to check existing truck","details":found}),es
        if found:existing=found[0]
    if existing is None:
        es,found=sb("logistics_trucks",params={"truck_code":"eq."+plate,"select":"id,legacy_local_id","limit":"1"})
        if es!=200:return jsonify({"error":"Unable to check truck plate","details":found}),es
        if found:existing=found[0]
    now=datetime.now(timezone.utc).isoformat()
    body={"truck_code":plate,"registration_number":plate,"trailer_plate":trailer or None,
          "driver_name":driver,"driver_phone":phone,"compartment_count":count,
          "active":data.get("isActive") is not False,"updated_at":now}
    if local_id:body["legacy_local_id"]=local_id
    if existing:
        ts,result=sb("logistics_trucks",method="PATCH",params={"id":"eq."+str(existing["id"])},body=body,prefer="return=representation")
    else:
        body["created_at"]=now
        ts,result=sb("logistics_trucks",method="POST",body=body,prefer="return=representation")
    if ts>=400:return jsonify({"error":"Unable to save truck","details":result}),ts
    saved=(result or [None])[0] if isinstance(result,list) else result
    if not isinstance(saved,dict) or not saved.get("id"):
        rs,found=sb("logistics_trucks",params={"truck_code":"eq."+plate,"select":"*","limit":"1"})
        if rs!=200 or not found:return jsonify({"error":"Truck saved but could not be reloaded"}),500
        saved=found[0]
    truck_id=str(saved["id"])
    ds,deleted=sb("logistics_truck_compartments",method="DELETE",params={"truck_id":"eq."+truck_id},prefer="return=representation")
    if ds>=400:return jsonify({"error":"Truck saved, but old compartment data could not be replaced","details":deleted}),ds
    rows=[]
    for index,cal in enumerate(calibrations):
        if not isinstance(cal,dict):continue
        points=cal.get("calibrationTable")
        if not isinstance(points,list):points=[]
        details={"calibrationTable":points,"fileName":cal.get("fileName"),"fileType":cal.get("fileType"),
                 "fileSize":cal.get("fileSize"),"verifiedMm":cal.get("verifiedMm"),"verifiedLitres":cal.get("verifiedLitres")}
        rows.append({"truck_id":truck_id,"compartment_number":int(cal.get("compartment") or index+1),
                     "capacity_liters":max(1.0,max([float(point.get("litres") or 0) for point in points if isinstance(point,dict)] or [1.0])),
                     "calibration_points":details,"calibration_verified":cal.get("verifiedMm") is not None,
                     "calibration_verified_at":now if cal.get("verifiedMm") is not None else None,
                     "calibration_verified_by":str(session.get("employee_id") or "") if cal.get("verifiedMm") is not None else None})
    if rows:
        cs,created=sb("logistics_truck_compartments",method="POST",body=rows,prefer="return=representation")
        if cs>=400:return jsonify({"error":"Truck saved, but compartment calibration could not be saved","details":created}),cs
    return jsonify(_logistics_truck_to_ui(saved,rows)),200

@app.delete("/api/logistics/trucks/<truck_key>")
def logistics_delete_truck(truck_key):
    auth=_logistics_admin_auth()
    if auth:return auth
    if not truck_key:return jsonify({"error":"Truck identifier is required"}),400
    if len(truck_key)>=32 and "-" in truck_key:
        status,rows=sb("logistics_trucks",params={"id":"eq."+truck_key,"select":"id","limit":"1"})
        if status!=200:return jsonify({"error":"Unable to find truck","details":rows}),status
        found=rows
    else:
        status,found=sb("logistics_trucks",params={"legacy_local_id":"eq."+truck_key,"select":"id","limit":"1"})
        if status!=200:return jsonify({"error":"Unable to find truck","details":found}),status
    if not found:return jsonify({"ok":True,"not_found":True}),200
    status,result=sb("logistics_trucks",method="DELETE",params={"id":"eq."+str(found[0]["id"])},prefer="return=representation")
    if status>=400:return jsonify({"error":"Unable to remove truck","details":result}),status
    return jsonify({"ok":True}),200

@app.get("/api/logistics/product-fees")
def logistics_get_product_fees():
    auth=_logistics_admin_auth()
    if auth:return auth
    status,rows=sb("logistics_product_fees",params={"select":"id,product_id,product_name,fee_per_liter,currency,active,updated_at","order":"product_name.asc","limit":"1000"})
    return (jsonify(rows),status)

@app.post("/api/logistics/product-fees")
def logistics_save_product_fees():
    auth=_logistics_admin_auth()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    items=data.get("items")
    if not isinstance(items,list) or len(items)>500:
        return jsonify({"error":"Provide a valid items array (maximum 500 products)"}),400
    # Resolve every fee against the product catalogue. Never trust a client-supplied
    # product name and ID independently; that can attach a fee to the wrong product.
    ps,products=sb("products",params={"select":"id,name,code_name,active","limit":"1000"})
    if ps!=200:return jsonify({"error":"Unable to load product catalogue","details":products}),ps
    now=datetime.now(timezone.utc).isoformat()
    saved=0
    for item in items:
        if not isinstance(item,dict):continue
        requested_name=str(item.get("product_name") or "").strip()
        requested_id=str(item.get("product_id") or "").strip()
        try:rate=float(item.get("fee_per_liter",0))
        except (TypeError,ValueError):return jsonify({"error":"Each fee must be a valid number"}),400
        if not requested_name or not math.isfinite(rate) or rate<0:
            return jsonify({"error":"Product names and non-negative fee rates are required"}),400
        by_id=next((p for p in products if str(p.get("id"))==requested_id),None) if requested_id else None
        by_name=next((p for p in products if requested_name.casefold() in
                      (str(p.get("name") or "").strip().casefold(),
                       str(p.get("code_name") or "").strip().casefold())),None)
        if requested_id and not by_id:
            return jsonify({"error":"Product ID does not exist in the catalogue","product_id":requested_id}),400
        if by_id and by_name and str(by_id.get("id"))!=str(by_name.get("id")):
            return jsonify({"error":"Product name and product ID refer to different products","product_name":requested_name,"product_id":requested_id}),400
        product=by_id or by_name
        if not product:
            return jsonify({"error":"Product not found in catalogue","product_name":requested_name}),404
        if not product.get("active"):
            return jsonify({"error":"Product is inactive","product_name":requested_name}),400
        canonical_id=str(product["id"])
        # Keep the established logistics display convention (MGR / AGO).
        canonical_name=str(product.get("code_name") or product["name"]).strip()
        es,found=sb("logistics_product_fees",params={"product_id":"eq."+canonical_id,"select":"id","limit":"1"})
        if es!=200:return jsonify({"error":"Unable to check saved fee","details":found}),es
        existing=found[0] if found else None
        body={"product_id":canonical_id,"product_name":canonical_name,"fee_per_liter":rate,
              "currency":"ETB","active":True,"updated_at":now}
        if existing:
            status,result=sb("logistics_product_fees",method="PATCH",params={"id":"eq."+str(existing["id"])},body=body,prefer="return=representation")
        else:
            # Migrate an older name-only row in place if one exists, to avoid duplicates.
            es,found=sb("logistics_product_fees",params={"product_name":"eq."+canonical_name,"select":"id","limit":"1"})
            if es!=200:return jsonify({"error":"Unable to check saved fee","details":found}),es
            if found:
                status,result=sb("logistics_product_fees",method="PATCH",params={"id":"eq."+str(found[0]["id"])},body=body,prefer="return=representation")
            else:
                status,result=sb("logistics_product_fees",method="POST",body=body,prefer="return=representation")
        if status>=400:return jsonify({"error":"Unable to save product fee","details":result}),status
        saved+=1
    return jsonify({"ok":True,"saved":saved}),200

@app.get("/api/logistics/deliveries")
def logistics_list_deliveries():
    auth=_logistics_admin_auth()
    if auth:return auth
    status,rows=sb("logistics_deliveries",params={"select":"*","order":"delivery_date.desc","limit":"1000"})
    if status!=200:return jsonify({"error":"Unable to load delivery history","details":rows}),status
    cs,compartments=sb("logistics_delivery_compartments",params={"select":"*","order":"compartment_number.asc","limit":"5000"})
    if cs!=200:return jsonify({"error":"Unable to load delivery compartment details","details":compartments}),cs
    grouped={}
    for item in compartments or []:grouped.setdefault(str(item.get("delivery_id")),[]).append(item)
    for row in rows or []:row["compartments"]=grouped.get(str(row.get("id")),[])
    return jsonify(rows or []),200

@app.post("/api/logistics/deliveries")
def logistics_create_delivery():
    auth=_logistics_admin_auth()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    requested_product_id=str(data.get("product_id") or "").strip()
    requested_product_name=str(data.get("product_name") or "").strip()
    if not requested_product_name and not requested_product_id:
        return jsonify({"error":"Choose a product for this delivery"}),400
    ps,products=sb("products",params={"select":"id,name,code_name,active","limit":"1000"})
    if ps!=200:return jsonify({"error":"Unable to load product catalogue","details":products}),ps
    product_by_id=next((p for p in products if str(p.get("id"))==requested_product_id),None) if requested_product_id else None
    product_by_name=next((p for p in products if requested_product_name.casefold() in
                          (str(p.get("name") or "").strip().casefold(),
                           str(p.get("code_name") or "").strip().casefold())),None) if requested_product_name else None
    if requested_product_id and not product_by_id:
        return jsonify({"error":"Product ID does not exist in the catalogue","product_id":requested_product_id}),400
    if product_by_id and product_by_name and str(product_by_id.get("id"))!=str(product_by_name.get("id")):
        return jsonify({"error":"Product name and product ID refer to different products"}),400
    product=product_by_id or product_by_name
    if not product:return jsonify({"error":"Product not found in catalogue","product_name":requested_product_name}),404
    if not product.get("active"):return jsonify({"error":"Product is inactive"}),400
    product_id=str(product["id"])
    product_name=str(product.get("code_name") or product["name"]).strip()
    try:
        delivered=float(data.get("delivered_liters") or 0)
        fee=float(data.get("fee_per_liter") or 0)
        ordered=None if data.get("ordered_liters") in (None,"") else float(data.get("ordered_liters"))
    except (TypeError,ValueError):return jsonify({"error":"Liters and fee must be numeric"}),400
    if not math.isfinite(delivered) or delivered<0 or not math.isfinite(fee) or fee<0 or (ordered is not None and (not math.isfinite(ordered) or ordered<0)):
        return jsonify({"error":"Liters and fee must be non-negative valid numbers"}),400
    truck_id=str(data.get("truck_id") or "").strip()
    if truck_id:
        ts,trucks=sb("logistics_trucks",params={"id":"eq."+truck_id,"select":"id,truck_code,registration_number,driver_name","limit":"1"})
        if ts!=200:return jsonify({"error":"Unable to verify selected truck","details":trucks}),ts
        if not trucks:return jsonify({"error":"Selected truck was not found in the database"}),404
        truck=trucks[0]
    else:truck=None
    tank_id=str(data.get("tank_id") or "").strip()
    if tank_id:
        ts,tanks=sb("tanks",params={"id":"eq."+tank_id,"select":"id,product,product_id","limit":"1"})
        if ts!=200:return jsonify({"error":"Unable to verify selected tank","details":tanks}),ts
        if not tanks:return jsonify({"error":"Selected tank was not found"}),404
        tank=tanks[0]
        tank_product_id=str(tank.get("product_id") or "")
        tank_product_name=str(tank.get("product") or "").strip().casefold()
        if (tank_product_id and tank_product_id!=product_id) or (not tank_product_id and tank_product_name not in
                (str(product.get("name") or "").strip().casefold(),str(product.get("code_name") or "").strip().casefold())):
            return jsonify({"error":"Selected tank is assigned to a different product"}),400
    status_value=str(data.get("status") or "completed").strip().lower()
    if status_value not in ("draft","in_progress","completed","cancelled"):return jsonify({"error":"Invalid delivery status"}),400
    date_value=str(data.get("delivery_date") or datetime.now(timezone.utc).isoformat()).strip()
    try:datetime.fromisoformat(date_value.replace("Z","+00:00"))
    except ValueError:return jsonify({"error":"Invalid delivery date"}),400
    now=datetime.now(timezone.utc).isoformat()
    body={"delivery_reference":str(data.get("delivery_reference") or "").strip() or None,"delivery_date":date_value,
          "truck_id":truck.get("id") if truck else None,"truck_code_snapshot":truck.get("truck_code") if truck else None,
          "registration_snapshot":truck.get("registration_number") if truck else None,"driver_name_snapshot":truck.get("driver_name") if truck else None,
          "supplier_name":str(data.get("supplier_name") or "").strip() or None,"product_id":product_id or None,"product_name":product_name,
          "ordered_liters":ordered,"delivered_liters":delivered,"fee_per_liter":fee,"status":status_value,
          "tank_id":tank_id or None,"tank_opening_liters":None if data.get("tank_opening_liters") in (None, "") else float(data.get("tank_opening_liters")),
          "tank_closing_liters":None if data.get("tank_closing_liters") in (None, "") else float(data.get("tank_closing_liters")),"tank_difference_liters":None if data.get("tank_difference_liters") in (None, "") else float(data.get("tank_difference_liters")),
          "notes":str(data.get("notes") or "").strip() or None,"created_by":str(session.get("employee_id") or ""),
          "completed_at":now if status_value=="completed" else None,"updated_at":now}
    status,result=sb("logistics_deliveries",method="POST",body=body,prefer="return=representation")
    if status>=400:return jsonify({"error":"Unable to save delivery record","details":result}),status
    saved=(result or [None])[0] if isinstance(result,list) else result
    if not isinstance(saved,dict) or not saved.get("id"):return jsonify({"error":"Delivery may have saved but could not be reloaded"}),500
    compartment_items=data.get("compartments") if isinstance(data.get("compartments"),list) else []
    rows=[]
    for index,item in enumerate(compartment_items):
        if not isinstance(item,dict):continue
        try:liters=float(item.get("delivered_liters") or 0)
        except (TypeError,ValueError):return jsonify({"error":"Compartment liters must be numeric"}),400
        if not math.isfinite(liters) or liters<0:return jsonify({"error":"Compartment liters must be non-negative"}),400
        rows.append({"delivery_id":saved["id"],"compartment_number":int(item.get("compartment_number") or index+1),
                     "truck_compartment_id":item.get("truck_compartment_id") or None,"capacity_liters":item.get("capacity_liters") or None,
                     "delivered_liters":liters,"dip_before_mm":item.get("dip_before_mm"),"dip_after_mm":item.get("dip_after_mm"),
                     "calculated_liters":item.get("calculated_liters"),"notes":item.get("notes")})
    if rows:
        cs,created=sb("logistics_delivery_compartments",method="POST",body=rows,prefer="return=representation")
        if cs>=400:return jsonify({"error":"Delivery saved, but compartment details failed to save","delivery_id":saved["id"],"details":created}),cs
    return jsonify(saved),201

@app.patch("/api/logistics/deliveries/<delivery_id>")
def logistics_update_delivery(delivery_id):
    auth=_logistics_admin_auth()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    body={}
    if "status" in data:
        value=str(data.get("status") or "").strip().lower()
        if value not in ("draft","in_progress","completed","cancelled"):return jsonify({"error":"Invalid delivery status"}),400
        body["status"]=value
        body["completed_at"]=datetime.now(timezone.utc).isoformat() if value=="completed" else None
    if "notes" in data:body["notes"]=str(data.get("notes") or "").strip() or None
    if not body:return jsonify({"error":"No supported delivery fields supplied"}),400
    body["updated_at"]=datetime.now(timezone.utc).isoformat()
    status,result=sb("logistics_deliveries",method="PATCH",params={"id":"eq."+delivery_id},body=body,prefer="return=representation")
    if status>=400:return jsonify({"error":"Unable to update delivery","details":result}),status
    if not result:return jsonify({"error":"Delivery not found"}),404
    return jsonify(result[0]),200

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
    old_status, old_rows = sb("products",params={"id":"eq."+product_id,"select":"id,name,code_name,active,selling_price"})
    if old_status != 200 or not old_rows:
        return jsonify({"error":"Product not found"}),404
    old_product=old_rows[0]
    # Product labels are denormalized in operational configuration and human-readable
    # codes identify dispensers/tanks. Refuse a rename while referenced rather than
    # silently leaving tanks, dispensers, deliveries or purchase records disconnected.
    name_changed=("name" in body and body["name"]!=old_product.get("name"))
    code_changed=("code_name" in body and body["code_name"]!=old_product.get("code_name"))
    if name_changed or code_changed:
        linked_checks=[
            ("tanks",{"product_id":"eq."+product_id,"select":"id","limit":"1"}),
            ("dispenser_nozzles",{"product_id":"eq."+product_id,"select":"id","limit":"1"}),
            ("logistics_product_fees",{"product_id":"eq."+product_id,"select":"id","limit":"1"}),
            ("logistics_deliveries",{"product_id":"eq."+product_id,"select":"id","limit":"1"}),
            ("purchases",{"product_id":"eq."+product_id,"select":"id","limit":"1"}),
            ("nozzles",{"product":"eq."+str(old_product.get("name") or ""),"select":"id","limit":"1"})
        ]
        for linked_table,linked_params in linked_checks:
            linked_status,linked_rows=sb(linked_table,params=linked_params)
            if linked_status!=200:
                return jsonify({"error":"Could not verify product dependencies before renaming","table":linked_table,"details":linked_rows}),linked_status
            if linked_rows:
                return jsonify({"error":"This product is already connected to operational records. Rename/code changes are blocked to protect tank, dispenser, nozzle, purchase and delivery links. Keep the current name/code until a coordinated migration is available."}),409
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

    # Accept either the catalogue name (e.g. Gasoline) or its code (e.g. MGR),
    # but persist the canonical name and foreign key from the same catalogue row.
    ps, products = sb("products", params={"select":"id,name,code_name,active","limit":"1000"})
    if ps != 200:
        return jsonify({"error":"Unable to load product catalogue","details":products}),ps
    p = next((row for row in products if
              str(row.get("name") or "").strip().casefold() == product.casefold() or
              str(row.get("code_name") or "").strip().casefold() == product.casefold()), None)
    if not p:
        return jsonify({"error":"Product not found"}),404
    if not p.get("active"):
        return jsonify({"error":"Product is inactive"}),400
    product = str(p["name"]).strip()
    product_id = str(p["id"])
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
        "product_id":product_id,
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
    try: stock=float(data.get("stock_liters"))
    except (TypeError,ValueError): return jsonify({"error":"Invalid physical tank stock reading"}),400
    if stock<0:return jsonify({"error":"Tank stock cannot be negative"}),400
    remark=str(data.get("remark") or "").strip()
    if len(remark)>1000:return jsonify({"error":"Remark is too long"}),400
    purchase_id=str(data.get("purchase_id") or "").strip()
    try:event_index=int(data.get("event_index"))
    except (TypeError,ValueError):return jsonify({"error":"Discharge operation is required"}),400
    ps,purchases=sb("purchases",params={"id":"eq."+purchase_id,"select":"id,product,discharge_history","limit":"1"})
    if ps!=200:return jsonify(purchases),ps
    if not purchases:return jsonify({"error":"Purchase not found"}),404
    history=purchases[0].get("discharge_history") or []
    if not isinstance(history,list) or event_index<0 or event_index>=len(history):return jsonify({"error":"Discharge operation not found"}),404
    event=dict(history[event_index] or {})
    if str(event.get("tank_id") or "")!=str(tank_id):return jsonify({"error":"Selected tank does not match this discharge operation"}),400
    if event.get("tank_stock_recorded"):
        if not data.get("remark_only"):return jsonify({"error":"Physical tank stock for this discharge operation is already recorded"}),409
        event["tank_stock_remark"]=remark; history[event_index]=event
        ms,mr=sb("purchases",method="PATCH",params={"id":"eq."+purchase_id},body={"discharge_history":history},prefer="return=representation")
        if ms>=400:return jsonify({"error":"The physical reading was saved, but the remark could not be updated.","details":mr}),500
        # Refresh the Drive PDF after a stock remark edit; never undo a saved stock record
        # merely because the external Drive service is temporarily unavailable.
        drive_export=_auto_upload_completed_purchase_pdf(purchase_id)
        return jsonify({"ok":True,"event_index":event_index,"remark":remark,
                        "drive_pdf_uploaded":bool(drive_export.get("ok")),
                        "drive_pdf_error":drive_export.get("error")}),200
    try: expected_after=float(event.get("tank_liters_after"))
    except (TypeError,ValueError):return jsonify({"error":"This discharge has no recorded accounting closing balance"}),409
    difference=stock-expected_after
    now=datetime.now(timezone.utc).isoformat()
    event["tank_stock_recorded"]=True; event["tank_stock_recorded_liters"]=stock
    if data.get("stock_mm") is not None:
        try: stock_mm=float(data.get("stock_mm"))
        except (TypeError,ValueError):return jsonify({"error":"Invalid tank dip reading"}),400
        if stock_mm<0:return jsonify({"error":"Tank dip cannot be negative"}),400
        event["tank_stock_recorded_mm"]=stock_mm
    event["tank_stock_recorded_at"]=now
    event["tank_stock_difference_liters"]=difference
    event["tank_stock_adjustment_liters"]=difference  # legacy read-only field; never posted to tank_movements
    event["tank_stock_remark"]=remark
    history[event_index]=event
    ms,mr=sb("purchases",method="PATCH",params={"id":"eq."+purchase_id},body={"discharge_history":history},prefer="return=representation")
    if ms>=400:return jsonify({"error":"Physical tank reading could not be recorded.","details":mr}),500
    # The PDF is generated from the persisted purchase record on the Worker and uploaded
    # immediately when this was the final missing tank-stock reading.
    drive_export=_auto_upload_completed_purchase_pdf(purchase_id)
    return jsonify({"ok":True,"tank":None,"previous_liters":expected_after,"stock_liters":stock,"adjustment_liters":0,"physical_difference_liters":difference,"event_index":event_index,
                    "drive_pdf_uploaded":bool(drive_export.get("ok")),
                    "drive_pdf_error":drive_export.get("error")}),200

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
                # Tank activation must not require an opening stock/dip input.
                # Capture physical opening readings later in inventory or shift workflows.
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
    ps,pr=sb("products",params={"name":"eq."+product,"select":"id,name,code_name,active","limit":"1"})
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

    # Create both the legacy dispenser record and its normalized physical
    # dispenser/nozzle records. Activation and shift readings use the latter.
    status,result=sb("nozzles",method="POST",body={"nozzle_code":dispenser_code,"nozzle_ids":nozzle_ids,"product":product,"tank_id":tank_id,"nozzle_count":nozzle_count,"active":False},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    legacy=result[0] if isinstance(result,list) and result else {}
    legacy_id=str(legacy.get("id",""))
    ds,dispenser_rows=sb("dispensers",method="POST",body={"dispenser_code":dispenser_code,"active":False},prefer="return=representation")
    if ds>=400 or not dispenser_rows:
        if legacy_id:sb("nozzles",method="DELETE",params={"id":"eq."+legacy_id},prefer="return=minimal")
        return jsonify({"error":"Could not create the physical dispenser record","details":dispenser_rows}),ds if ds>=400 else 500
    physical_dispenser_id=str(dispenser_rows[0].get("id",""))
    created_physical_ids=[]
    for nozzle_number in range(1,nozzle_count+1):
        ns,nresult=sb("dispenser_nozzles",method="POST",body={
            "dispenser_id":physical_dispenser_id,
            "nozzle_number":nozzle_number,
            "nozzle_code":f"{dispenser_code}-N•{nozzle_number}",
            "product_id":pr[0].get("id"),
            "tank_id":tank_id,
            "active":False
        },prefer="return=representation")
        if ns>=400 or not nresult:
            for physical_id in created_physical_ids:
                sb("dispenser_nozzles",method="DELETE",params={"id":"eq."+physical_id},prefer="return=minimal")
            sb("dispensers",method="DELETE",params={"id":"eq."+physical_dispenser_id},prefer="return=minimal")
            if legacy_id:sb("nozzles",method="DELETE",params={"id":"eq."+legacy_id},prefer="return=minimal")
            return jsonify({"error":"Could not create all physical nozzle records","details":nresult}),ns if ns>=400 else 500
        created_physical_ids.append(str(nresult[0].get("id","")))
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

@app.post("/api/nozzles/<nozzle_id>/deactivation-request")
def request_nozzle_deactivation(nozzle_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    pin=str(data.get("pin","")).strip()
    if not pin or not pin.isdigit():return jsonify({"error":"Enter the admin PIN"}),400
    es,er=sb("employees",params={"id":"eq."+session["employee_id"],"active":"eq.true","role":"eq.admin","select":"id,operator_id,pin_hash"})
    if es!=200 or not er:return jsonify({"error":"Admin account not found"}),404
    if not verify_pin(pin,er[0].get("pin_hash","")):return jsonify({"error":"Invalid admin PIN"}),401
    status,result=rpc("request_dispenser_deactivation",{"p_nozzle_id":nozzle_id,"p_admin_id":session["employee_id"]})
    if status>=400:return jsonify({"error":result}),status
    return jsonify(result),201

@app.get("/api/dispenser-deactivation-requests")
def dispenser_deactivation_requests():
    auth=require_login()
    if auth:return auth
    params={"status":"eq.pending","select":"id,nozzle_id,shift_id,requested_by,attendant_id,requested_at,status","order":"requested_at.asc"}
    if session.get("role")!="admin":
        params["attendant_id"]="eq."+session["employee_id"]
    status,rows=sb("dispenser_deactivation_requests",params=params)
    if status!=200:return jsonify(rows),status
    if not rows:return jsonify([]),200
    nozzle_ids=sorted(set(str(x["nozzle_id"]) for x in rows if x.get("nozzle_id")))
    shift_ids=sorted(set(str(x["shift_id"]) for x in rows if x.get("shift_id")))
    ns,nrows=sb("nozzles",params={"id":"in.("+",".join(nozzle_ids)+")","select":"id,nozzle_code,product,tank_id,nozzle_ids,nozzle_count,active"}) if nozzle_ids else (200,[])
    ss,srows=sb("shifts",params={"id":"in.("+",".join(shift_ids)+")","select":"id,employee_id,nozzle_id,start_time,opening_tank_liters,opening_reading,status"}) if shift_ids else (200,[])
    nozzle_map={str(x["id"]):x for x in nrows} if ns==200 else {}
    shift_map={str(x["id"]):x for x in srows} if ss==200 else {}
    for row in rows:
        n=nozzle_map.get(str(row.get("nozzle_id")),{}); s=shift_map.get(str(row.get("shift_id")),{})
        rs,readings=sb("shift_nozzle_readings",params={"shift_id":"eq."+str(row["shift_id"]),"select":"id,nozzle_id,opening_reading,opening_liters","order":"created_at.asc"})
        readings=readings if rs==200 else []
        reading_ids=sorted(set(str(x.get("nozzle_id")) for x in readings if x.get("nozzle_id")))
        drs,drows=sb("dispenser_nozzles",params={"id":"in.("+",".join(reading_ids)+")","select":"id,nozzle_code,nozzle_number"}) if reading_ids else (200,[])
        reading_nozzles={str(x.get("id")):x for x in drows} if drs==200 else {}
        for reading_row in readings:
            dn=reading_nozzles.get(str(reading_row.get("nozzle_id")),{})
            reading_row["nozzle_code"]=dn.get("nozzle_code") or reading_row.get("nozzle_id")
            reading_row["nozzle_number"]=dn.get("nozzle_number")
        row["nozzle"]=n; row["nozzle_code"]=n.get("nozzle_code") or row.get("nozzle_id"); row["shift"]=s; row["nozzle_readings"]=readings
    return jsonify(rows),200

@app.post("/api/dispenser-deactivation-requests/<request_id>/cancel")
def cancel_nozzle_deactivation(request_id):
    auth=require_admin()
    if auth:return auth
    status,current=sb("dispenser_deactivation_requests",params={"id":"eq."+request_id,"status":"eq.pending","select":"id,nozzle_id,shift_id,status","limit":"1"})
    if status!=200:return jsonify({"error":current}),status
    if not current:return jsonify({"error":"Pending deactivation request not found"}),404
    status,result=sb("dispenser_deactivation_requests",method="PATCH",params={"id":"eq."+request_id,"status":"eq.pending"},body={"status":"cancelled"},prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status
    return jsonify({"ok":True,"request":result[0] if result else {"id":request_id,"status":"cancelled"}}),200

@app.post("/api/dispenser-deactivation-requests/<request_id>/confirm")
def confirm_nozzle_deactivation(request_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    pin=str(data.get("pin","")).strip()
    if not pin or not pin.isdigit():return jsonify({"error":"Enter your attendant PIN"}),400
    try: closing_tank_liters=float(data.get("closing_tank_liters"))
    except (TypeError,ValueError):return jsonify({"error":"Enter a valid closing tank stock"}),400
    readings=data.get("closing_nozzle_readings",[])
    if not isinstance(readings,list) or not readings:return jsonify({"error":"Closing reading is required for every nozzle"}),400
    es,er=sb("employees",params={"id":"eq."+eid,"active":"eq.true","role":"eq.attendant","select":"id,pin_hash"})
    if es!=200 or not er:return jsonify({"error":"Attendant account not found"}),404
    if not verify_pin(pin,er[0].get("pin_hash","")):return jsonify({"error":"Invalid attendant PIN"}),401
    status,result=rpc("confirm_dispenser_deactivation",{
        "p_request_id":request_id,
        "p_attendant_id":eid,
        "p_closing_nozzle_readings":readings,
        "p_closing_tank_liters":closing_tank_liters
    })
    if status>=400:return jsonify(result),status
    return jsonify(result),200

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
    new_count=int(body.get("nozzle_count",cur.get("nozzle_count") or 1))
    new_product_input=str(data.get("product",cur.get("product") or "")).strip()
    new_tank_id=str(data.get("tank_id",cur.get("tank_id") or "")).strip()
    product_row=None
    tank_row=None
    if "product" in data or "tank_id" in data:
        ps,products=sb("products",params={"select":"id,name,code_name,active","limit":"1000"})
        if ps!=200:return jsonify({"error":"Unable to load product catalogue","details":products}),ps
        product_row=next((p for p in products if
            str(p.get("name") or "").strip().casefold()==new_product_input.casefold() or
            str(p.get("code_name") or "").strip().casefold()==new_product_input.casefold()),None)
        if not product_row:return jsonify({"error":"Product not found"}),404
        if not product_row.get("active"):return jsonify({"error":"Product is inactive"}),400
        new_product=str(product_row.get("name") or "").strip()
        ts,tr=sb("tanks",params={"id":"eq."+new_tank_id,"select":"id,product,product_id,active","limit":"1"})
        if ts!=200:return jsonify({"error":tr}),ts
        if not tr:return jsonify({"error":"Tank not found"}),404
        tank_row=tr[0]
        if not tank_row.get("active"):return jsonify({"error":"Tank is inactive"}),400
        tank_product_id=str(tank_row.get("product_id") or "")
        if tank_product_id and tank_product_id!=str(product_row.get("id")):
            return jsonify({"error":"Dispenser product must match tank product"}),400
        if not tank_product_id and str(tank_row.get("product") or "").strip().casefold()!=new_product.casefold():
            return jsonify({"error":"Dispenser product must match tank product"}),400
        body["product"]=new_product
        body["tank_id"]=new_tank_id
    else:
        new_product=new_product_input
        ps,products=sb("products",params={"select":"id,name,code_name,active","limit":"1000"})
        if ps!=200:return jsonify({"error":"Unable to load product catalogue","details":products}),ps
        product_row=next((p for p in products if str(p.get("name") or "").strip().casefold()==new_product.casefold()),None)
        if not product_row:
            return jsonify({"error":"The dispenser product is not linked to the current product catalogue. Select its catalogue product and tank to repair the link."}),409

    if "nozzle_count" in data and new_count!=int(cur.get("nozzle_count") or 1):
        ss,sr=sb("shifts",params={"nozzle_id":"eq."+nozzle_id,"status":"in.(assigned,active)","select":"id","limit":"1"})
        if ss!=200:return jsonify({"error":sr}),ss
        if sr:return jsonify({"error":"Nozzle count cannot be changed while this dispenser has an assigned or active shift."}),409

    # Preflight normalized records before changing the legacy row. Their UUIDs
    # are referenced by shift readings, so existing physical rows are updated
    # in place and never deleted/recreated.
    ds,dispenser_rows=sb("dispensers",params={"dispenser_code":"eq."+str(cur.get("nozzle_code") or ""),"select":"id,dispenser_code,active","limit":"1"})
    if ds!=200:return jsonify({"error":"Could not load physical dispenser record","details":dispenser_rows}),ds
    if not dispenser_rows:
        return jsonify({"error":"Physical dispenser record is missing for "+str(cur.get("nozzle_code") or "")+". No changes were saved."}),409
    physical_dispenser=dispenser_rows[0]
    physical_id=str(physical_dispenser["id"])
    dns,physical_rows=sb("dispenser_nozzles",params={"dispenser_id":"eq."+physical_id,"select":"id,dispenser_id,nozzle_number,nozzle_code,product_id,tank_id,active","order":"nozzle_number.asc"})
    if dns!=200:return jsonify({"error":"Could not load physical nozzle records","details":physical_rows}),dns

    # Handle the existing reorder UI's swap while preserving stable physical IDs.
    code_updates={nozzle_id:None}
    if "tank_order" in data:
        try: order=int(data["tank_order"])
        except (TypeError,ValueError): return jsonify({"error":"Invalid dispenser order"}),400
        if order<1:return jsonify({"error":"Dispenser order must be 1 or greater"}),400
        code_name=str(product_row.get("code_name") or "").strip()
        import re
        pattern=re.compile(r"^"+re.escape(code_name)+r"•DISPENSER (\d+)$",re.IGNORECASE)
        current_match=pattern.match(str(cur["nozzle_code"]))
        current_order=int(current_match.group(1)) if current_match else None
        if current_order is None:return jsonify({"error":"Current dispenser order could not be determined"}),400
        ts,same=sb("nozzles",params={"select":"id,nozzle_code,product","product":"eq."+new_product})
        if ts!=200:return jsonify({"error":same}),ts
        max_order=max([int(m.group(1)) for x in same if (m:=pattern.match(str(x.get("nozzle_code",""))))] or [0])
        if order>max_order:return jsonify({"error":"Select one of the existing dispenser orders"}),400
        if order!=current_order:
            target=next((x for x in same if x["id"]!=nozzle_id and pattern.match(str(x.get("nozzle_code",""))) and int(pattern.match(str(x["nozzle_code"])).group(1))==order),None)
            if not target:return jsonify({"error":"Selected dispenser order is not available"}),400
            target_ds,target_dispenser=sb("dispensers",params={"dispenser_code":"eq."+str(target["nozzle_code"]),"select":"id,dispenser_code","limit":"1"})
            if target_ds!=200:return jsonify({"error":"Could not load the other physical dispenser"}),target_ds
            if not target_dispenser:return jsonify({"error":"Physical dispenser record is missing for "+str(target["nozzle_code"])+". No changes were saved."}),409
            current_code=f"{code_name}•DISPENSER {current_order}"
            target_code=f"{code_name}•DISPENSER {order}"
            temp_code=f"{code_name}•DISPENSER __swap__{nozzle_id}"
            status,_=sb("nozzles",method="PATCH",params={"id":"eq."+target["id"]},body={"nozzle_code":temp_code},prefer="return=minimal")
            if status>=400:return jsonify({"error":"Could not prepare dispenser order swap"}),status
            status,_=sb("nozzles",method="PATCH",params={"id":"eq."+nozzle_id},body={"nozzle_code":target_code},prefer="return=minimal")
            if status>=400:return jsonify({"error":"Could not change dispenser order"}),status
            status,_=sb("nozzles",method="PATCH",params={"id":"eq."+target["id"]},body={"nozzle_code":current_code},prefer="return=minimal")
            if status>=400:return jsonify({"error":"Could not complete dispenser order swap"}),status
            # Reflect the swap in both normalized dispenser records and their labels.
            for legacy_id,final_code in ((nozzle_id,target_code),(str(target["id"]),current_code)):
                legacy_ds,legacy_rows=sb("nozzles",params={"id":"eq."+legacy_id,"select":"id,nozzle_code,product,tank_id,nozzle_count","limit":"1"})
                if legacy_ds!=200 or not legacy_rows:return jsonify({"error":"Dispenser order changed in legacy records but normalized synchronization failed; retry the order sync."}),500
                nds,ndrows=sb("dispensers",params={"dispenser_code":"eq."+temp_code if legacy_id==str(target["id"]) else "eq."+str(cur["nozzle_code"]),"select":"id,dispenser_code","limit":"1"})
                # Locate by the preflight UUID when possible, avoiding any dependence on a changing code.
                wanted_id=physical_id if legacy_id==nozzle_id else str(target_dispenser[0]["id"])
                st,_=sb("dispensers",method="PATCH",params={"id":"eq."+wanted_id},body={"dispenser_code":final_code},prefer="return=minimal")
                if st>=400:return jsonify({"error":"Legacy order changed but normalized dispenser sync failed"}),st
                pstatus,prows=sb("dispenser_nozzles",params={"dispenser_id":"eq."+wanted_id,"select":"id,nozzle_number"})
                if pstatus!=200:return jsonify({"error":"Could not synchronize physical nozzle labels"}),pstatus
                for pn in prows:
                    pnum=int(pn.get("nozzle_number") or 1)
                    st,_=sb("dispenser_nozzles",method="PATCH",params={"id":"eq."+str(pn["id"])},body={"nozzle_code":f"{final_code}-N•{pnum}"},prefer="return=minimal")
                    if st>=400:return jsonify({"error":"Legacy order changed but physical nozzle label sync failed"}),st
            # Reload current legacy record after the swap before applying remaining edits.
            status,current=sb("nozzles",params={"id":"eq."+nozzle_id,"select":"id,nozzle_code,nozzle_ids,nozzle_count,product,tank_id,active"})
            if status!=200 or not current:return jsonify({"error":"Could not reload dispenser after order change"}),status
            cur=current[0]
            body["nozzle_code"]=target_code
    elif "product" in data:
        # Moving to another product gets the next available number in that product group.
        code_name=str(product_row.get("code_name") or "").strip()
        ts,rows=sb("nozzles",params={"select":"nozzle_code","product":"eq."+new_product})
        if ts!=200:return jsonify({"error":rows}),ts
        import re
        pattern=re.compile(r"^"+re.escape(code_name)+r"•DISPENSER (\d+)$",re.IGNORECASE)
        max_order=max([int(m.group(1)) for x in rows if (m:=pattern.match(str(x.get("nozzle_code",""))))] or [0])
        body["nozzle_code"]=f"{code_name}•DISPENSER {max_order+1}"

    # Never allow generic PATCH to deactivate an active dispenser.
    if data.get("active") is False and cur.get("active") is True:
        return jsonify({"error":"Active dispenser deactivation must be confirmed by the admin and then by the assigned attendant."}),409

    final_code=str(body.get("nozzle_code",cur["nozzle_code"]))
    if "nozzle_code" in body or "nozzle_count" in body:
        body["nozzle_ids"]=[f"{final_code}-N•{i}" for i in range(1,new_count+1)]
    if not body:return jsonify({"error":"No changes supplied"}),400

    # If changing product/tank, ensure the destination code is not already used.
    if final_code!=str(cur.get("nozzle_code")):
        cs,clash=sb("nozzles",params={"nozzle_code":"eq."+final_code,"select":"id","limit":"1"})
        if cs!=200:return jsonify({"error":clash}),cs
        if clash and str(clash[0].get("id"))!=nozzle_id:return jsonify({"error":"The destination dispenser code is already in use."}),409

    status,result=sb("nozzles",method="PATCH",params={"id":"eq."+nozzle_id},body=body,prefer="return=representation")
    if status>=400:return jsonify({"error":result}),status

    # Synchronize normalized parent and physical nozzle rows. Keep physical UUIDs
    # stable; additions create only missing numbers and reductions deactivate extras.
    if final_code!=str(cur.get("nozzle_code")):
        st,_=sb("dispensers",method="PATCH",params={"id":"eq."+physical_id},body={"dispenser_code":final_code},prefer="return=minimal")
        if st>=400:return jsonify({"error":"Legacy dispenser saved but normalized dispenser code sync failed","details":_}),st
    if product_row:
        product_id=str(product_row.get("id"))
        for pn in physical_rows:
            pnum=int(pn.get("nozzle_number") or 1)
            pbody={"product_id":product_id,"tank_id":new_tank_id,"nozzle_code":f"{final_code}-N•{pnum}"}
            if pnum>new_count:
                pbody["active"]=False
            st,res=sb("dispenser_nozzles",method="PATCH",params={"id":"eq."+str(pn["id"])},body=pbody,prefer="return=minimal")
            if st>=400:return jsonify({"error":"Legacy dispenser saved but physical nozzle synchronization failed","details":res}),st
        existing_numbers={int(pn.get("nozzle_number") or 1) for pn in physical_rows}
        for pnum in range(1,new_count+1):
            if pnum in existing_numbers:continue
            st,res=sb("dispenser_nozzles",method="POST",body={
                "dispenser_id":physical_id,"nozzle_number":pnum,
                "nozzle_code":f"{final_code}-N•{pnum}","product_id":product_id,
                "tank_id":new_tank_id,"active":False
            },prefer="return=representation")
            if st>=400:return jsonify({"error":"Legacy dispenser saved but a new physical nozzle could not be created","details":res}),st
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
    opening_tank_dip_mm=data.get("opening_tank_dip_mm")
    if activation_nozzles is not None:
        if not isinstance(activation_nozzles,list) or not activation_nozzles:
            return jsonify({"error":"At least one nozzle must be activated"}),400
        try:
            opening_tank_liters=float(opening_tank_liters)
        except (TypeError,ValueError):
            return jsonify({"error":"Invalid tank opening liters"}),400
        if opening_tank_liters < 0:
            return jsonify({"error":"Tank opening liters cannot be negative"}),400
        try:
            opening_tank_dip_mm=float(opening_tank_dip_mm)
        except (TypeError,ValueError):
            return jsonify({"error":"Enter a valid tank opening dip in millimeters"}),400
        if opening_tank_dip_mm < 0:
            return jsonify({"error":"Tank opening dip cannot be negative"}),400
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
        body["opening_tank_dip_mm"]=opening_tank_dip_mm
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
    es,er=sb("employees",params={"id":"eq."+eid,"active":"eq.true","select":"id,role,pin_hash,name"})
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
    params={"id":"eq."+shift_id,"status":"eq.assigned","select":"id,nozzle_id"}
    if session.get("role")!="admin":
        params["employee_id"]="eq."+eid
    status,current=sb("shifts",params=params)
    if status!=200:return jsonify({"error":current}),status
    if not current:return jsonify({"error":"Pending shift assignment not found"}),404
    nozzle_id=current[0].get("nozzle_id")
    status,result=sb("shifts",method="PATCH",params={"id":"eq."+shift_id},body={
        "status":"cancelled",
        "end_time":datetime.now(timezone.utc).isoformat()
    },prefer="return=representation")
    if status>=400:return jsonify(result),status
    if nozzle_id:
        ss,sr=sb("shifts",params={"nozzle_id":"eq."+str(nozzle_id),"status":"in.(assigned,active)","select":"id","limit":"1"})
        if ss==200 and not sr:
            sb("nozzles",method="PATCH",params={"id":"eq."+str(nozzle_id)},body={"active":False},prefer="return=minimal")
            sb("dispenser_nozzles",method="PATCH",params={"dispenser_id":"eq."+str(nozzle_id)},body={"active":False},prefer="return=minimal")
    return jsonify(result),200

@app.post("/api/shifts/<shift_id>/start")
def start_shift(shift_id):
    return jsonify({"error":"Use Attendant PIN confirmation to activate this shift"}),410

@app.post("/api/shifts/<shift_id>/close")
def close_shift(shift_id):
    # Legacy direct shift closing is disabled. Shift closure must go through
    # the controlled handover/deactivation workflows so nozzle readings and
    # tank reconciliation are recorded atomically.
    return jsonify({
        "error":"Direct shift closing is disabled. Use shift handover or dispenser deactivation."
    }),410

@app.get("/api/sales")
def sales():
    auth=require_login()
    if auth:return auth
    params={"select":"*","order":"sale_time.desc","limit":"500"}
    if session.get("role")!="admin":params["employee_id"]="eq."+session["employee_id"]
    status,rows=sb("sales",params=params)
    return jsonify(rows),status

@app.get("/api/dashboard/today-sales")
def dashboard_today_sales():
    auth=require_admin()
    if auth:return auth
    # Use the current shift-takeover workflow and Addis Ababa's calendar date.
    # Include sales awaiting admin confirmation as well as confirmed sales,
    # but exclude cancelled/unfinished records and count each shift once.
    today=(datetime.now(timezone.utc)+timedelta(hours=3)).date()
    ss,shift_rows=sb("shifts",params={"select":"id,start_time","limit":"5000"})
    if ss>=400:return jsonify({"error":"Unable to load shifts for today's sales"}),ss
    today_shift_ids={str(row.get("id")) for row in (shift_rows or [])
                     if _local_date_from_iso(row.get("start_time"))==today}
    if not today_shift_ids:return jsonify({"date":today.isoformat(),"count":0,"amount":0}),200
    ts,takeovers=sb("shift_takeovers",params={
        "select":"id,shift_id,sales_status,total_sales_amount",
        "sales_status":"in.(pending_admin,confirmed)",
        "limit":"5000"
    })
    if ts>=400:return jsonify({"error":"Unable to load today's shift sales"}),ts
    rows=[row for row in (takeovers or []) if str(row.get("shift_id")) in today_shift_ids]
    total=sum(float(row.get("total_sales_amount") or 0) for row in rows)
    return jsonify({"date":today.isoformat(),"count":len(rows),"amount":round(total,2)}),200

@app.post("/api/sales")
def create_sale():
    # Fuel-volume sales are authoritative from nozzle meter reconciliation.
    # Direct manual fuel-sale creation would create a second tank SALE
    # movement for the same liters during shift close/deactivation.
    return jsonify({
        "error":"Direct fuel-volume sales are disabled. Fuel sales are recorded from nozzle meter reconciliation during shift handover or dispenser deactivation."
    }),410

@app.get("/api/shift-purchase-discharges")
def shift_purchase_discharges():
    auth=require_login()
    if auth:return auth
    shift_id=str(request.args.get("shift_id") or "").strip()
    if not shift_id:return jsonify({"error":"shift_id is required"}),400

    ss,shift_rows=sb("shifts",params={
        "id":"eq."+shift_id,
        "select":"id,employee_id,nozzle_id,start_time,end_time,status",
        "limit":"1"
    })
    if ss!=200:return jsonify({"error":"Unable to load shift"}),ss
    if not shift_rows:return jsonify({"error":"Shift not found"}),404
    shift=shift_rows[0]
    is_admin=session.get("role")=="admin"
    if not is_admin and str(shift.get("employee_id") or "")!=str(session.get("employee_id") or ""):
        return jsonify({"error":"You can only view purchase discharges for your own shift"}),403

    def _shift_discharge_parse_dt(value):
        if not value:return None
        try:
            parsed=datetime.fromisoformat(str(value).replace("Z","+00:00"))
            if parsed.tzinfo is None:parsed=parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:return None

    started=_shift_discharge_parse_dt(shift.get("start_time"))
    ended=_shift_discharge_parse_dt(shift.get("end_time"))
    if not started:return jsonify({"error":"Shift start time is unavailable"}),422

    # Resolve the physical tank from normalized nozzle readings first. A single
    # shift can have multiple nozzles, so include every tank actually connected.
    tank_ids=set()
    rs,reading_rows=sb("shift_nozzle_readings",params={
        "shift_id":"eq."+shift_id,
        "select":"nozzle_id"
    })
    if rs==200:
        nozzle_ids=sorted(set(str(x.get("nozzle_id")) for x in reading_rows if x.get("nozzle_id")))
        if nozzle_ids:
            ns,nozzle_rows=sb("dispenser_nozzles",params={
                "id":"in.("+",".join(nozzle_ids)+")",
                "select":"id,tank_id"
            })
            if ns==200:
                tank_ids.update(str(x.get("tank_id")) for x in nozzle_rows if x.get("tank_id"))
    # Legacy fallback for older shifts without normalized readings.
    if not tank_ids and shift.get("nozzle_id"):
        ns,legacy_rows=sb("nozzles",params={
            "id":"eq."+str(shift.get("nozzle_id")),
            "select":"id,tank_id",
            "limit":"1"
        })
        if ns==200 and legacy_rows and legacy_rows[0].get("tank_id"):
            tank_ids.add(str(legacy_rows[0]["tank_id"]))

    if not tank_ids:return jsonify([]),200
    ps,purchases_rows=sb("purchases",params={
        "select":"*",
        "order":"purchase_date.desc",
        "limit":"200"
    })
    if ps!=200:return jsonify({"error":"Unable to load purchase discharge records"}),ps

    employee_name=None
    es,employee_rows=sb("employees",params={
        "id":"eq."+str(shift.get("employee_id") or ""),
        "select":"id,name",
        "limit":"1"
    })
    if es==200 and employee_rows:employee_name=employee_rows[0].get("name")

    output=[]
    for purchase in purchases_rows or []:
        for operation in purchase.get("discharge_history") or []:
            if not isinstance(operation,dict):continue
            tank_id=str(operation.get("tank_id") or "")
            if tank_id not in tank_ids:continue
            discharged_at=operation.get("discharge_datetime") or operation.get("discharged_at")
            discharged_dt=_shift_discharge_parse_dt(discharged_at)
            if not discharged_dt or discharged_dt<started or (ended and discharged_dt>=ended):continue
            quantity=operation.get("discharged_quantity_liters",operation.get("quantity_liters",0))
            try:quantity=float(quantity or 0)
            except (TypeError,ValueError):quantity=0
            if quantity<=0:continue
            output.append({
                "purchase_id":purchase.get("id"),
                "invoice_number":purchase.get("invoice_number") or purchase.get("invoice") or "—",
                "product":purchase.get("product") or "—",
                "tank_id":tank_id,
                "tank_code":operation.get("tank_code") or "Tank",
                "discharge_datetime":discharged_at,
                "quantity_liters":quantity,
                "attendant_name":employee_name or "Attendant not identified",
                "attendant_shift_id":shift_id,
                "attribution_status":"inside_shift" if employee_name else "attendant_unknown"
            })
    output.sort(key=lambda x:str(x.get("discharge_datetime") or ""))
    return jsonify(output),200


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

    # Attribute each discharge to the attendant whose shift was running on
    # the same physical tank at that timestamp, never to the admin recorder.
    try:
        ss,shift_rows=sb("shifts",params={"select":"id,employee_id,nozzle_id,start_time,end_time,status","order":"start_time.desc","limit":"10000"})
        if ss==200:
            # Shift.nozzle_id is a legacy nozzles.id, not a dispenser_nozzles.id.
            # Prefer normalized shift readings to resolve the actual physical tank.
            shift_ids=sorted(set(str(x.get("id")) for x in shift_rows if x.get("id")))
            shift_tank_map={}
            if shift_ids:
                rs,reading_rows=sb("shift_nozzle_readings",params={"shift_id":"in.("+",".join(shift_ids)+")","select":"shift_id,nozzle_id"})
                if rs==200:
                    reading_nozzle_ids=sorted(set(str(x.get("nozzle_id")) for x in reading_rows if x.get("nozzle_id")))
                    reading_tank_map={}
                    if reading_nozzle_ids:
                        ns,nozzle_rows=sb("dispenser_nozzles",params={"id":"in.("+",".join(reading_nozzle_ids)+")","select":"id,tank_id"})
                        if ns==200:reading_tank_map={str(x.get("id")):str(x.get("tank_id")) for x in nozzle_rows if x.get("id") and x.get("tank_id")}
                    for reading in reading_rows:
                        tid=reading_tank_map.get(str(reading.get("nozzle_id") or ""))
                        if tid:shift_tank_map.setdefault(str(reading.get("shift_id")),set()).add(tid)
            # Fall back to the legacy nozzle relation for older shifts without normalized readings.
            legacy_ids=sorted(set(str(x.get("nozzle_id")) for x in shift_rows if x.get("nozzle_id")))
            if legacy_ids:
                ns,legacy_rows=sb("nozzles",params={"id":"in.("+",".join(legacy_ids)+")","select":"id,tank_id"})
                if ns==200:
                    legacy_tank_map={str(x.get("id")):str(x.get("tank_id")) for x in legacy_rows if x.get("id") and x.get("tank_id")}
                    for sh in shift_rows:
                        tid=legacy_tank_map.get(str(sh.get("nozzle_id") or ""))
                        if tid:shift_tank_map.setdefault(str(sh.get("id")),set()).add(tid)
            employee_ids=sorted(set(str(x.get("employee_id")) for x in shift_rows if x.get("employee_id")))
            employee_name_map={}
            if employee_ids:
                es,employee_rows=sb("employees",params={"id":"in.("+",".join(employee_ids)+")","select":"id,name","limit":"10000"})
                if es==200:employee_name_map={str(x.get("id")):str(x.get("name") or "").strip() for x in employee_rows}
            def _purchase_parse_dt(value):
                if not value:return None
                try:
                    parsed=datetime.fromisoformat(str(value).replace("Z","+00:00"))
                    if parsed.tzinfo is None:parsed=parsed.replace(tzinfo=timezone.utc)
                    return parsed.astimezone(timezone.utc)
                except Exception:return None
            for purchase in rows or []:
                enriched=[]
                for operation in purchase.get("discharge_history") or []:
                    op=dict(operation) if isinstance(operation,dict) else {}
                    dt=_purchase_parse_dt(op.get("discharge_datetime") or op.get("discharged_at"))
                    tank_id=str(op.get("tank_id") or "")
                    if not dt:
                        op["attendant_name"]=None
                        op["attendant_attribution_status"]="invalid_timestamp"
                        enriched.append(op)
                        continue
                    matches=[]
                    for sh in shift_rows or []:
                        started=_purchase_parse_dt(sh.get("start_time"))
                        ended=_purchase_parse_dt(sh.get("end_time"))
                        shift_tanks=shift_tank_map.get(str(sh.get("id") or ""),set())
                        if not started or not tank_id or tank_id not in shift_tanks:continue
                        if started<=dt and (ended is None or dt<ended):matches.append(sh)
                    if len(matches)==1:
                        sh=matches[0]
                        op["attendant_name"]=employee_name_map.get(str(sh.get("employee_id") or "")) or None
                        op["attendant_shift_id"]=sh.get("id")
                        op["attendant_attribution_status"]="inside_shift" if op.get("attendant_name") else "attendant_unknown"
                    elif len(matches)>1:
                        op["attendant_name"]=None
                        op["attendant_shift_id"]=None
                        op["attendant_attribution_status"]="ambiguous_overlap"
                    else:
                        op["attendant_name"]=None
                        op["attendant_shift_id"]=None
                        op["attendant_attribution_status"]="outside_shift"
                    enriched.append(op)
                purchase["discharge_history"]=enriched
                purchase["attendant"]=None
    except Exception:
        # Keep purchases available if attribution lookups are temporarily unavailable.
        for purchase in rows or []:purchase["attendant"]=None
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
    # PDFs always identify fuel by the configured product code, never the display name.
    product_code=p.get("product_code") or p.get("product") or "—"
    ps,product_rows=sb("products",params={"select":"code_name,name","limit":"500"})
    if ps==200:
        raw_product=str(p.get("product") or "").strip().lower()
        for product_row in product_rows:
            if raw_product in (str(product_row.get("code_name") or "").strip().lower(), str(product_row.get("name") or "").strip().lower()):
                product_code=product_row.get("code_name") or product_code
                break
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
        "Product code: "+clean(product_code),
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
        before=e.get("physical_tank_liters_before")
        if before is None: before=e.get("tank_liters_before")  # legacy discharge-history records
        quantity=e.get("discharged_quantity_liters")
        expected=e.get("tank_liters_after")
        if expected is None and before is not None and quantity is not None:
            try: expected=float(before)+float(quantity)
            except (TypeError,ValueError): expected=None
        recorded=e.get("tank_stock_recorded_liters")
        if recorded is None: recorded=e.get("physical_tank_liters_after")
        if recorded is None: recorded=e.get("tank_stock_closing_liters")
        if expected is None: expected=e.get("expected_tank_liters_after")
        difference=e.get("tank_stock_difference_liters")
        if difference is None: difference=e.get("tank_stock_adjustment_liters")
        if difference is None: difference=e.get("physical_vs_system_difference_liters")
        if difference is None: difference=e.get("stock_difference_liters")
        if difference is None and recorded is not None and expected is not None:
            try: difference=float(recorded)-float(expected)
            except (TypeError,ValueError): difference=None
        try: tolerance=max(5.0,float(quantity or 0)*0.01)
        except (TypeError,ValueError): tolerance=5.0
        stock_status=("Stock reconciled" if difference is None or abs(float(difference))<=tolerance else "Difference high") if e.get("tank_stock_recorded") else "Tank stock not recorded"
        lines += [
            "Discharge %02d"%(i+1),
            "Date & time: "+clean(e.get("discharge_datetime") or e.get("created_at")),
            "Tank: "+clean(e.get("tank_code") or e.get("tank_id")),
            "Quantity discharged: "+fmt(quantity)+" L",
            "Tank stock before: "+fmt(before)+" L",
            "Expected closing: "+fmt(expected)+" L",
            "Recorded closing: "+(fmt(recorded)+" L" if e.get("tank_stock_recorded") else "Not recorded"),
            "Stock difference: "+((("+" if float(difference)>0 else "")+fmt(difference)+" L") if difference is not None else "—"),
            "Stock status: "+stock_status,
        ]
        remark=str(e.get("tank_stock_remark") or "").strip()
        if remark: lines.append("Remark: "+clean(remark))
        lines.append("")
    note_lines=[]
    for i,e in enumerate(history):
        note=str(e.get("tank_stock_remark") or e.get("remark") or e.get("purchase_remark") or "").strip()
        if note:
            note_lines.append(("Discharge %02d remark: "%(i+1))+clean(note))
    purchase_note=str(p.get("purchase_remark") or p.get("purchase_remark_note") or p.get("remark") or p.get("tank_stock_remark") or "").strip()
    if purchase_note and purchase_note not in [str(e.get("tank_stock_remark") or "").strip() for e in history]:
        note_lines.append("Purchase note: "+clean(purchase_note))
    if note_lines:
        lines += ["PURCHASE REMARK"]+note_lines

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

def _auto_upload_completed_purchase_pdf(purchase_id):
    """Render and upload a completed purchase PDF from the saved server-side record."""
    try:
        status, rows = sb("purchases", params={"id": "eq." + str(purchase_id), "select": "*", "limit": "1"})
        if status != 200:
            return {"ok": False, "error": "Could not read purchase record (HTTP %s)" % status}
        if not rows:
            return {"ok": False, "error": "Purchase not found"}
        purchase = rows[0]
        history = purchase.get("discharge_history") or []
        if str(purchase.get("status") or "").lower() != "discharged" or not history or not all(
            isinstance(event, dict) and event.get("tank_stock_recorded") is True for event in history
        ):
            return {"ok": False, "skipped": True, "error": "Purchase is not fully discharged with every tank-stock reading recorded"}

        settings = _drive_settings() or {}
        root = settings.get("purchase_folder_id")
        if not root:
            return {"ok": False, "error": "Purchases PDF folder is not configured"}

        # The server renderer includes tank stock before, expected/recorded closing,
        # stock difference, and any saved discharge/purchase remarks.
        rendered = purchase_pdf(str(purchase_id))
        if isinstance(rendered, tuple):
            response = rendered[0] if rendered else None
            response_status = rendered[1] if len(rendered) > 1 and isinstance(rendered[1], int) else getattr(response, "status_code", 200)
        else:
            response = rendered
            response_status = getattr(response, "status_code", 200)
        if response_status != 200:
            return {"ok": False, "error": "Purchase PDF generation failed (HTTP %s)" % response_status}
        if response is None or not hasattr(response, "get_data"):
            return {"ok": False, "error": "Purchase PDF renderer did not return a Flask response"}
        pdf = response.get_data()
        if not pdf or not pdf.startswith(b"%PDF"):
            return {"ok": False, "error": "Server generated an invalid purchase PDF"}

        raw_invoice = str(purchase.get("invoice_number") or purchase_id)
        safe_invoice = re.sub(r"[^A-Za-z0-9_.-]+", "_", raw_invoice).strip("._")[:80] or str(purchase_id)
        file_name = "purchase_" + safe_invoice + ".pdf"
        raw_date = str(purchase.get("purchase_date") or purchase.get("created_at") or "")[:10]
        try:
            purchase_day = date.fromisoformat(raw_date)
        except Exception:
            purchase_day = datetime.now(timezone.utc).date()
        folder_name = purchase_day.strftime("%B %Y")
        file_id, link = drive.store_pdf(env(), root, folder_name, file_name, pdf)
        return {"ok": True, "file_id": file_id, "url": link,
                "path": "PURCHASES/%s/%s" % (folder_name, file_name)}
    except drive.DriveError as err:
        return {"ok": False, "error": str(err)}
    except Exception as err:
        return {"ok": False, "error": str(err) or "Automatic purchase PDF upload failed"}


@app.post("/api/drive/purchases/retry")
def drive_retry_completed_purchase_pdfs():
    """Retry eligible completed purchase PDFs and return per-invoice diagnostics."""
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    requested_id=str(data.get("purchase_id") or "").strip()
    query_params={
        "status":"eq.discharged",
        "select":"id,invoice_number,status,discharge_history",
        "order":"created_at.desc",
        "limit":"250"
    }
    # A page-level fallback can retry just the purchase whose browser upload failed.
    # Omitting purchase_id preserves the administrator's bulk retry behavior.
    if requested_id:
        query_params["id"]="eq."+requested_id
    status, purchases = sb("purchases", params=query_params)
    if status != 200:
        return jsonify({"ok":False,"error":"Could not list completed purchases","details":purchases}), status
    results=[]
    for purchase in purchases or []:
        history=purchase.get("discharge_history") or []
        if not history or not all(isinstance(event,dict) and event.get("tank_stock_recorded") is True for event in history):
            continue
        outcome=_auto_upload_completed_purchase_pdf(purchase.get("id"))
        results.append({
            "invoice_number":purchase.get("invoice_number") or str(purchase.get("id")),
            "ok":bool(outcome.get("ok")) and not bool(outcome.get("skipped")),
            "path":outcome.get("path"),
            "error":outcome.get("error"),
            "skipped":bool(outcome.get("skipped"))
        })
    failed=[item for item in results if not item["ok"] and not item["skipped"]]
    skipped=sum(1 for item in results if item["skipped"])
    uploaded=sum(1 for item in results if item["ok"])
    return jsonify({"ok":not failed,"checked":len(results),"uploaded":uploaded,"skipped":skipped,
                    "message":"Skipped PDFs are uploaded by the Purchases page using the canonical Download PDF renderer.",
                    "failed":failed,"results":results}), (200 if not failed else 502)


@app.post("/api/purchases")
def create_purchase():
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    product=str(data.get("product","")).strip()
    try: qty=float(data.get("quantity_liters",0))
    except (TypeError,ValueError):return jsonify({"error":"Invalid quantity"}),400
    try: ordered=float(data.get("ordered_quantity_liters")) if data.get("ordered_quantity_liters") is not None else None
    except (TypeError,ValueError):return jsonify({"error":"Invalid ordered quantity"}),400
    if not product or qty<=0:return jsonify({"error":"Product and positive quantity are required"}),400

    compartments=data.get("truck_compartments")
    try: compartments=int(compartments) if compartments is not None else None
    except (TypeError,ValueError):return jsonify({"error":"Invalid truck compartments"}),400
    status,result=rpc("record_pending_fuel_purchase",{
        "p_product":product,
        "p_quantity_liters":qty,
        "p_tank_id":None,
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
    purchase_obj=result.get("purchase") if isinstance(result,dict) else None
    purchase_id=(purchase_obj or {}).get("id") if isinstance(purchase_obj,dict) else None
    if purchase_id: _notify_admin_push(str(purchase_id), "Fuel Shift System", "admin_purchase_pending")
    purchase_remark=str(data.get("purchase_remark") or "").strip()
    if purchase_remark:
        if len(purchase_remark)>5000:return jsonify({"error":"Purchase remark must be 5000 characters or fewer"}),400
        purchase_obj=result.get("purchase") if isinstance(result,dict) else None
        purchase_id=(purchase_obj or {}).get("id") if isinstance(purchase_obj,dict) else None
        if not purchase_id:return jsonify({"error":"Purchase was created, but its ID was not returned so the remark could not be saved."}),500
        remark_status,remark_result=sb("purchases",method="PATCH",params={"id":"eq."+str(purchase_id)},body={"purchase_remark":purchase_remark},prefer="return=representation")
        if remark_status>=400:return jsonify({"error":"Purchase was created, but its remark could not be saved.","details":remark_result,"purchase":result}),500
        if isinstance(result,dict) and isinstance(result.get("purchase"),dict):
            result["purchase"]["purchase_remark"]=purchase_remark
    return jsonify(result),201

@app.patch("/api/purchases/<purchase_id>/remark")
def update_purchase_remark(purchase_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    remark=str(data.get("purchase_remark") or "").strip()
    if len(remark)>5000:return jsonify({"error":"Purchase remark must be 5000 characters or fewer"}),400
    ps,rows=sb("purchases",params={"id":"eq."+str(purchase_id),"select":"id","limit":"1"})
    if ps!=200:return jsonify({"error":"Unable to verify purchase","details":rows}),ps
    if not rows:return jsonify({"error":"Purchase not found"}),404
    status,result=sb("purchases",method="PATCH",params={"id":"eq."+str(purchase_id)},body={"purchase_remark":remark},prefer="return=representation")
    if status>=400:return jsonify({"error":"Purchase remark could not be saved","details":result}),status
    # Keep the Drive PDF in sync if the purchase has already completed.
    drive_export=_auto_upload_completed_purchase_pdf(purchase_id)
    return jsonify({"ok":True,"purchase_id":str(purchase_id),"purchase_remark":remark,
                    "drive_pdf_uploaded":bool(drive_export.get("ok")),
                    "drive_pdf_error":drive_export.get("error")}),200

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
    _notify_admin_low_stock()
    return jsonify(result),200

@app.get("/api/accounting/reconciliation")
def accounting_reconciliation():
    auth=require_admin()
    if auth:return auth
    ps,periods=sb("accounting_periods",params={"status":"eq.OPEN","select":"id,name,status,starts_at,ends_at,opened_by,notes","order":"created_at.desc","limit":"1"})
    if ps!=200:return jsonify(periods),ps
    if not periods:return jsonify({"open":False,"period":None,"tanks":[]}),200
    period=periods[0]
    os,openings=sb("tank_opening_snapshots",params={"accounting_period_id":"eq."+str(period["id"]),"select":"tank_id,physical_liters,physical_height_mm,measured_at,calibration_version"})
    if os!=200:return jsonify(openings),os
    ts,tanks=sb("tanks",params={"active":"eq.true","select":"id,tank_code,product,capacity_liters,current_liters"})
    if ts!=200:return jsonify(tanks),ts
    start=str(period["starts_at"])
    ms,movements=sb("tank_movements",params={"created_at":"gte."+start,"select":"tank_id,movement_type,quantity_liters,created_at","order":"created_at.asc","limit":"10000"})
    if ms!=200:return jsonify(movements),ms
    opening_map={str(x["tank_id"]):x for x in openings}
    out=[]
    for tank in tanks:
        tid=str(tank["id"]); opening=opening_map.get(tid)
        totals={"purchase":0.0,"sale":0.0,"transfer_in":0.0,"transfer_out":0.0,"adjustment":0.0,"correction":0.0}
        for m in movements:
            if str(m.get("tank_id"))!=tid: continue
            mt=str(m.get("movement_type") or "").lower()
            q=float(m.get("quantity_liters") or 0)
            if mt in totals: totals[mt]+=q
        expected=(float(opening["physical_liters"]) if opening else 0)+totals["purchase"]-totals["sale"]+totals["transfer_in"]-totals["transfer_out"]+totals["adjustment"]+totals["correction"]
        out.append({"tank_id":tank["id"],"tank_code":tank["tank_code"],"product":tank.get("product"),"capacity_liters":tank.get("capacity_liters"),"opening_physical_liters":opening.get("physical_liters") if opening else None,"opening_measured_at":opening.get("measured_at") if opening else None,"expected_closing_liters":expected if opening else None,"ledger_current_liters":tank.get("current_liters"),"physical_closing_liters":None,"difference_liters":None,"variance_percent":None,"status":"READY_FOR_RECONCILIATION" if opening else "MISSING_OPENING","movements":totals})
    return jsonify({"open":True,"period":period,"tanks":out}),200

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

@app.post("/api/shift-takeovers/record-sales-batch")
def record_shift_takeover_sales_batch():
    auth=require_login()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    batch=data.get("batch",[])
    if not isinstance(batch,list):
        return jsonify({"error":"Invalid batch entries"}),400
    if not batch or len(batch)>20:
        return jsonify({"error":"Select between 1 and 20 shifts per submission"}),400
    seen=set()
    for item in batch:
        if not isinstance(item,dict) or not item.get("takeover_id") or not isinstance(item.get("sales",[]),list):
            return jsonify({"error":"Each batch item must contain a takeover_id and sales array"}),400
        takeover_id=str(item.get("takeover_id")).strip()
        # Validate UUIDs before constructing PostgREST in.(...) filters.
        # This avoids malformed identifiers being treated as query syntax and
        # returns a clear client error before any database RPC is called.
        if not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", takeover_id):
            return jsonify({"error":"Each takeover_id must be a valid UUID"}),400
        if takeover_id in seen:
            return jsonify({"error":"A shift was selected more than once"}),400
        seen.add(takeover_id)

    # Enforce the UI's product + DSR grouping on the server too. Never trust
    # client-supplied group keys; derive them from the saved shift/nozzle data.
    ts,takeovers=sb("shift_takeovers",params={
        "id":"in.("+",".join(seen)+")",
        "select":"*"
    })
    if ts != 200:
        return jsonify({"error":"Unable to verify the selected shifts. Refresh and try again."}),503
    takeover_map={str(row.get("id")):row for row in takeovers}
    if len(takeover_map) != len(seen):
        return jsonify({"error":"One or more selected shifts could not be verified. Refresh and try again."}),409
    if any(str(row.get("from_employee_id")) != str(session.get("employee_id")) for row in takeovers):
        return jsonify({"error":"You can only record sales for your own shifts."}),403
    shift_ids=[str(row.get("shift_id")) for row in takeovers if row.get("shift_id")]
    if len(shift_ids) != len(takeovers):
        return jsonify({"error":"A selected shift is missing its dispenser assignment."}),409
    ss,shift_rows=sb("shifts",params={"id":"in.("+",".join(shift_ids)+")","select":"*"})
    if ss != 200:
        return jsonify({"error":"Unable to verify the dispenser assignments. Try again."}),503
    shift_map={str(row.get("id")):row for row in shift_rows}
    nozzle_ids=[str(row.get("nozzle_id")) for row in shift_rows if row.get("nozzle_id")]
    if len(shift_map) != len(takeovers) or len(nozzle_ids) != len(takeovers):
        return jsonify({"error":"A selected shift is missing its dispenser assignment."}),409
    ns,nozzle_rows=sb("nozzles",params={"id":"in.("+",".join(nozzle_ids)+")","select":"*"})
    if ns != 200:
        return jsonify({"error":"Unable to verify configured products for these dispensers."}),503
    nozzle_map={str(row.get("id")):row for row in nozzle_rows}
    product_status,product_rows=sb("products",params={"select":"*"})
    if product_status != 200:
        return jsonify({"error":"Unable to verify the configured product catalogue."}),503
    product_map={str(row.get("id")):row for row in product_rows}

    def batch_product_key(takeover):
        shift=shift_map.get(str(takeover.get("shift_id")),{})
        nozzle=nozzle_map.get(str(shift.get("nozzle_id")),{})
        nozzle_product=str(nozzle.get("product") or shift.get("product") or "")
        product=None
        product_id=nozzle.get("product_id")
        if product_id is not None:
            product=product_map.get(str(product_id))
        if product is None and nozzle_product:
            needle=nozzle_product.strip().lower()
            product=next((p for p in product_rows if needle in {
                str(p.get("code_name") or "").strip().lower(),
                str(p.get("code") or "").strip().lower(),
                str(p.get("product_code") or "").strip().lower(),
                str(p.get("name") or "").strip().lower()
            }),None)
        return str((product or {}).get("id") or product_id or nozzle.get("product") or shift.get("product") or "unassigned")

    def batch_dsr_date(takeover):
        shift=shift_map.get(str(takeover.get("shift_id")),{})
        value=takeover.get("shift_started_at") or shift.get("start_time") or shift.get("started_at") or takeover.get("created_at")
        if not value:
            return "DSR"
        try:
            parsed=datetime.fromisoformat(str(value).replace("Z","+00:00"))
            if parsed.tzinfo is None:
                # Naive timestamps are interpreted in the station's local time.
                return parsed.date().isoformat()
            return (parsed.astimezone(timezone.utc)+timedelta(hours=3)).date().isoformat()
        except Exception:
            return str(value)[:10]

    grouped_keys=set()
    for takeover in takeovers:
        grouped_keys.add((batch_product_key(takeover),batch_dsr_date(takeover)))
    if len(grouped_keys) != 1:
        return jsonify({"error":"Record Sales submissions must contain shifts for one configured product and one DSR only."}),400

    status,result=rpc("record_shift_takeover_sales_batch",{
        "p_employee_id":session["employee_id"],
        "p_batch":batch
    })
    if status>=400:return jsonify(result),status
    try:
        fresh_status, fresh_rows = sb("shift_takeovers", params={
            "id": "in.(" + ",".join(seen) + ")",
            "select": "id,shift_id,sales_status"
        })
        if fresh_status == 200:
            _notify_admin_sales_and_dsr(fresh_rows)
            _notify_admin_low_stock()
    except Exception:
        pass
    return jsonify(result),200


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
    try:
        fresh_status, fresh_rows = sb("shift_takeovers", params={
            "id": "eq." + takeover_id,
            "select": "id,shift_id,sales_status",
            "limit": "1"
        })
        if fresh_status == 200:
            _notify_admin_sales_and_dsr(fresh_rows)
            _notify_admin_low_stock()
    except Exception:
        pass
    return jsonify(result),200

@app.get("/api/shift-takeovers/<takeover_id>/sale-record")
def shift_takeover_sale_record(takeover_id):
    auth=require_login()
    if auth:return auth
    status,takeovers=sb("shift_takeovers",params={"id":"eq."+takeover_id,"select":"*","limit":"1"})
    if status!=200:return jsonify(takeovers),status
    if not takeovers:return jsonify({"error":"Shift takeover not found"}),404
    takeover=takeovers[0]
    # Both attendants involved in this handover may view the read-only sale
    # record. Keep unrelated attendants restricted, and keep recording/cancel
    # endpoints governed by their own stricter RPC checks.
    if session.get("role")!="admin":
        employee_id=str(session.get("employee_id"))
        if employee_id not in (
            str(takeover.get("from_employee_id") or ""),
            str(takeover.get("to_employee_id") or "")
        ):
            return jsonify({"error":"Unauthorized"}),403
    ss,sales=sb("shift_takeover_sales",params={"takeover_id":"eq."+takeover_id,"select":"id,sale_type_id,amount,submitted_amount,reason,recorded_by,created_at","order":"created_at.asc,id.asc"})
    if ss!=200:return jsonify(sales),ss
    type_ids=[str(x.get("sale_type_id")) for x in sales if x.get("sale_type_id")]
    type_map={}
    if type_ids:
        ts,types=sb("sale_types",params={"id":"in.("+",".join(type_ids)+")","select":"id,name,description,reason_required"})
        if ts==200:type_map={str(x.get("id")):x for x in types}
    for sale in sales:
        typ=type_map.get(str(sale.get("sale_type_id")),{})
        sale["sale_type_name"]=typ.get("name") or "Sale"
        sale["sale_type_description"]=typ.get("description")

    # Enrich meter-reading rows with the actual physical nozzle, product and tank.
    # A dispenser may contain multiple nozzle rows; per-nozzle relations are the
    # reliable source for the labels shown in Admin and Attendant sales details.
    reading_keys=("nozzle_opening_readings","nozzle_closing_readings","nozzle_sales_liters")
    reading_ids=set()
    for key in reading_keys:
        values=takeover.get(key)
        if not isinstance(values,list):
            continue
        for row in values:
            if not isinstance(row,dict):
                continue
            candidate=str(row.get("nozzle_uuid") or "")
            if not candidate and str(row.get("nozzle_id") or "").count("-")==4:
                candidate=str(row.get("nozzle_id"))
            if candidate and candidate.count("-")==4:
                reading_ids.add(candidate)

    nozzle_map={}
    if reading_ids:
        ns,nozzle_rows=sb("dispenser_nozzles",params={
            "id":"in.("+",".join(sorted(reading_ids))+")",
            "select":"id,nozzle_code,product_id,tank_id",
            "limit":"1000"
        })
        if ns==200 and isinstance(nozzle_rows,list):
            nozzle_map={str(row.get("id")):row for row in nozzle_rows if row.get("id")}

    tank_ids=sorted({str(row.get("tank_id")) for row in nozzle_map.values() if row.get("tank_id")})
    tank_map={}
    if tank_ids:
        ts,tank_rows=sb("tanks",params={
            "id":"in.("+",".join(tank_ids)+")",
            "select":"id,tank_code,product,product_id",
            "limit":"1000"
        })
        if ts==200 and isinstance(tank_rows,list):
            tank_map={str(row.get("id")):row for row in tank_rows if row.get("id")}

    product_ids=sorted({str(row.get("product_id") or tank_map.get(str(row.get("tank_id")), {}).get("product_id")) for row in nozzle_map.values() if row.get("product_id") or tank_map.get(str(row.get("tank_id")), {}).get("product_id")})
    product_map={}
    if product_ids:
        ps,product_rows=sb("products",params={
            "id":"in.("+",".join(product_ids)+")",
            "select":"id,name,code_name",
            "limit":"1000"
        })
        if ps==200 and isinstance(product_rows,list):
            product_map={str(row.get("id")):row for row in product_rows if row.get("id")}

    for key in reading_keys:
        values=takeover.get(key)
        if not isinstance(values,list):
            continue
        for row in values:
            if not isinstance(row,dict):
                continue
            candidate=str(row.get("nozzle_uuid") or "")
            if not candidate and str(row.get("nozzle_id") or "").count("-")==4:
                candidate=str(row.get("nozzle_id"))
            physical=nozzle_map.get(candidate)
            if not physical:
                continue
            tank=tank_map.get(str(physical.get("tank_id")), {})
            product=product_map.get(str(physical.get("product_id") or tank.get("product_id")), {})
            row["nozzle_code"]=physical.get("nozzle_code") or row.get("nozzle_code")
            row["tank_id"]=physical.get("tank_id") or row.get("tank_id")
            row["tank_code"]=tank.get("tank_code") or row.get("tank_code")
            row["product_id"]=physical.get("product_id") or tank.get("product_id") or row.get("product_id")
            row["product_code"]=product.get("code_name") or row.get("product_code")
            row["product"]=row.get("product") or product.get("name") or tank.get("product")

    return jsonify({"takeover":takeover,"sales":sales}),200

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
        rows=result if isinstance(result,list) else []
        # The attendant-safe JSON RPC may omit newly added return fields.
        # Enrich only those fields from the canonical takeover rows so the
        # Record Sale card can display the return saved by Admin.
        ids=[str(row.get("id")) for row in rows if isinstance(row,dict) and row.get("id")]
        if ids:
            qs={"select":"id,returned_liters,returned_amount","id":"in.("+",".join(ids)+")"}
            rs,canonical=sb("shift_takeovers",params=qs)
            if rs==200 and isinstance(canonical,list):
                return_by_id={str(item.get("id")):item for item in canonical}
                for row in rows:
                    saved=return_by_id.get(str(row.get("id")))
                    if saved:
                        row["returned_liters"]=saved.get("returned_liters") or 0
                        row["returned_amount"]=saved.get("returned_amount") or 0
        return jsonify(rows),200
    params={"select":"*","order":"shift_ended_at.desc","limit":"50"}
    status,rows=sb("shift_takeovers",params=params)
    if status!=200:return jsonify(rows),status
    return jsonify(rows),200

@app.get("/api/sales/progressing")
def progressing_sales_shifts():
    auth=require_admin()
    if auth:return auth
    status,result=rpc("list_progressing_shift_takeovers_for_admin",{})
    if status>=400:return jsonify(result),status
    return jsonify(result if isinstance(result,list) else []),200

@app.post("/api/sales/progressing/<takeover_id>/returned-fuel")
def save_progressing_returned_fuel(takeover_id):
    auth=require_admin()
    if auth:return auth
    data=request.get_json(silent=True) or {}
    try:
        returned_liters=float(data.get("returned_liters",0) or 0)
        if not math.isfinite(returned_liters) or returned_liters<0:
            return jsonify({"error":"Returned liters must be a valid non-negative number"}),400
    except (TypeError,ValueError):
        return jsonify({"error":"Returned liters must be a valid non-negative number"}),400
    status,result=rpc("save_progressing_shift_return",{
        "p_takeover_id":takeover_id,
        "p_admin_id":session["employee_id"],
        "p_returned_liters":returned_liters
    })
    if status>=400:return jsonify(result),status
    return jsonify(result),200

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
    try:
        returned_liters=float(data.get("returned_liters",0) or 0)
        if not math.isfinite(returned_liters) or returned_liters<0:
            return jsonify({"error":"Returned liters must be a valid non-negative number"}),400
    except (TypeError,ValueError):
        return jsonify({"error":"Returned liters must be a valid non-negative number"}),400
    status,result=rpc("confirm_shift_takeover_sales_with_return_v2",{
        "p_takeover_id":takeover_id,
        "p_admin_id":session["employee_id"],
        "p_checked_sale_ids":checked,
        "p_returned_liters":returned_liters
    })
    if status>=400:return jsonify(result),status

    # Notify the attendant who recorded this shift's sales after admin approval.
    try:
        ts, rows = sb("shift_takeovers", params={"id":"eq."+str(takeover_id),"select":"shift_id","limit":"1"})
        if ts == 200 and rows:
            ss, shifts = sb("shifts", params={"id":"eq."+str(rows[0].get("shift_id") or ""),"select":"employee_id","limit":"1"})
            if ss == 200 and shifts and shifts[0].get("employee_id"):
                deliver_handover_push(str(shifts[0]["employee_id"]), str(takeover_id), _notification_employee_name(session.get("employee_id")), "attendant_sales_confirmed")
    except Exception:
        pass

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
                        "p_generated_by":session["employee_id"],
                        "p_revision_reason":None
                    })
                    _notify_admin_push(report_day.isoformat(), _notification_employee_name(session.get("employee_id")), "admin_dsr_confirmed_stock")
                    # This path can also finalize the DSR after the last individual
                    # sales confirmation, so notify every attendant on that date.
                    try:
                        day_start = report_day.isoformat() + "T00:00:00+03:00"
                        next_day_start = (report_day + timedelta(days=1)).isoformat() + "T00:00:00+03:00"
                        ds, day_shifts = sb("shifts", params={
                            "start_time":"gte." + day_start,
                            "and":"(start_time.lt." + next_day_start + ")",
                            "select":"employee_id",
                            "limit":"10000"
                        })
                        if ds == 200 and isinstance(day_shifts, list):
                            for attendant_id in sorted(set(str(row.get("employee_id")) for row in day_shifts if row.get("employee_id"))):
                                deliver_handover_push(attendant_id, report_day.isoformat(), "Fuel Shift System", "attendant_dsr_confirmed")
                    except Exception:
                        pass

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

@app.get("/api/push/public-key")
def push_public_key():
    auth = require_login()
    if auth: return auth
    public_key = str(getattr(env(), "VAPID_PUBLIC_KEY", "") or "").strip()
    if not public_key:
        return jsonify({"error": "Phone push notifications are not configured yet"}), 503
    return jsonify({"publicKey": public_key}), 200

@app.post("/api/push/subscribe")
def push_subscribe():
    auth = require_login()
    if auth: return auth
    if session.get("role") not in ("attendant", "admin"):
        return jsonify({"error": "Attendant or administrator account required"}), 403
    data = request.get_json(silent=True) or {}
    sub = data.get("subscription") if isinstance(data.get("subscription"), dict) else data
    keys = sub.get("keys") if isinstance(sub.get("keys"), dict) else {}
    endpoint = str(sub.get("endpoint", "")).strip()
    p256dh = str(keys.get("p256dh", "")).strip()
    auth_key = str(keys.get("auth", "")).strip()
    if not endpoint.startswith("https://") or len(endpoint) > 4096 or not p256dh or not auth_key:
        return jsonify({"error": "Invalid browser push subscription"}), 400
    body = {
        "employee_id": str(session["employee_id"]),
        "endpoint": endpoint,
        "p256dh": p256dh,
        "auth": auth_key,
        "user_agent": str(request.headers.get("User-Agent", ""))[:500],
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    status, result = sb("push_subscriptions", method="POST",
        params={"on_conflict": "endpoint"},
        body=body, prefer="resolution=merge-duplicates,return=minimal")
    if status >= 400:
        return jsonify({"error": "Could not save phone notification subscription"}), 502
    return jsonify({"ok": True}), 201

@app.post("/api/push/unsubscribe")
def push_unsubscribe():
    auth = require_login()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    endpoint = str(data.get("endpoint", "")).strip()
    if not endpoint.startswith("https://") or len(endpoint) > 4096:
        return jsonify({"error": "Invalid push endpoint"}), 400
    status, result = sb("push_subscriptions", method="DELETE", params={
        "employee_id": "eq." + str(session["employee_id"]),
        "endpoint": "eq." + endpoint
    })
    if status >= 400:
        return jsonify({"error": "Could not disable phone notifications"}), 502
    return jsonify({"ok": True}), 200

async def _deliver_handover_push(to_employee_id, handover_id, sender_name, notification_type="incoming"):
    token = str(getattr(env(), "PUSH_DELIVERY_TOKEN", "") or "").strip()
    base = str(getattr(env(), "SUPABASE_URL", "") or "").strip().rstrip("/")
    if not token or not base or not handover_id or not to_employee_id:
        return
    try:
        options = {
            "method": "POST",
            "headers": Object.fromEntries([
                ("Authorization", "Bearer " + token),
                ("Content-Type", "application/json")
            ]),
            "body": json.dumps({
                "to_employee_id": str(to_employee_id),
                "handover_id": str(handover_id),
                "sender_name": str(sender_name or "Another attendant"),
                "notification_type": str(notification_type or "incoming")
            })
        }
        response = await fetch(base + "/functions/v1/send-handover-push", options)
        response_text = await response.text()
        # Best effort only: never fail a handover operation because push delivery failed.
        if not response.ok:
            print("Push delivery rejected: status=" + str(response.status) + " body=" + str(response_text)[:500])
    except Exception as exc:
        print("Push delivery request failed: " + str(exc)[:500])
        return

def deliver_handover_push(to_employee_id, handover_id, sender_name, notification_type="incoming"):
    return run_sync(_deliver_handover_push(to_employee_id, handover_id, sender_name, notification_type))

def _notify_admin_push(reference_id, sender_name, notification_type):
    # Deliver to every active administrator's registered devices. Push failures
    # are best-effort and must never undo the sales/DSR operation.
    try:
        es, admins = sb("employees", params={
            "role": "eq.admin", "active": "eq.true", "select": "id,name", "limit": "1000"
        })
        if es != 200 or not isinstance(admins, list):
            return
        for admin in admins:
            admin_id = str(admin.get("id") or "")
            if admin_id:
                deliver_handover_push(
                    admin_id,
                    str(reference_id),
                    sender_name or "Fuel Shift System",
                    notification_type
                )
    except Exception:
        return

def _notify_admin_low_stock():
    """Notify every active admin when a tank falls below 10% of its capacity."""
    try:
        status, tanks = sb("tanks", params={"active":"eq.true","select":"id,tank_code,product,current_liters,capacity_liters","limit":"1000"})
        if status != 200 or not isinstance(tanks, list): return
        for tank in tanks:
            try:
                capacity=float(tank.get("capacity_liters") or 0); current=float(tank.get("current_liters") or 0)
            except (TypeError,ValueError): continue
            if capacity <= 0 or current < 0 or current / capacity >= 0.10: continue
            tank_id=str(tank.get("id") or "")
            if tank_id: _notify_admin_push(tank_id, "Fuel Shift System", "admin_low_stock")
    except Exception: return

def _notification_employee_name(employee_id):
    """Return the display name for an employee-triggered push notification."""
    try:
        employee_id = str(employee_id or "").strip()
        if not employee_id:
            return "A team member"
        status, employees = sb("employees", params={
            "id": "eq." + employee_id, "select": "name", "limit": "1"
        })
        if status == 200 and isinstance(employees, list) and employees:
            return str(employees[0].get("name") or "A team member").strip() or "A team member"
    except Exception:
        pass
    return "A team member"

def _notify_admin_sales_and_dsr(takeovers):
    # Notify for submitted sales and only notify DSR when the authoritative
    # readiness snapshot says the report can actually be confirmed.
    try:
        if not isinstance(takeovers, list):
            return
        seen_dates = set()
        for takeover in takeovers:
            if not isinstance(takeover, dict):
                continue
            takeover_id = str(takeover.get("id") or "")
            if not takeover_id:
                continue
            shift_id = str(takeover.get("shift_id") or "")
            if not shift_id:
                continue
            ss, shifts = sb("shifts", params={
                "id": "eq." + shift_id, "select": "id,start_time,employee_id", "limit": "1"
            })
            if ss != 200 or not shifts:
                continue
            attendant_name = _notification_employee_name(shifts[0].get("employee_id"))
            if str(takeover.get("sales_status") or "") == "pending_admin":
                _notify_admin_push(takeover_id, attendant_name, "admin_pending_sales")
            report_day = _local_date_from_iso(shifts[0].get("start_time"))
            if not report_day or report_day.isoformat() in seen_dates:
                continue
            seen_dates.add(report_day.isoformat())
            snapshot, err, status = _daily_confirmation_snapshot(report_day)
            if not err and status == 200 and snapshot.get("can_confirm"):
                _notify_admin_push(report_day.isoformat(), attendant_name, "admin_dsr_ready")
    except Exception:
        return

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
    # Push is best-effort: submission success must not depend on a phone's push service.
    try:
        hs, handovers = sb("handovers", params={
            "shift_id": "eq." + shift_id,
            "from_employee_id": "eq." + str(eid),
            "to_employee_id": "eq." + to_id,
            "status": "eq.pending",
            "select": "id,created_at",
            "order": "created_at.desc",
            "limit": "1"
        })
        if hs == 200 and handovers:
            es, employees = sb("employees", params={
                "id": "eq." + str(eid),
                "select": "name",
                "limit": "1"
            })
            sender_name = employees[0].get("name", "Another attendant") if es == 200 and employees else "Another attendant"
            deliver_handover_push(to_id, handovers[0].get("id"), sender_name)
    except Exception:
        pass
    return jsonify(result),201

@app.post("/api/handovers/<handover_id>/confirm")
def confirm_handover(handover_id):
    eid=session.get("employee_id")
    if not eid:return jsonify({"error":"Unauthorized"}),401
    data=request.get_json(silent=True) or {}
    pin=str(data.get("pin",""))
    if not pin or not pin.isdigit():return jsonify({"error":"Enter your numeric PIN"}),400
    es,er=sb("employees",params={"id":"eq."+eid,"active":"eq.true","select":"id,role,pin_hash,name"})
    if es!=200 or not er:return jsonify({"error":"Attendant account not found"}),404
    emp=er[0]
    if emp.get("role")!="attendant" or not verify_pin(pin,emp.get("pin_hash","")):return jsonify({"error":"Invalid PIN"}),401

    # The sender already supplied the final dispenser/tank readings. The
    # receiving attendant only confirms those readings with their PIN.
    hs,hr=sb("handovers",params={
        "id":"eq."+handover_id,
        "to_employee_id":"eq."+eid,
        "status":"eq.pending",
        "select":"id,from_employee_id,shift_id,closing_reading,closing_mm,closing_liters,closing_nozzle_readings",
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
    # Once the receiving attendant confirms the handover, notify the original
    # shift sender that Record Sale is ready. Push is best-effort and must not
    # change the successful handover result.
    try:
        sender_id=str(handover.get("from_employee_id") or "")
        if sender_id and sender_id!=str(eid):
            deliver_handover_push(
                sender_id,
                handover_id,
                emp.get("name") or "The receiving attendant",
                "record_sale_ready"
            )
    except Exception:
        pass
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
    today=(datetime.now(timezone.utc)+timedelta(hours=3)).date()
    report_day_closed=report_date<today
    next_day=report_date+timedelta(days=1)
    ds=report_date.isoformat()+"T00:00:00+03:00"; de=next_day.isoformat()+"T00:00:00+03:00"
    ss,shifts=sb("shifts",params={"and":"(start_time.gte."+ds+",start_time.lt."+de+")","select":"id,start_time,end_time","order":"start_time.asc","limit":"5000"})
    if ss!=200:return None,{"error":shifts},ss
    if not shifts:return {"date":report_date.isoformat(),"shift_count":0,"completed_shift_count":0,"all_shifts_complete":False,"report_day_closed":report_day_closed,"sales_confirmation_ready":False,"can_confirm":False,"status":None,"total_sales_liters":0,"total_sales_amount":0,"sales_by_method":{}},None,200
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
    # A shift with zero fuel dispensed and zero calculated sales is a valid
    # zero-sales shift. Do not make it look incomplete merely because it has
    # no sale-type rows or a sales submission timestamp.
    def is_zero_dispense_shift(takeover):
        try:
            return (
                float(takeover.get("total_sales_liters") or 0) <= 0.005
                and float(takeover.get("total_sales_amount") or 0) <= 0.005
            )
        except (TypeError, ValueError):
            return False
    missing_sales_shifts=[
        str(x.get("id")) for x in shifts
        if len(takeovers_by_shift.get(str(x.get("id")),[]))==1
        and not is_zero_dispense_shift(takeovers_by_shift[str(x.get("id"))][0])
        and sale_count_by_takeover.get(str(takeovers_by_shift[str(x.get("id"))][0].get("id")),0)==0
    ]
    unsubmitted_sales_shifts=[
        str(x.get("id")) for x in shifts
        if len(takeovers_by_shift.get(str(x.get("id")),[]))==1
        and not is_zero_dispense_shift(takeovers_by_shift[str(x.get("id"))][0])
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
            is_zero_dispense_shift(t)
            or str(t.get("sales_status") or "") in ("pending_admin","confirmed")
            for t in takeovers
        )
        and len(takeovers)==len(shifts)
    )
    dsr_ready=bool(report_day_closed and all_complete and all_handover_recorded and all_sales_recorded)
    sales_ready=all(str(x.get("sales_status") or "confirmed")=="confirmed" for x in takeovers) if takeovers and not duplicate_handover_shifts else False
    return {"date":report_date.isoformat(),"shift_count":len(shifts),"completed_shift_count":sum(1 for x in shifts if x.get("end_time")),"dispenser_count":len(dispenser_ids),"all_shifts_complete":all_complete,"report_day_closed":report_day_closed,"all_handover_recorded":all_handover_recorded,"duplicate_handover_shifts":duplicate_handover_shifts,"missing_handover_shifts":missing_handover_shifts,"missing_sales_shifts":missing_sales_shifts,"unsubmitted_sales_shifts":unsubmitted_sales_shifts,"unconfirmed_sales_shifts":unconfirmed_sales_shifts,"all_sales_recorded":all_sales_recorded,"sales_confirmation_ready":sales_ready,"can_confirm":dsr_ready,"status":"pending" if dsr_ready else None,"total_sales_liters":sum(float(x.get("total_sales_liters") or 0) for x in takeovers),"total_sales_amount":sum(methods.values()),"sales_by_method":methods},None,200

@app.get("/api/reports/daily/confirmations")
def daily_report_confirmations():
    auth=require_admin()
    if auth:return auth
    today=(datetime.now(timezone.utc)+timedelta(hours=3)).date(); start=today-timedelta(days=3650)
    ss,shifts=sb("shifts",params={"start_time":"gte."+start.isoformat()+"T00:00:00+03:00","select":"id,start_time,end_time,employee_id,nozzle_id","order":"start_time.asc","limit":"10000"})
    if ss!=200:return jsonify({"error":shifts}),ss
    shifts=[x for x in shifts if _local_date_from_iso(x.get("start_time")) and _local_date_from_iso(x.get("start_time"))<=today]
    # Resolve missing-sales shift IDs to human-readable attendants and dispensers
    # once for the whole date range, rather than issuing extra queries per DSR day.
    employee_ids=sorted(set(str(x.get("employee_id")) for x in shifts if x.get("employee_id")))
    employee_map={}
    if employee_ids:
        ems,employees=sb("employees",params={"id":"in.("+",".join(employee_ids)+")","select":"id,name","limit":"10000"})
        if ems==200:employee_map={str(x.get("id")):str(x.get("name") or "").strip() for x in employees}
    nozzle_ids=sorted(set(str(x.get("nozzle_id")) for x in shifts if x.get("nozzle_id")))
    nozzle_map={}
    if nozzle_ids:
        nss,nozzles=sb("nozzles",params={"id":"in.("+",".join(nozzle_ids)+")","select":"id,nozzle_code","limit":"10000"})
        if nss==200:nozzle_map={str(x.get("id")):str(x.get("nozzle_code") or "").strip() for x in nozzles}
    shift_lookup={str(x.get("id")):x for x in shifts if x.get("id")}
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
        if not snap.get("report_day_closed") or not snap["all_shifts_complete"] or not snap.get("all_handover_recorded") or not snap.get("all_sales_recorded"):
            # Keep the date waiting until the report day has ended and every shift has ended,
            # completed handover, and submitted its sale.
            snap["status"]="waiting"
            snap["id"]=(row or {}).get("id")
            cards.append(snap)
            continue
        if row and row.get("status")=="confirmed":
            snap["status"]="confirmed"; snap["confirmed_at"]=row.get("confirmed_at"); snap["confirmed_by"]=row.get("confirmed_by")
        else:
            # Loading confirmation cards must remain read-only.
            snap["status"]="pending"
        snap["id"]=(row or {}).get("id")
        cards.append(snap)
    # Keep the existing ID arrays for DSR readiness UI compatibility, and add
    # parallel detail arrays for inbox notifications that need attendant names.
    for card in cards:
        for source_key,detail_key in (("missing_sales_shifts","missing_sales_shift_details"),("unsubmitted_sales_shifts","unsubmitted_sales_shift_details")):
            details=[]
            for shift_id in card.get(source_key) or []:
                shift=shift_lookup.get(str(shift_id),{})
                employee_id=str(shift.get("employee_id") or "")
                nozzle_id=str(shift.get("nozzle_id") or "")
                details.append({
                    "shift_id":str(shift_id),
                    "attendant_name":employee_map.get(employee_id) or "",
                    "shift_label":nozzle_map.get(nozzle_id) or "",
                })
            card[detail_key]=details
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
    today=(datetime.now(timezone.utc)+timedelta(hours=3)).date()
    if report_day>=today:
        return jsonify({"error":"Daily DSR cannot be confirmed until the report date has ended.","report_ready":False}),409
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
    us,updated=sb("daily_report_confirmations",method="POST",params={"on_conflict":"report_date"},body={
        "report_date":report_date,
        "total_sales_liters":final_snap["total_sales_liters"],
        "total_sales_amount":final_snap["total_sales_amount"],
        "sales_by_method":final_snap["sales_by_method"],
        "shift_count":final_snap["shift_count"],
        "status":"confirmed",
        "confirmed_at":now,
        "confirmed_by":session["employee_id"],
        "updated_at":now
    },prefer="resolution=merge-duplicates,return=representation")
    if us>=400:return jsonify(updated),us
    _drive_after_dsr_confirm(report_day)
    # Send the final live tank inventory to every active admin's subscribed devices
    # only after this request has newly confirmed the DSR.
    _notify_admin_push(report_date, _notification_employee_name(session.get("employee_id")), "admin_dsr_confirmed_stock")

    # Notify each attendant who worked on this report date after DSR approval.
    try:
        day_start = report_day.isoformat() + "T00:00:00+03:00"
        next_day_start = (report_day + timedelta(days=1)).isoformat() + "T00:00:00+03:00"
        ss, report_shifts = sb("shifts", params={
            "start_time":"gte." + day_start,
            "and":"(start_time.lt." + next_day_start + ")",
            "select":"id,employee_id",
            "limit":"10000"
        })
        if ss == 200 and isinstance(report_shifts, list):
            attendant_ids = sorted(set(str(row.get("employee_id")) for row in report_shifts if row.get("employee_id")))
            for attendant_id in attendant_ids:
                deliver_handover_push(attendant_id, report_date, "Fuel Shift System", "attendant_dsr_confirmed")
    except Exception:
        pass
    return jsonify({
        "confirmed":True,
        "already_confirmed":False,
        "report_date":report_date,
        "takeovers_confirmed":generated.get("takeovers_confirmed",0) if isinstance(generated,dict) else 0,
        "report":generated.get("report") if isinstance(generated,dict) else generated
    }),200

def _daily_report_error_boundary(fn):
    @wraps(fn)
    def wrapped(*args,**kwargs):
        try:
            return fn(*args,**kwargs)
        except Exception as exc:
            # Keep the failure actionable for authenticated admin DSR requests.
            # The generic Worker 500 otherwise hides the actual failing field/
            # expression and makes production diagnosis unnecessarily blind.
            return jsonify({
                "error":"Daily report generation failed",
                "type":type(exc).__name__,
                "message":str(exc)
            }),500
    return wrapped

@app.get("/api/reports/daily")
@_daily_report_error_boundary
def daily_report(report_date_override=None):
    auth=require_admin()
    if auth:return auth
    report_date=report_date_override or request.args.get("date") or date.today().isoformat()
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
        "select":"id,employee_id,nozzle_id,start_time,end_time,opening_reading,closing_reading,opening_liters,closing_liters,status,opening_tank_liters,activation_nozzles",
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
        "select":"id,shift_id,from_employee_id,to_employee_id,shift_started_at,shift_ended_at,total_sales_liters,total_sales_amount,returned_liters,returned_amount,tank_id,tank_opening_liters,tank_closing_liters,tank_sales_liters,tank_variance_liters,tank_variance_pct,nozzle_sales_liters,nozzle_opening_readings,nozzle_closing_readings,sales_status,sales_submitted_at,sales_confirmed_at",
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
    def _json_list(value):
        return value if isinstance(value,list) else []

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

    # Resolve dispenser and connected-tank labels before product-level return
    # allocation; later DSR sections reuse this same mapping.
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

    # Deduct returns from product-level DSR sales totals while preserving the
    # gross nozzle/meter ledger for physical reconciliation.
    returned_by_product={}
    shift_product_by_id={}
    for sh in day_shifts:
        nozzle=dispenser_map.get(str(sh.get("nozzle_id") or "")) or {}
        tank=tank_map.get(str(nozzle.get("tank_id") or "")) or {}
        shift_product_by_id[str(sh.get("id") or "")]=nozzle.get("product") or tank.get("product") or "Unknown"
    for h in handover_rows:
        sid=str(h.get("shift_id") or "")
        if sid not in handover_by_shift:
            continue
        returned_l=max(0.0,float(h.get("returned_liters") or 0))
        returned_a=max(0.0,float(h.get("returned_amount") or 0))
        if not returned_l and not returned_a:
            continue
        tank=tank_map.get(str(h.get("tank_id") or "")) or {}
        product=tank.get("product") or shift_product_by_id.get(sid) or "Unknown"
        row=returned_by_product.setdefault(product,{"liters":0.0,"amount":0.0})
        row["liters"]+=returned_l
        row["amount"]+=returned_a
    for product,returned in returned_by_product.items():
        row=by_product.setdefault(product,{"liters":0.0,"amount":0.0})
        row["liters"]=max(0.0,float(row.get("liters") or 0)-returned["liters"])
        row["amount"]=max(0.0,float(row.get("amount") or 0)-returned["amount"])

    # Sales methods come from the configured Admin Settings sale types
    # (for example Card, Cash, Transfer). Keep payment_method as a fallback
    # for older/direct sales records that have no configured sale type.
    sale_type_map={}
    st_status,st_rows=sb("sale_types",params={"select":"id,name","limit":"500"})
    if st_status==200:
        sale_type_map={str(x.get("id")):str(x.get("name") or "Other") for x in st_rows}
    payment_methods={}
    sales_by_type={}
    # Station payment-method totals are rebuilt from the authoritative
    # payment ledger after shift_summary has been constructed below.
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
    # Confirmed DSR financial amounts come from the dedicated payment ledger.
    # shift_takeover_sales remains the workflow/source table for pending entries;
    # payment_transactions is authoritative once an admin confirms them.
    payment_amount_by_shift={}
    payment_methods_by_shift={}
    payment_status, payment_rows=sb("payment_transactions",params={
        "shift_id":shift_id_filter,
        "select":"shift_id,takeover_id,sale_type_id,amount,payment_method,confirmed_at,recorded_at",
        "order":"recorded_at.asc","limit":"10000"
    })
    if payment_status!=200:
        return jsonify({"error":payment_rows}),payment_status
    # Rebuild DSR payment-method totals from the same authoritative ledger.
    # Do not aggregate legacy sales rows here: those rows can be compatibility
    # records for confirmed takeover payments.
    for row in payment_rows:
        sid=str(row.get("shift_id") or "")
        if not sid:
            continue
        amount=float(row.get("amount") or 0)
        payment_amount_by_shift[sid]=payment_amount_by_shift.get(sid,0)+amount
        method=sale_type_map.get(str(row.get("sale_type_id") or "")) or str(row.get("payment_method") or "other")
        methods=payment_methods_by_shift.setdefault(sid,{})
        methods[method]=methods.get(method,0)+amount

    def sales_methods_for_shift(shift_id):
        # The dedicated payment ledger is the only authoritative source for
        # entered-payment methods. Legacy sales rows are compatibility history.
        return dict(payment_methods_by_shift.get(str(shift_id)) or {})

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
        gross_shift_l=float(h.get("total_sales_liters") or direct_l)
        gross_calculated_shift_a=float(h.get("total_sales_amount") or sum(float(v.get("amount") or 0) for v in sales_by_shift.get(sid,[])))
        returned_liters=max(0.0,float(h.get("returned_liters") or 0))
        returned_amount=max(0.0,float(h.get("returned_amount") or 0))
        # DSR sales are net of returned fuel/value. Meter and nozzle detail below
        # intentionally remain gross physical dispensing for reconciliation.
        shift_l=max(0.0,gross_shift_l-returned_liters)
        calculated_shift_a=max(0.0,gross_calculated_shift_a-returned_amount)
        recorded_shift_a=payment_amount_by_shift.get(sid)
        if recorded_shift_a is not None:
            recorded_shift_a=max(0.0,float(recorded_shift_a)-returned_amount)
        # Entered payments are authoritative only when a dedicated payment-ledger
        # row exists. Never substitute calculated sales for missing payments.
        shift_a=float(recorded_shift_a) if recorded_shift_a is not None else None
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
            "gross_sales_liters":gross_shift_l,
            "returned_liters":returned_liters,
            "returned_amount":returned_amount,
            "meter_delta_liters":shift_meter_delta if complete_meter_rows else None,
            "meter_difference_liters":(shift_l-shift_meter_delta) if complete_meter_rows else None,
            "meter_reconciliation_pct":((shift_l/shift_meter_delta)*100) if complete_meter_rows and shift_meter_delta else None,
            "meter_reconciliation_status":("reconciled" if shift_meter_reconciles else "variance") if complete_meter_rows else "boundary",
            "sales_amount":shift_a,
            "gross_sales_amount":gross_calculated_shift_a,
            "returned_amount":returned_amount,
            "calculated_sales_amount":calculated_shift_a,
            "sales_amount_difference":shift_a-calculated_shift_a if recorded_shift_a is not None else 0,
            "tank_opening_liters":float(h.get("tank_opening_liters") or x.get("opening_tank_liters") or 0),
            "tank_closing_liters":float(h.get("tank_closing_liters") or x.get("closing_liters") or 0),
            "tank_purchases_liters":0.0,
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

    # Rebuild station payment totals from the authoritative payment ledger.
    # Legacy sales rows remain compatibility/history data and are not used as
    # the confirmed DSR financial source.
    payment_methods={}
    sales_by_type={}
    for z in shift_summary:
        for method,amount in (z.get("sales_by_method") or {}).items():
            val=float(amount or 0)
            payment_methods[method]=payment_methods.get(method,0)+val
            sales_by_type[method]=sales_by_type.get(method,0)+val
    # Payment type isn't captured for a return, so keep the payment ledger
    # intact and show the return as its own negative sales-method line.
    total_returned_amount=sum(float(x.get("returned_amount") or 0) for x in shift_summary)
    if total_returned_amount>0:
        sales_by_type["Returned fuel (deduction)"]=sales_by_type.get("Returned fuel (deduction)",0)-total_returned_amount

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
    calculated_station_a=sum(float(z.get("calculated_sales_amount") or 0) for z in shift_summary)
    payment_shift_ids={str(x.get("shift_id")) for x in payment_rows if x.get("shift_id")}
    all_payment_recorded=bool(day_shifts) and all(str(x.get("id")) in payment_shift_ids for x in day_shifts if x.get("id"))
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
        ordered_shifts=[]
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
        #
        # A configured nozzle can occasionally have no matching shift rows.
        # Keep it as a boundary-only record instead of raising an exception
        # and turning the whole DSR into HTTP 500.
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
        item["nozzles"].sort(key=lambda z: (float(z.get("nozzle_number")) if str(z.get("nozzle_number") or "").strip().replace(".","",1).isdigit() else 999))
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

    # Tank <-> nozzle reconciliation. Roll up authoritative handover nozzle sales by physical tank.
    # Never join raw sales rows to nozzle rows here because that can multiply totals.
    tank_nozzle_sales_by_shift={}
    for sh in day_shifts:
        sid=str(sh.get("id") or "")
        hrow=handover_by_shift_id.get(sid) or {}
        for sale in _json_list(hrow.get("nozzle_sales_liters")):
            code=str((sale or {}).get("nozzle_id") or "")
            dn=dn_by_code.get(code) or {}
            tid=str(dn.get("tank_id") or hrow.get("tank_id") or "")
            if not tid:
                continue
            tank_nozzle_sales_by_shift.setdefault(tid,{})
            tank_nozzle_sales_by_shift[tid][sid]=tank_nozzle_sales_by_shift[tid].get(sid,0.0)+float((sale or {}).get("liters_sold") or 0)

    # Tank detail is a DSR-level reconciliation, not a sum of individual
    # handover variances. Resolve each shift to the tank configured on its
    # dispenser first, because shared-tank membership comes from the actual
    # dispenser connection. Keep the handover tank as a legacy fallback only.
    # This groups every dispenser connected to the same physical tank into one
    # DSR stock equation and avoids splitting a shared tank by stale handover IDs.
    tank_shift_rows={}
    for sh in day_shifts:
        hrow=handover_by_shift_id.get(str(sh.get("id"))) or {}
        dispenser=dispenser_map.get(str(sh.get("nozzle_id") or "")) or {}
        tid=str(dispenser.get("tank_id") or hrow.get("tank_id") or "")
        if tid:
            tank_shift_rows.setdefault(tid,[]).append((sh,hrow))
    # Use actual discharge operations as the DSR purchase ledger. A purchase
    # may be discharged in multiple operations and into different tanks.
    purchase_by_tank={}
    purchase_by_shift={}
    purchase_adjustment_by_tank={}
    discharge_operations_by_tank={}

    # Discharge operations are attributed by their actual timestamp, not by
    # purchase.shift_id (which may be null for multi-operation purchases).
    # The overlapping shift windows were loaded before purchase filtering so
    # cross-midnight purchases are included in the correct DSR.
    def _parse_aware_dt(value):
        return _parse_aware_dt_for_report(value)

    # Resolve each shift nozzle's physical tank before matching a discharge.
    discharge_nozzle_tank_map={str(n.get("id")):str(n.get("tank_id")) for n in (dispenser_nozzle_rows or []) if n.get("id") and n.get("tank_id")}
    discharge_handover_tank_map={str(h.get("shift_id")):str(h.get("tank_id")) for h in (handover_rows or []) if h.get("shift_id") and h.get("tank_id")}

    def _attribute_discharge_to_shift(discharge_datetime, discharge_tank_id=None):
        dt=_parse_aware_dt(discharge_datetime)
        discharge_tank_id=str(discharge_tank_id or "")
        if not dt:
            return {"shift_id":None,"shift_started_at":None,"shift_ended_at":None,"shift_attribution_status":"invalid_timestamp"}
        matches=[]
        for sh in discharge_attribution_shifts:
            started=_parse_aware_dt(sh.get("start_time"))
            ended=_parse_aware_dt(sh.get("end_time"))
            if not started:continue
            shift_tank_id=discharge_nozzle_tank_map.get(str(sh.get("nozzle_id") or "")) or discharge_handover_tank_map.get(str(sh.get("id") or ""))
            # Do not assign a discharge to an unrelated shift if its tank is unknown.
            if discharge_tank_id and (not shift_tank_id or str(shift_tank_id)!=discharge_tank_id):continue
            # Half-open interval [start, end) avoids double attribution at handover.
            if report_start_utc <= started < report_end_utc and started <= dt and (ended is None or dt < ended):matches.append(sh)
        if len(matches)==1:
            sh=matches[0]
            return {"shift_id":sh.get("id"),"shift_employee_id":sh.get("employee_id"),
                "shift_employee_name":(employee_map.get(str(sh.get("employee_id"))) or {}).get("name") or "Unknown",
                "shift_nozzle_id":sh.get("nozzle_id"),"shift_started_at":sh.get("start_time"),
                "shift_ended_at":sh.get("end_time"),"shift_status":sh.get("status"),
                "shift_attribution_status":"inside_shift"}
        if len(matches)>1:
            return {"shift_id":None,"shift_started_at":None,"shift_ended_at":None,
                "shift_attribution_status":"ambiguous_overlap","overlapping_shift_ids":[str(x.get("id")) for x in matches if x.get("id")]}
        return {"shift_id":None,"shift_started_at":None,"shift_ended_at":None,"shift_attribution_status":"outside_shift"}

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
            discharge_attribution=_attribute_discharge_to_shift(op.get("discharge_datetime"), tid)
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

            attribution_status=discharge_attribution.get("shift_attribution_status")
            # A discharge overlapping multiple shifts on the same tank still
            # belongs in the physical tank ledger, but must not be credited to
            # one attendant until the overlap is resolved.
            if attribution_status in ("inside_shift","ambiguous_overlap"):
                purchase_by_tank[tid]=purchase_by_tank.get(tid,0.0)+discharged
                if attribution_status=="inside_shift":
                    attributed_shift_id=str(discharge_attribution.get("shift_id") or "")
                    if attributed_shift_id:
                        purchase_by_shift[attributed_shift_id]=purchase_by_shift.get(attributed_shift_id,0.0)+discharged
                total_operation_adjustment=(pre_discharge_adjustment + (stock_adjustment or 0))
                if abs(total_operation_adjustment)>0.000001:
                    purchase_adjustment_by_tank[tid]=purchase_adjustment_by_tank.get(tid,0.0)+total_operation_adjustment

            discharge_operations_by_tank.setdefault(tid,[]).append({
                "purchase_id":p.get("id"),
                "invoice_number":p.get("invoice_number"),
                "product":p.get("product"),
                "operation_index":op_index,
                "discharge_datetime":op.get("discharge_datetime"),
                "tank_code":op.get("tank_code") or (tank_map.get(tid) or {}).get("tank_code"),
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
                    discharge_attribution=_attribute_discharge_to_shift(p.get("discharged_at"), p.get("tank_id"))
                    attributed_shift_id=str(discharge_attribution.get("shift_id") or "")
                    if attributed_shift_id:
                        purchase_by_shift[attributed_shift_id]=purchase_by_shift.get(attributed_shift_id,0.0)+discharged
                    discharge_operations_by_tank.setdefault(tid,[]).append({
                        "purchase_id":p.get("id"),
                        "invoice_number":p.get("invoice_number"),
                        "product":p.get("product"),
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

    # Attach each discharge to exactly one matching tank shift and attendant.
    purchase_operations_by_shift={}
    all_purchase_discharge_operations=[]
    for operations in discharge_operations_by_tank.values():
        for operation in operations:
            all_purchase_discharge_operations.append(operation)
            sid=str(operation.get("shift_id") or "")
            if sid and operation.get("shift_attribution_status")=="inside_shift":
                purchase_operations_by_shift.setdefault(sid,[]).append(operation)
    for summary in shift_summary:
        sid=str(summary.get("shift_id") or "")
        summary["tank_purchases_liters"]=float(purchase_by_shift.get(sid,0.0))
        summary["purchase_discharge_operations"]=sorted(purchase_operations_by_shift.get(sid,[]),key=lambda x:str(x.get("discharge_datetime") or ""))

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
        # Shared-tank dispensers can have overlapping shifts. Use the earliest
        # shift opening and the latest actual shift ending for the DSR boundary;
        # the last item by start time is not necessarily the last shift to end.
        first_h=rows[0][1] if rows else {}
        closing_pair=max(
            rows,
            key=lambda z:str(z[0].get("end_time") or z[0].get("start_time") or "")
        ) if rows else None
        last_h=closing_pair[1] if closing_pair else {}
        opening=float(first_h.get("tank_opening_liters") or 0) if rows else float(tank.get("opening_stock_liters") or 0)
        closing=float(last_h.get("tank_closing_liters") or 0) if rows else float(tank.get("current_liters") or 0)
        sales_l=float(sum(float(z[1].get("total_sales_liters") or 0) for z in rows))
        nozzle_sales_l=float(sum(float((tank_nozzle_sales_by_shift.get(tid) or {}).get(str(z[0].get("id") or "")) or 0) for z in rows))
        nozzle_sales_difference_l=sales_l-nozzle_sales_l
        purchased_l=float(purchase_by_tank.get(tid,0))
        # Returned fuel is physically added back to tank stock. Attribute each
        # shift's return once to the same tank used by the tank/shift ledger.
        returned_liters=float(sum(
            max(0.0,float(h.get("returned_liters") or 0))
            for _,h in rows
        ))
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
        # opening + discharged purchase + returned fuel + documented adjustments
        # - gross nozzle sales = closing. Meter sales stay gross; returns are
        # added back as physical stock, not subtracted from meter readings.
        # Each return is attributed once through the tank's shift rows.
        expected=opening+opening_adjustment_l+purchased_l+returned_liters+stock_adjustment_l-nozzle_sales_l
        diff=expected-closing
        basis=opening+opening_adjustment_l+purchased_l+returned_liters+stock_adjustment_l
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
            shift_returned_liters=max(0.0,float(h.get("returned_liters") or 0))
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
            shift_expected=shift_open+continuity_adjustment+shift_purchase+shift_returned_liters+shift_adjustment-shift_nozzle_sales
            shift_diff=shift_expected-shift_close
            shift_basis=shift_open+continuity_adjustment+shift_purchase+shift_returned_liters+shift_adjustment
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
                "returned_liters":shift_returned_liters,
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
            "returned_liters":returned_liters,
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

    return jsonify(_json_safe({
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
        "purchase_discharge_operations":all_purchase_discharge_operations,
        "handovers":handover_rows,
        "shift_summary":shift_summary,
        "dispenser_summary":dispenser_summary,
        "station_summary":station_summary,
        "tank_details":tank_details,
        "performance":dsr_performance,
        "dsr_dispenser_details":dispenser_details,
        "dsr_tank_details":tank_details,
        "dsr_sales_summary":{
            "by_product":product_rows,
            "by_type":sales_type_rows,
            "total_liters":station_l,
            "total_amount":station_a
        },
        "dsr_return_summary":{
            "total_returned_liters":sum(float(x.get("returned_liters") or 0) for x in shift_summary),
            "total_returned_amount":sum(float(x.get("returned_amount") or 0) for x in shift_summary),
            "by_product":[
                {"product":product,"returned_liters":float(values.get("liters") or 0),"returned_amount":float(values.get("amount") or 0)}
                for product,values in sorted(returned_by_product.items())
            ]
        },
        "dsr_performance":dsr_performance,
        "total_purchase_discharged_liters":total_p,
        "total_sales_liters":station_l,
        "total_sales_amount":station_a,
        "entered_payment_amount":station_a if all_payment_recorded else None,
        "financial_difference":(station_a-calculated_station_a) if all_payment_recorded else None,
        "financial_reconciliation_status":(("matched" if abs(station_a-calculated_station_a)<=1 else "variance") if all_payment_recorded else "not_available")
    }))

@app.get("/api/reports/daily/revisions")
def daily_report_revisions():
    auth=require_admin()
    if auth:return auth
    report_date=request.args.get("date") or date.today().isoformat()
    status,rows=sb("daily_report_revisions",params={
        "report_date":"eq."+report_date,
        "select":"id,report_date,revision_no,revision_reason,archived_by,archived_at,report_snapshot",
        "order":"revision_no.desc",
        "limit":"100"
    })
    if status!=200:return jsonify({"error":rows}),status
    return jsonify(rows or [])

def _daily_report_error_boundary(fn):
    @wraps(fn)
    def wrapped(*args,**kwargs):
        try:
            return fn(*args,**kwargs)
        except Exception as exc:
            return jsonify({
                "error":"Daily report generation failed",
                "type":type(exc).__name__,
                "message":str(exc)
            }),500
    return wrapped

@app.post("/api/reports/daily")
@_daily_report_error_boundary
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
    # A normal first-time DSR still requires final admin confirmation.
    # Historical DSRs created before the confirmation table existed are allowed
    # to be explicitly corrected only when a saved report already exists and
    # the caller supplies a revision reason. Never create a synthetic
    # confirmation record just to unlock regeneration.
    cs,confirmation=sb("daily_report_confirmations",params={"report_date":"eq."+report_date,"status":"eq.confirmed","select":"id","limit":"1"})
    if cs!=200:return jsonify({"error":confirmation}),cs
    existing_status,existing_rows=sb("daily_reports",params={"report_date":"eq."+report_date,"select":"id","limit":"1"})
    if existing_status!=200:return jsonify({"error":existing_rows}),existing_status
    is_explicit_revision=bool(str(data.get("revision_reason") or "").strip())
    is_legacy_saved_report=bool(existing_rows) and is_explicit_revision and not confirmation
    if not confirmation and not is_legacy_saved_report:
        return jsonify({"error":"Daily report requires final admin confirmation before it can be generated.","report_ready":False}),409
    status,result=rpc("generate_daily_report",{"p_report_date":report_date,"p_generated_by":session["employee_id"],"p_revision_reason":str(data.get("revision_reason") or "").strip() or None})
    if status>=400:return jsonify(result),status
    return jsonify(result),201

@app.post("/api/admin/reset-operational-data")
def admin_reset_operational_data():
    auth = require_admin()
    if auth:
        return auth

    data = request.get_json(silent=True) or {}
    if data.get("confirmation") != "RESET OPERATIONAL DATA":
        return jsonify({"error": "Type RESET OPERATIONAL DATA exactly to confirm this reset."}), 400

    pin = str(data.get("pin", ""))
    if not pin:
        return jsonify({"error": "Enter your admin PIN to confirm this reset."}), 400

    # Re-check the PIN for the currently authenticated admin on the server.
    # A client-side prompt alone is not an authorization check.
    employee_status, employees = sb("employees", params={
        "id": "eq." + str(session.get("employee_id")),
        "active": "eq.true",
        "role": "eq.admin",
        "select": "id,pin_hash"
    })
    if employee_status != 200 or not employees:
        return jsonify({"error": "Could not verify the active admin account. Please sign in again."}), 401
    if not verify_pin(pin, employees[0].get("pin_hash", "")):
        return jsonify({"error": "Invalid admin PIN. Operational data was not reset."}), 401

    try:
        status, result = rpc("reset_operational_data", {})
    except Exception:
        return jsonify({"error": "The operational reset failed. No success was reported; check the database logs before retrying."}), 500

    if status >= 400:
        return jsonify({"error": "The operational reset failed. No success was reported.", "details": result}), status

    payload = result[0] if isinstance(result, list) and result else result
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return jsonify({"error": "The database did not confirm the operational reset."}), 500

    return jsonify(payload), 200


@app.route("/", defaults={"path":""})
@app.route("/<path:path>")
def frontend(path=""):
    assets=request.environ["workers.env"].ASSETS
    from pyodide.ffi import run_sync
    from flask import Response
    r=run_sync(assets.fetch("https://assets.local/"+path))
    return Response(run_sync(r.bytes()),status=r.status,headers=r.headers)


# ---------------------------------------------------------------------------
# Google Drive export queue (DSR and MSR PDFs)
# The PDFs are built in the admin browser, so each report waits in drive_export_queue
# until an admin page uploads it. The Worker never sees report data beyond what it stores.
# ---------------------------------------------------------------------------
DRIVE_MAX_ATTEMPTS = 3
DRIVE_MAX_PDF_BYTES = 8 * 1024 * 1024

def _addis_today():
    return (datetime.now(timezone.utc) + timedelta(hours=3)).date()

def _drive_enqueue(kind, report_key, status="pending"):
    """Create/update a report queue row. Incomplete DSRs remain visible as waiting,
    but only pending rows wake the background PDF exporter."""
    body = {"kind": kind, "report_key": report_key, "status": status, "attempts": 0,
            "last_error": None, "updated_at": datetime.now(timezone.utc).isoformat()}
    st, out = sb("drive_export_queue", method="POST", params={"on_conflict": "kind,report_key"},
                 body=body, prefer="resolution=merge-duplicates,return=minimal")
    return st < 400

def _msr_ready(month_start):
    """True only after the month has ended and all its shifts and required DSRs are complete."""
    first = month_start.replace(day=1)
    next_first = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    last = next_first - timedelta(days=1)

    # Do not enqueue an MSR while its month is still in progress (Addis Ababa time).
    if _addis_today() <= last:
        return False

    cs, conf = sb("daily_report_confirmations", params={
        "report_date": "gte." + first.isoformat(), "and": "(report_date.lte.%s)" % last.isoformat(),
        "status": "eq.confirmed", "select": "report_date", "limit": "1000"})
    if cs >= 400:
        return False
    confirmed = {str(r.get("report_date")) for r in (conf or [])}

    # Shift timestamps are stored in UTC; report dates use Addis Ababa time (UTC+3).
    start_utc = datetime(first.year, first.month, first.day, tzinfo=timezone.utc) - timedelta(hours=3)
    end_utc = datetime(next_first.year, next_first.month, next_first.day, tzinfo=timezone.utc) - timedelta(hours=3)
    ss, shifts = sb("shifts", params={
        "and": "(start_time.gte.%s,start_time.lt.%s)" % (start_utc.isoformat(), end_utc.isoformat()),
        "select": "start_time,end_time", "limit": "10000"})
    if ss >= 400:
        return False

    days_with_shifts = set()
    for r in (shifts or []):
        # Every shift that began in this month must have ended, including shifts
        # that cross midnight into the following month.
        if not r.get("end_time"):
            return False
        try:
            t = datetime.fromisoformat(str(r.get("start_time")).replace("Z", "+00:00"))
            days_with_shifts.add((t.astimezone(timezone.utc) + timedelta(hours=3)).date().isoformat())
        except Exception:
            return False

    d = first
    while d <= last:
        key = d.isoformat()
        if key in days_with_shifts and key not in confirmed:
            return False
        d += timedelta(days=1)
    return True

def _drive_after_dsr_confirm(report_day):
    """Queue the DSR and check this and the previous month for MSR eligibility."""
    try:
        _drive_enqueue("dsr", report_day.isoformat())

        # Recheck the previous month when a DSR is confirmed in the new month,
        # because the prior month's MSR may only then become eligible.
        this_month = report_day.replace(day=1)
        previous_month = this_month - timedelta(days=1)
        candidates = (this_month, previous_month.replace(day=1))
        seen = set()
        for month_start in candidates:
            month_key = month_start.strftime("%Y-%m")
            if month_key in seen:
                continue
            seen.add(month_key)
            if _msr_ready(month_start):
                _drive_enqueue("msr", month_key)

    except Exception:
        app.logger.exception("drive enqueue failed")

def _drive_settings():
    st, rows = sb("drive_settings", params={"id": "eq.1", "select": "dsr_folder_id,msr_folder_id,purchase_folder_id,admin_audit_folder_id,admin_audit_sheet_id,updated_at"})
    if st >= 400:
        return None
    return (rows or [{}])[0]

def _drive_oauth_redirect_uri():
    configured = getattr(env(), "DRIVE_OAUTH_REDIRECT_URI", None)
    return str(configured).strip() if configured else request.url_root.rstrip("/") + "/api/drive/oauth/callback"


@app.get("/api/drive/oauth/start")
def drive_oauth_start():
    if not _load_drive_oauth_admin_session():
        return jsonify({"error": "Unauthorized"}), 401
    auth = require_admin()
    if auth: return auth
    try:
        client_id = getattr(env(), "GOOGLE_OAUTH_CLIENT_ID", None)
        if not client_id:
            return jsonify({"error": "GOOGLE_OAUTH_CLIENT_ID Worker secret is not configured"}), 503
        state = secrets.token_urlsafe(32)
        from urllib.parse import urlencode
        params = {
            "client_id": str(client_id),
            "redirect_uri": _drive_oauth_redirect_uri(),
            "response_type": "code",
            "scope": "openid email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
        response = redirect("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params), code=302)
        response.set_cookie("__Host-fuel_drive_oauth_state", state, max_age=600, secure=True,
                            httponly=True, samesite="Lax", path="/")
        return response
    except Exception:
        app.logger.exception("Could not start Google Drive OAuth")
        return jsonify({"error": "Could not start Google Drive authorization"}), 500


@app.get("/api/drive/oauth/callback")
def drive_oauth_callback():
    expected = request.cookies.get("__Host-fuel_drive_oauth_state", "")
    supplied = request.args.get("state", "")
    if not expected or not supplied or not hmac.compare_digest(str(expected), str(supplied)):
        return redirect("/admin-settings.html?drive_oauth=state_error", code=302)
    if not _load_drive_oauth_admin_session():
        return redirect("/admin-login.html?drive_oauth=admin_session_required", code=302)
    if request.args.get("error"):
        return redirect("/admin-settings.html?drive_oauth=denied", code=302)
    code = request.args.get("code", "")
    if not code:
        return redirect("/admin-settings.html?drive_oauth=missing_code", code=302)
    auth = require_admin()
    if auth:
        return redirect("/admin-login.html?drive_oauth=admin_session_required", code=302)
    try:
        tokens = drive.exchange_code(env(), code, _drive_oauth_redirect_uri())
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            return redirect("/admin-settings.html?drive_oauth=refresh_token_missing", code=302)
        encrypted = drive.encrypt_refresh_token(env(), refresh_token)
        try:
            connected_email = drive.google_email(tokens.get("access_token", ""))
        except Exception:
            connected_email = None
        row = {
            "id": 1,
            "encrypted_refresh_token": encrypted,
            "google_email": connected_email,
            "connected_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        st, out = sb("drive_oauth_connection", method="POST", params={"on_conflict": "id"},
                     body=row, prefer="resolution=merge-duplicates,return=minimal")
        if st >= 400:
            app.logger.error("Could not save encrypted Drive OAuth token: %s", str(out)[:200])
            return redirect("/admin-settings.html?drive_oauth=storage_error", code=302)
        return redirect("/admin-settings.html?drive_oauth=connected", code=302)
    except drive.DriveError as err:
        app.logger.warning("Google Drive OAuth callback failed: %s", str(err)[:200])
        return redirect("/admin-settings.html?drive_oauth=oauth_error", code=302)
    except Exception:
        app.logger.exception("Unexpected Google Drive OAuth callback error")
        return redirect("/admin-settings.html?drive_oauth=oauth_error", code=302)


@app.get("/api/drive/oauth/status")
def drive_oauth_status():
    auth = require_admin()
    if auth: return auth
    st, rows = sb("drive_oauth_connection", params={
        "id": "eq.1", "select": "google_email,connected_at,updated_at"
    })
    if st >= 400:
        return jsonify({"error": "Drive connection status unavailable"}), 500
    row = (rows or [None])[0]
    return jsonify({"connected": bool(row), "google_email": (row or {}).get("google_email"),
                    "connected_at": (row or {}).get("connected_at")}), 200


@app.post("/api/drive/oauth/disconnect")
def drive_oauth_disconnect():
    auth = require_admin()
    if auth: return auth
    st, out = sb("drive_oauth_connection", method="DELETE", params={"id": "eq.1"}, prefer="return=minimal")
    if st >= 400:
        return jsonify({"error": "Could not disconnect Google Drive"}), st
    return jsonify({"ok": True}), 200


@app.get("/api/drive/settings")
def drive_get_settings():
    auth = require_admin()
    if auth: return auth
    row = _drive_settings()
    if row is None:
        return jsonify({"error": "Drive settings unavailable"}), 500
    return jsonify({"dsr_folder_id": row.get("dsr_folder_id"), "msr_folder_id": row.get("msr_folder_id"),
                    "purchase_folder_id": row.get("purchase_folder_id"), "admin_audit_folder_id": row.get("admin_audit_folder_id"),
                    "admin_audit_sheet_id": row.get("admin_audit_sheet_id"), "updated_at": row.get("updated_at")}), 200

@app.put("/api/drive/settings")
def drive_put_settings():
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    current_settings = _drive_settings() or {}
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field, key in (("dsr_link", "dsr_folder_id"), ("msr_link", "msr_folder_id"), ("purchase_link", "purchase_folder_id"), ("admin_audit_link", "admin_audit_folder_id")):
        if field in data:
            raw = str(data.get(field) or "").strip()
            if not raw:
                update[key] = None
            else:
                fid = drive.parse_folder_id(raw)
                if not fid:
                    return jsonify({"error": "Paste a Google Drive folder link or folder ID for " + field}), 400
                update[key] = fid
    if "admin_audit_sheet_link" in data:
        raw_sheet = str(data.get("admin_audit_sheet_link") or "").strip()
        if not raw_sheet:
            update["admin_audit_sheet_id"] = None
        else:
            sheet_id = drive.parse_spreadsheet_id(raw_sheet)
            if not sheet_id:
                return jsonify({"error": "Paste a Google Sheets spreadsheet link or spreadsheet ID"}), 400
            update["admin_audit_sheet_id"] = sheet_id
    st, out = sb("drive_settings", method="PATCH", params={"id": "eq.1"}, body=update, prefer="return=representation")
    if st >= 400:
        return jsonify({"error": out}), st
    return drive_get_settings()

@app.post("/api/drive/test")
def drive_test():
    auth = require_admin()
    if auth: return auth
    row = _drive_settings() or {}
    folders = {"dsr": row.get("dsr_folder_id"), "msr": row.get("msr_folder_id"), "purchases": row.get("purchase_folder_id"), "admin_audit": row.get("admin_audit_folder_id")}
    try:
        result = drive.test_folders(env(), folders)
    except drive.DriveError as err:
        return jsonify({"ok": False, "error": str(err)}), err.status
    missing = [k for k, v in folders.items() if k != "admin_audit" and not v]
    return jsonify({"ok": not missing, "folders": result, "missing": missing,
                    "admin_audit_configured": bool(folders.get("admin_audit")),
                    "admin_audit_sheet_configured": bool(row.get("admin_audit_sheet_id"))}), 200

@app.get("/api/drive/queue")
def drive_queue():
    auth = require_admin()
    if auth: return auth

    # Show DSR dates that have started but are not yet confirmed as Waiting in
    # the queue. These rows must not trigger PDF generation/upload until the DSR
    # is confirmed; the report confirmation hook will change them to pending.
    try:
        today = _addis_today()
        start = today - timedelta(days=3650)
        ss, shifts = sb("shifts", params={
            "start_time": "gte." + start.isoformat() + "T00:00:00+03:00",
            "select": "start_time", "order": "start_time.asc", "limit": "10000"})
        cs, confirmed_rows = sb("daily_report_confirmations", params={
            "report_date": "gte." + start.isoformat(),
            "status": "eq.confirmed", "select": "report_date", "limit": "10000"})
        if ss == 200 and cs == 200:
            confirmed_dates = {str(row.get("report_date") or "")[:10] for row in (confirmed_rows or [])}
            started_dates = set()
            for shift in shifts or []:
                report_day = _local_date_from_iso(shift.get("start_time"))
                if report_day and report_day.isoformat() <= today.isoformat():
                    started_dates.add(report_day.isoformat())
            for report_day in sorted(started_dates - confirmed_dates):
                _drive_enqueue("dsr", report_day, status="waiting")
    except Exception:
        app.logger.exception("could not sync incomplete DSRs to Drive waiting queue")

    # Keep the ongoing month's MSR visible in the queue as Waiting, matching
    # incomplete DSRs. It must not be uploaded while the month is in progress.
    # Never overwrite a completed export; once the month closes, the existing
    # readiness check promotes this row to pending after all required DSRs are confirmed.
    try:
        current_month_key = _addis_today().strftime("%Y-%m")
        ms, current_msr_rows = sb("drive_export_queue", params={
            "kind": "eq.msr", "report_key": "eq." + current_month_key,
            "select": "id,status", "limit": "1"})
        if ms < 400:
            if not current_msr_rows:
                _drive_enqueue("msr", current_month_key, status="waiting")
            else:
                current_msr = current_msr_rows[0]
                if current_msr.get("status") != "done" and current_msr.get("status") != "waiting":
                    sb("drive_export_queue", method="PATCH",
                       params={"id": "eq." + str(current_msr.get("id"))},
                       body={"status": "waiting", "attempts": 0, "last_error": None,
                             "updated_at": datetime.now(timezone.utc).isoformat()},
                       prefer="return=minimal")
    except Exception:
        app.logger.exception("could not sync ongoing MSR to Drive waiting queue")

    st, rows = sb("drive_export_queue", params={
        "status": "neq.done", "select": "id,kind,report_key,status,attempts,last_error,updated_at",
        "order": "report_key.asc", "limit": "500"})
    if st >= 400:
        return jsonify({"error": rows}), st
    return jsonify(rows or []), 200

@app.post("/api/drive/queue/<item_id>/retry")
def drive_retry(item_id):
    auth = require_admin()
    if auth: return auth
    st, out = sb("drive_export_queue", method="PATCH", params={"id": "eq." + item_id},
                 body={"status": "pending", "attempts": 0, "last_error": None,
                       "updated_at": datetime.now(timezone.utc).isoformat()}, prefer="return=minimal")
    return jsonify({"ok": st < 400}), (200 if st < 400 else st)


@app.post("/api/drive/purchases/upload")
def drive_purchase_upload():
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    try:
        pdf = base64.b64decode(str(data.get("pdf_base64") or ""), validate=True)
    except Exception:
        return jsonify({"error": "pdf_base64 is not valid base64"}), 400
    if not pdf.startswith(b"%PDF"):
        return jsonify({"error": "Not a PDF"}), 400
    if len(pdf) > DRIVE_MAX_PDF_BYTES:
        return jsonify({"error": "PDF is too large"}), 413
    settings = _drive_settings() or {}
    root = settings.get("purchase_folder_id")
    if not root:
        return jsonify({"error": "Set the Purchases PDF folder link in Admin Settings first"}), 409
    raw_name = str(data.get("file_name") or "purchase-record.pdf").strip()
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", raw_name).strip("._")[:100]
    if not name.lower().endswith(".pdf"):
        name = (name or "purchase-record") + ".pdf"
    raw_date = str(data.get("purchase_date") or "")[:10]
    try:
        purchase_day = date.fromisoformat(raw_date)
    except Exception:
        purchase_day = datetime.now(timezone.utc).date()
    sub = purchase_day.strftime("%B %Y")
    try:
        file_id, link = drive.store_pdf(env(), root, sub, name, pdf)
        return jsonify({"ok": True, "file_id": file_id, "url": link,
                        "path": "PURCHASES/%s/%s" % (sub, name)}), 200
    except drive.DriveError as err:
        return jsonify({"ok": False, "error": str(err)}), err.status
    except Exception as err:
        app.logger.exception("Purchase PDF upload failed")
        return jsonify({"ok": False, "error": "Purchase PDF upload failed: " + (str(err) or type(err).__name__)}), 502

@app.post("/api/drive/queue/<item_id>/upload")
def drive_upload(item_id):
    auth = require_admin()
    if auth: return auth
    data = request.get_json(silent=True) or {}
    try:
        pdf = base64.b64decode(str(data.get("pdf_base64") or ""), validate=True)
    except Exception:
        return jsonify({"error": "pdf_base64 is not valid base64"}), 400
    if not pdf.startswith(b"%PDF"):
        return jsonify({"error": "Not a PDF"}), 400
    if len(pdf) > DRIVE_MAX_PDF_BYTES:
        return jsonify({"error": "PDF is too large"}), 413
    qs, items = sb("drive_export_queue", params={"id": "eq." + item_id, "select": "id,kind,report_key,status,attempts"})
    if qs >= 400 or not items:
        return jsonify({"error": "Queue item not found"}), 404
    item = items[0]
    if item.get("status") == "done":
        return jsonify({"ok": True, "already_uploaded": True}), 200
    settings = _drive_settings() or {}
    kind, key = item["kind"], item["report_key"]
    if kind == "dsr":
        root, sub, name = settings.get("dsr_folder_id"), key[:7], "DSR-" + key + ".pdf"
    else:
        root, sub, name = settings.get("msr_folder_id"), key[:4], "MSR-" + key + ".pdf"
    attempts = int(item.get("attempts") or 0) + 1
    try:
        if not root:
            raise drive.DriveError("No Drive folder set for " + kind.upper() + " reports in Settings", 409)
        file_id, link = drive.store_pdf(env(), root, sub, name, pdf)
        sb("drive_export_queue", method="PATCH", params={"id": "eq." + item_id}, body={
            "status": "done", "attempts": attempts, "last_error": None,
            "drive_file_id": file_id, "drive_url": link,
            "updated_at": datetime.now(timezone.utc).isoformat()}, prefer="return=minimal")
        return jsonify({"ok": True, "file_id": file_id, "url": link, "path": "%s/%s/%s" % (kind.upper(), sub, name)}), 200
    except drive.DriveError as err:
        status = "failed" if attempts >= DRIVE_MAX_ATTEMPTS or err.status in (403, 404, 409) else "pending"
        sb("drive_export_queue", method="PATCH", params={"id": "eq." + item_id}, body={
            "status": status, "attempts": attempts, "last_error": str(err)[:500],
            "updated_at": datetime.now(timezone.utc).isoformat()}, prefer="return=minimal")
        return jsonify({"ok": False, "error": str(err), "status": status}), err.status

Default=wsgi.entrypoint(app)