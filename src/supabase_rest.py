import json
from pyodide.ffi import run_sync
from js import fetch, Object


def _headers(url, key, extra=None):
    h = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return Object.fromEntries([(k, v) for k, v in h.items()])


async def _request(url, key, method="GET", params=None, body=None, prefer=None):
    if params:
        from urllib.parse import urlencode
        url += ("&" if "?" in url else "?") + urlencode(params)
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    options = {"method": method, "headers": Object.fromEntries([(k, v) for k, v in headers.items()])}
    if body is not None:
        options["body"] = json.dumps(body)
    response = await fetch(url, options)
    text = await response.text()
    try:
        data = json.loads(text) if text else None
    except Exception:
        data = text
    return int(response.status), data


def request(base_url, key, method="GET", path="", params=None, body=None, prefer=None):
    return run_sync(_request(base_url.rstrip("/") + "/rest/v1/" + path.lstrip("/"), key, method, params, body, prefer))
