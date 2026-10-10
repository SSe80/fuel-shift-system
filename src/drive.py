"""Google Drive upload helpers for the Fuel Shift Worker.

Auth: a service account. Its JSON key is the Cloudflare secret GOOGLE_SERVICE_ACCOUNT_JSON.
The JWT is signed with WebCrypto (RSASSA-PKCS1-v1_5 / SHA-256), the same API the Worker
already uses for password hashing. Nothing here runs in the browser; the key never leaves the Worker.
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


def _b64url(data):
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _pem_to_der(pem):
    body = re.sub(r"-----[A-Z ]+-----", "", pem)
    return base64.b64decode("".join(body.split()))


def service_account(e):
    raw = getattr(e, "GOOGLE_SERVICE_ACCOUNT_JSON", None)
    if not raw:
        raise DriveError("GOOGLE_SERVICE_ACCOUNT_JSON secret is not set", 503)
    try:
        sa = json.loads(raw)
    except Exception:
        raise DriveError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON", 503)
    for k in ("client_email", "private_key"):
        if not sa.get(k):
            raise DriveError("Service account JSON is missing " + k, 503)
    return sa


async def _sign(sa):
    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claims = {"iss": sa["client_email"], "scope": DRIVE_SCOPE, "aud": TOKEN_URL, "iat": now, "exp": now + 3600}
    signing_input = _b64url(json.dumps(header, separators=(",", ":"))) + "." + _b64url(json.dumps(claims, separators=(",", ":")))
    der = _pem_to_der(sa["private_key"])
    key = await crypto.subtle.importKey(
        "pkcs8", to_js(der), Object.fromEntries([("name", "RSASSA-PKCS1-v1_5"), ("hash", "SHA-256")]),
        False, to_js(["sign"]))
    sig = await crypto.subtle.sign(Object.fromEntries([("name", "RSASSA-PKCS1-v1_5")]), key, to_js(signing_input.encode()))
    return signing_input + "." + _b64url(bytes(Uint8Array.new(sig).to_py()))


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


async def _token(sa):
    assertion = await _sign(sa)
    body = "grant_type=" + "urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + assertion
    status, data = await _http(TOKEN_URL, "POST", {"Content-Type": "application/x-www-form-urlencoded"}, body)
    if status >= 400 or not isinstance(data, dict) or "access_token" not in data:
        raise DriveError("Google sign-in failed (%s): %s" % (status, str(data)[:200]), 502)
    return data["access_token"]


def access_token(e):
    return run_sync(_token(service_account(e)))


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
        raise DriveError("Folder not found or not shared with the service account", 404)
    if status >= 400:
        raise _gerr("Folder check", status, data)
    if (data or {}).get("mimeType") != FOLDER_MIME:
        raise DriveError("The link is not a Drive folder", 400)
    if not ((data or {}).get("capabilities") or {}).get("canAddChildren", False):
        raise DriveError("Service account has no write access to this folder", 403)
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
        # Overwrite: same name, same file ID, so the Drive link stays stable
        status, data = await _http(UPLOAD_API + "/" + existing + "?uploadType=media&supportsAllDrives=true&fields=id,webViewLink",
                                   "PATCH", dict(_auth(token), **{"Content-Type": "application/pdf"}), to_js(pdf_bytes))
    else:
        boundary, body = _multipart({"name": name, "parents": [folder_id], "mimeType": "application/pdf"}, pdf_bytes)
        status, data = await _http(UPLOAD_API + "?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
                                   "POST", dict(_auth(token), **{"Content-Type": "multipart/related; boundary=" + boundary}), to_js(body))
    if status >= 400 or not data:
        raise _gerr("Upload", status, data)
    return data["id"], data.get("webViewLink")


async def _store(sa, root_id, subfolder, file_name, pdf_bytes):
    token = await _token(sa)
    await check_folder(token, root_id)
    sub_id = await _ensure_folder(token, root_id, subfolder)
    return await _upload_pdf(token, sub_id, file_name, pdf_bytes)


def store_pdf(e, root_id, subfolder, file_name, pdf_bytes):
    """Create the monthly/yearly subfolder if needed, then upload (or overwrite) the PDF.
    Returns (drive_file_id, web_view_link)."""
    return run_sync(_store(service_account(e), root_id, subfolder, file_name, pdf_bytes))


async def _check_both(sa, folders):
    token = await _token(sa)
    out = {}
    for key, fid in folders.items():
        out[key] = await check_folder(token, fid) if fid else None
    return out


def test_folders(e, folders):
    return run_sync(_check_both(service_account(e), folders))
