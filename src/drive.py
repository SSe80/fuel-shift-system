"""Google Drive upload helpers for the Fuel Shift Worker.

Auth: administrator-authorized Google OAuth. Refresh tokens are AES-GCM encrypted with a Cloudflare Worker secret before server-only Supabase storage. Nothing here runs in the browser; OAuth secrets remain in the Worker.
"""
import base64, json, re, time, uuid
from pyodide.ffi import run_sync, to_js
from js import crypto, fetch, Object, Uint8Array

TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
DRIVE_API = "https://www.googleapis.com/drive/v3/files"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files"
FOLDER_MIME = "application/vnd.google-apps.folder"


class DriveError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def _gerr(what, status, data):
    """Map a Google HTTP failure to the status the Worker returns and whether it is permanent.
    401/403 = no access (permanent), 404 = missing (permanent), anything else = retryable."""
    if status in (401, 403):
        code = 403
    elif status == 404:
        code = 404
    else:
        code = 502
    return DriveError("%s failed (%s): %s" % (what, status, str(data)[:200]), code)


def parse_folder_id(text):
    """Accept a full Drive folder link or a bare folder ID. Returns the ID or None."""
    text = (text or "").strip()
    if not text:
        return None
    m = re.search(r"/folders/([A-Za-z0-9_-]{10,})", text)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", text):
        return text
    return None


def parse_spreadsheet_id(text):
    """Accept a Google Sheets URL or bare spreadsheet ID."""
    text = (text or "").strip()
    if not text:
        return None
    m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]{10,})", text)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", text):
        return text
    return None


def _b64url(data):
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _pem_to_der(pem):
    """Decode a Google service-account private key PEM into PKCS#8 DER bytes.

    Cloudflare secrets are sometimes pasted with JSON quotes or escaped newlines.
    Accept those harmless formatting variants, but reject non-PEM/invalid key data
    with a clear configuration error before WebCrypto tries to import it.
    """
    if isinstance(pem, bytes):
        pem = pem.decode()
    pem = str(pem or "").strip()
    if not pem:
        raise ValueError("private key is empty")
    # Also accept the private_key field copied from a service-account JSON file.
    if pem.startswith("{"):
        try:
            pem = str(json.loads(pem).get("private_key", "")).strip()
        except Exception:
            pass
    if len(pem) >= 2 and pem[0] == pem[-1] and pem[0] in ("'", '"'):
        pem = pem[1:-1]
    # Normalize both single-escaped (\\n) and double-escaped (\\\\n)
    # line breaks, which can happen when a JSON value is copied through a UI.
    for _ in range(3):
        pem = pem.replace("\\\\r\\\\n", "\n").replace("\\\\n", "\n")
    pem = pem.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "")
    # Remove a stray escape slash left behind by double-escaped line breaks.
    pem = re.sub(r"\\\\(?=\n)", "", pem)
    # Some secret editors preserve JSON-style escaped slashes or quote wrappers.
    pem = pem.replace("\\/", "/")
    if "-----BEGIN PRIVATE KEY-----" not in pem:
        if "-----BEGIN RSA PRIVATE KEY-----" in pem:
            raise ValueError(
                "The supplied key is PKCS#1 (RSA PRIVATE KEY), but WebCrypto requires PKCS#8. "
                "Use the private_key value from the Google service-account JSON credentials."
            )
        raise ValueError(
            "Expected a complete PKCS#8 PEM key beginning with -----BEGIN PRIVATE KEY-----. "
            "Set the secret to the JSON credentials' private_key value, not the whole file or its key ID."
        )
    body = re.sub(r"-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----", "", pem)
    body = "".join(body.split())
    # Do not silently strip arbitrary punctuation: report a safe, useful hint
    # without ever echoing any part of the secret into logs or API responses.
    if not body or re.search(r"[^A-Za-z0-9+/=]", body):
        raise ValueError(
            "The configured secret includes characters outside PEM base64. In Cloudflare, "
            "set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY to only the complete private_key string "
            "from the Google service-account JSON. If pasted as one line, preserve the \\n "
            "line-break escapes; do not include JSON field names, commas, or surrounding quotes."
        )
    try:
        der = base64.b64decode(body, validate=True)
    except Exception:
        raise ValueError(
            "The PEM key body is incomplete or invalid base64. Copy the full private_key value "
            "from the original Google service-account JSON; do not retype or truncate it."
        )
    if len(der) < 64 or not der.startswith(b"0"):
        raise ValueError("The decoded private key does not look like a valid PKCS#8 DER key.")
    return der


def _service_account_config(e):
    email = getattr(e, "GOOGLE_SERVICE_ACCOUNT_EMAIL", None)
    private_key = getattr(e, "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", None)
    if not email and not private_key:
        return None
    if not email or not private_key:
        raise DriveError(
            "Google Drive service-account authentication is selected, but "
            "GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is missing. "
            "Set the private key as a Cloudflare Worker secret.",
            503,
        )
    return str(email).strip(), str(private_key).replace("\\n", "\n").strip()


async def _service_account_access_token(e):
    """Create a short-lived Google OAuth access token using a service-account JWT."""
    config = _service_account_config(e)
    if not config:
        return None
    email, private_key = config
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")))
    claims = _b64url(json.dumps({
        "iss": email,
        "scope": DRIVE_SCOPE,
        "aud": TOKEN_URL,
        "iat": now,
        "exp": now + 3600,
    }, separators=(",", ":")))
    unsigned = header + "." + claims
    try:
        key = await crypto.subtle.importKey(
            "pkcs8",
            Uint8Array.new(to_js(list(_pem_to_der(private_key)))),
            Object.fromEntries([
                ("name", "RSASSA-PKCS1-v1_5"),
                ("hash", "SHA-256"),
            ]),
            False,
            to_js(["sign"]),
        )
        signature = await crypto.subtle.sign(
            Object.fromEntries([("name", "RSASSA-PKCS1-v1_5")]),
            key,
            to_js(unsigned.encode()),
        )
        jwt = unsigned + "." + _b64url(bytes(Uint8Array.new(signature).to_py()))
    except Exception as exc:
        detail = str(exc)
        if isinstance(exc, ValueError):
            detail = str(exc)
        elif "DataError" in detail or "Invalid PKCS8" in detail:
            detail = (
                "WebCrypto rejected the decoded private key as PKCS#8. Confirm that "
                "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is the complete private_key value "
                "from the Google service-account JSON file, with BEGIN/END PRIVATE KEY "
                "lines and real or escaped newlines."
            )
        raise DriveError(
            "Could not sign the Google service-account assertion. " + detail[:240],
            503,
        )
    from urllib.parse import urlencode
    status, data = await _http(
        TOKEN_URL,
        "POST",
        {"Content-Type": "application/x-www-form-urlencoded"},
        urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": jwt,
        }),
    )
    if status >= 400 or not isinstance(data, dict) or not data.get("access_token"):
        detail = (data or {}).get("error_description") or (data or {}).get("error") or str(data)
        raise DriveError(
            "Google service-account token exchange failed (%s): %s" % (status, str(detail)[:180]),
            503 if status >= 500 else 401,
        )
    return data["access_token"]


async def _drive_access_token(e):
    """Use the connected administrator Google account for My Drive uploads.

    Service accounts have no personal Drive storage quota, so uploading into a
    normal My Drive folder with a service-account token fails with HTTP 403.
    Prefer the stored user OAuth refresh token; use a service account only when
    user OAuth is not configured/connected (for example, a properly configured
    Shared Drive destination).
    """
    try:
        return await _refresh_access_token(e)
    except DriveError as exc:
        message = str(exc)
        # Only fall back when there is no usable user-OAuth setup at all. Do not
        # hide expired/revoked OAuth credentials behind a service-account retry.
        oauth_not_configured = (
            "Google OAuth client ID/secret are not configured" in message
            or "DRIVE_TOKEN_ENCRYPTION_KEY must be configured" in message
            or "Connect your personal Google Drive from Admin Settings first" in message
        )
        if not oauth_not_configured:
            raise
        token = await _service_account_access_token(e)
        if token:
            return token
        raise


def _oauth_config(e):
    client_id = getattr(e, "GOOGLE_OAUTH_CLIENT_ID", None)
    client_secret = getattr(e, "GOOGLE_OAUTH_CLIENT_SECRET", None)
    encryption_key = getattr(e, "DRIVE_TOKEN_ENCRYPTION_KEY", None)
    if not client_id or not client_secret:
        raise DriveError("Google OAuth client ID/secret are not configured in Worker secrets", 503)
    if not encryption_key or len(str(encryption_key)) < 32:
        raise DriveError("DRIVE_TOKEN_ENCRYPTION_KEY must be configured as a secret of at least 32 characters", 503)
    return str(client_id), str(client_secret), str(encryption_key)


async def _key_bytes(secret):
    digest = await crypto.subtle.digest("SHA-256", to_js(str(secret).encode()))
    return Uint8Array.new(digest)


async def _encrypt_refresh(secret, refresh_token):
    iv = crypto.getRandomValues(Uint8Array.new(12))
    key = await crypto.subtle.importKey("raw", await _key_bytes(secret),
        Object.fromEntries([("name", "AES-GCM")]), False, to_js(["encrypt"]))
    encrypted = await crypto.subtle.encrypt(Object.fromEntries([("name", "AES-GCM"), ("iv", iv)]),
        key, to_js(str(refresh_token).encode()))
    return "v1:" + _b64url(bytes(iv.to_py())) + ":" + _b64url(bytes(Uint8Array.new(encrypted).to_py()))


async def _decrypt_refresh(secret, value):
    try:
        version, iv_s, encrypted_s = value.split(":", 2)
        if version != "v1":
            raise ValueError("unsupported token format")
        iv = base64.urlsafe_b64decode(iv_s + "=" * (-len(iv_s) % 4))
        encrypted = base64.urlsafe_b64decode(encrypted_s + "=" * (-len(encrypted_s) % 4))
        key = await crypto.subtle.importKey("raw", await _key_bytes(secret),
            Object.fromEntries([("name", "AES-GCM")]), False, to_js(["decrypt"]))
        plain = await crypto.subtle.decrypt(Object.fromEntries([("name", "AES-GCM"), ("iv", to_js(iv))]),
            key, to_js(encrypted))
        return bytes(Uint8Array.new(plain).to_py()).decode()
    except Exception:
        raise DriveError("Stored Google authorization could not be decrypted. Check DRIVE_TOKEN_ENCRYPTION_KEY.", 503)


def encrypt_refresh_token(e, refresh_token):
    _, _, secret = _oauth_config(e)
    return run_sync(_encrypt_refresh(secret, refresh_token))


async def exchange_oauth_code(e, code, redirect_uri):
    client_id, client_secret, _ = _oauth_config(e)
    from urllib.parse import urlencode
    status, data = await _http(TOKEN_URL, "POST", {"Content-Type": "application/x-www-form-urlencoded"},
        urlencode({"code": code, "client_id": client_id, "client_secret": client_secret,
                   "redirect_uri": redirect_uri, "grant_type": "authorization_code"}))
    if status >= 400 or not isinstance(data, dict) or not data.get("access_token"):
        raise DriveError("Google authorization exchange failed (%s): %s" % (status, str(data)[:240]), 502)
    return data


def exchange_code(e, code, redirect_uri):
    return run_sync(exchange_oauth_code(e, code, redirect_uri))


async def _google_email(token):
    status, data = await _http("https://openidconnect.googleapis.com/v1/userinfo", "GET", _auth(token))
    if status >= 400 or not isinstance(data, dict):
        return None
    return data.get("email")


def google_email(token):
    return run_sync(_google_email(token))


async def _refresh_access_token(e):
    client_id, client_secret, secret = _oauth_config(e)
    from supabase_rest import request as sb_request
    status, rows = sb_request(e.SUPABASE_URL, e.SUPABASE_SECRET_KEY, "GET",
        "drive_oauth_connection", {"id": "eq.1", "select": "encrypted_refresh_token"}, None, None)
    if status >= 400 or not rows:
        raise DriveError("Connect your personal Google Drive from Admin Settings first.", 401)
    refresh_token = await _decrypt_refresh(secret, rows[0].get("encrypted_refresh_token", ""))
    from urllib.parse import urlencode
    status, data = await _http(TOKEN_URL, "POST", {"Content-Type": "application/x-www-form-urlencoded"},
        urlencode({"client_id": client_id, "client_secret": client_secret,
                   "refresh_token": refresh_token, "grant_type": "refresh_token"}))
    if status >= 400 or not isinstance(data, dict) or not data.get("access_token"):
        raise DriveError("Google authorization expired or was revoked. Reconnect Google Drive in Admin Settings.", 401)
    return data["access_token"]


def access_token(e):
    return run_sync(_refresh_access_token(e))


async def _http(url, method="GET", headers=None, body=None):
    opts = {"method": method, "headers": Object.fromEntries(list((headers or {}).items()))}
    if body is not None:
        opts["body"] = body
    resp = await fetch(url, Object.fromEntries(list(opts.items())))
    text = await resp.text()
    try:
        data = json.loads(text) if text else None
    except Exception:
        data = text
    return int(resp.status), data


def _auth(token):
    return {"Authorization": "Bearer " + token}


def _q(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")


async def _find_child(token, parent_id, name, mime=None):
    q = "name='%s' and '%s' in parents and trashed=false" % (_q(name), _q(parent_id))
    if mime:
        q += " and mimeType='%s'" % mime
    url = DRIVE_API + "?q=" + _urlq(q) + "&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true"
    status, data = await _http(url, "GET", _auth(token))
    if status >= 400:
        raise _gerr("Drive lookup", status, data)
    files = (data or {}).get("files", [])
    return files[0]["id"] if files else None


def _urlq(s):
    from urllib.parse import quote
    return quote(s, safe="")


async def _ensure_folder(token, parent_id, name):
    found = await _find_child(token, parent_id, name, FOLDER_MIME)
    if found:
        return found
    body = json.dumps({"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]})
    status, data = await _http(DRIVE_API + "?supportsAllDrives=true&fields=id", "POST",
                               dict(_auth(token), **{"Content-Type": "application/json"}), body)
    if status >= 400 or not data:
        raise _gerr("Create folder '%s'" % name, status, data)
    return data["id"]


async def check_folder(token, folder_id):
    url = DRIVE_API + "/" + folder_id + "?fields=id,name,mimeType,capabilities(canAddChildren)&supportsAllDrives=true"
    status, data = await _http(url, "GET", _auth(token))
    if status == 404:
        raise DriveError("Folder not found or not accessible by the connected Google account", 404)
    if status >= 400:
        raise _gerr("Folder check", status, data)
    if (data or {}).get("mimeType") != FOLDER_MIME:
        raise DriveError("The link is not a Drive folder", 400)
    if not ((data or {}).get("capabilities") or {}).get("canAddChildren", False):
        raise DriveError("Connected Google account has no write access to this folder", 403)
    return {"id": data["id"], "name": data.get("name", "")}


def _multipart(metadata, pdf_bytes):
    boundary = "fsboundary" + uuid.uuid4().hex
    head = ("--%s\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n%s\r\n--%s\r\nContent-Type: application/pdf\r\n\r\n"
            % (boundary, json.dumps(metadata), boundary)).encode()
    tail = ("\r\n--%s--" % boundary).encode()
    return boundary, head + pdf_bytes + tail


async def _upload_pdf(token, folder_id, name, pdf_bytes):
    existing = await _find_child(token, folder_id, name)
    if existing:
        status, data = await _http(
            UPLOAD_API + "/" + existing + "?uploadType=media&supportsAllDrives=true&fields=id,webViewLink",
            "PATCH", dict(_auth(token), **{"Content-Type": "application/pdf"}),
            Uint8Array.new(to_js(list(pdf_bytes))))
        if status >= 400 or not isinstance(data, dict) or not data.get("id"):
            raise _gerr("Update existing PDF", status, data)
        return data["id"], data.get("webViewLink")

    # Try the normal single-request multipart upload first.
    boundary, body = _multipart(
        {"name": name, "parents": [folder_id], "mimeType": "application/pdf"}, pdf_bytes)
    status, data = await _http(
        UPLOAD_API + "?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
        "POST",
        dict(_auth(token), **{"Content-Type": "multipart/related; boundary=" + boundary}),
        Uint8Array.new(to_js(list(body))))
    if status < 400 and isinstance(data, dict) and data.get("id"):
        return data["id"], data.get("webViewLink")

    multipart_error = "%s" % _gerr("Multipart PDF upload", status, data)

    # Fallback: upload the raw PDF bytes, then set the file's name and parent
    # in a separate metadata request. This avoids multipart-body incompatibilities
    # in some Worker runtimes while keeping the same final Drive folder and filename.
    status, data = await _http(
        UPLOAD_API + "?uploadType=media&supportsAllDrives=true&fields=id",
        "POST", dict(_auth(token), **{"Content-Type": "application/pdf"}),
        Uint8Array.new(to_js(list(pdf_bytes))))
    if status >= 400 or not isinstance(data, dict) or not data.get("id"):
        raise DriveError("%s; raw PDF upload fallback failed: %s" %
                         (multipart_error, str(_gerr("Raw PDF upload", status, data))), 502)

    file_id = data["id"]
    metadata = json.dumps({"name": name, "mimeType": "application/pdf"})
    status, meta = await _http(
        DRIVE_API + "/" + file_id + "?addParents=" + _urlq(folder_id) +
        "&supportsAllDrives=true&fields=id,webViewLink",
        "PATCH",
        dict(_auth(token), **{"Content-Type": "application/json"}),
        metadata)
    if status >= 400 or not isinstance(meta, dict) or not meta.get("id"):
        raise DriveError("PDF content uploaded but Drive could not place/name it in the Purchases folder: %s" %
                         str(_gerr("Set PDF metadata", status, meta)), 502)
    return meta["id"], meta.get("webViewLink")


async def _store(e, root_id, subfolder, file_name, pdf_bytes):
    token = await _drive_access_token(e)
    await check_folder(token, root_id)
    sub_id = await _ensure_folder(token, root_id, subfolder)
    return await _upload_pdf(token, sub_id, file_name, pdf_bytes)


def store_pdf(e, root_id, subfolder, file_name, pdf_bytes):
    """Create the monthly/yearly subfolder if needed, then upload (or overwrite) the PDF.
    Returns (drive_file_id, web_view_link)."""
    return run_sync(_store(e, root_id, subfolder, file_name, pdf_bytes))


async def _check_both(e, folders):
    token = await _drive_access_token(e)
    out = {}
    for key, fid in folders.items():
        out[key] = await check_folder(token, fid) if fid else None
    return out


def test_folders(e, folders):
    return run_sync(_check_both(e, folders))


# Google Sheets-backed admin audit log. Uses the administrator-authorized Google OAuth connection.
SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"


async def _append_audit(token, folder_id, sheet_id, row):
    """Append an event to the configured spreadsheet, without creating Drive files."""
    await check_folder(token, folder_id)
    if not sheet_id:
        raise DriveError("Admin audit spreadsheet link is not configured", 400)

    # Initialize the header only if the existing spreadsheet's first row is empty.
    values_url = SHEETS_API + "/" + sheet_id + "/values/Sheet1%21A1%3AH1"
    status, data = await _http(values_url, "GET", _auth(token))
    if status >= 400:
        raise _gerr("Read admin audit spreadsheet", status, data)
    values = data.get("values", []) if isinstance(data, dict) else []
    if not values or not any(str(cell).strip() for cell in (values[0] if values else [])):
        header_url = SHEETS_API + "/" + sheet_id + "/values/Sheet1%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"
        header = json.dumps({"values": [[
            "Timestamp (UTC)", "Admin Name", "Admin ID", "Action", "Target",
            "Changes / Details", "Result", "API Path"
        ]]})
        status, data = await _http(header_url, "POST", dict(_auth(token), **{"Content-Type": "application/json"}), header)
        if status >= 400:
            raise _gerr("Initialize admin audit spreadsheet", status, data)

    append_url = SHEETS_API + "/" + sheet_id + "/values/Sheet1%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"
    payload = json.dumps({"values": [row]})
    status, data = await _http(append_url, "POST", dict(_auth(token), **{"Content-Type": "application/json"}), payload)
    if status >= 400:
        raise _gerr("Append admin audit row", status, data)
    return sheet_id


def append_audit_row(e, folder_id, sheet_id, row):
    """Append a row to the manually created spreadsheet selected in Admin Settings."""
    if not folder_id:
        raise DriveError("Admin audit folder is not configured", 400)
    if not sheet_id:
        raise DriveError("Admin audit spreadsheet link is not configured", 400)
    token = access_token(e)
    return run_sync(_append_audit(token, folder_id, sheet_id, row))
