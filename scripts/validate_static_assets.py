#!/usr/bin/env python3
"""Validate local static references used by the installable Fuel Shift web app."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ERRORS = []

class References(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        candidates = []
        if tag == "script" and attrs.get("src"):
            candidates.append(attrs["src"])
        elif tag == "link" and attrs.get("href"):
            rel = set((attrs.get("rel") or "").lower().split())
            if rel.intersection({"stylesheet", "icon", "manifest", "apple-touch-icon", "preload"}):
                candidates.append(attrs["href"])
        elif tag in {"img", "source", "audio", "video"} and attrs.get("src"):
            candidates.append(attrs["src"])
        for value in candidates:
            check_reference(self.path, value)

def check_reference(owner, value):
    value = (value or "").strip()
    if not value or value.startswith(("#", "//")):
        return
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return
    path = parsed.path
    if not path:
        return
    if path.startswith("/"):
        target = PUBLIC / path.lstrip("/")
    else:
        target = (owner.parent / path).resolve()
    try:
        target.relative_to(PUBLIC.resolve())
    except ValueError:
        ERRORS.append(f"{owner.relative_to(ROOT)}: reference escapes public/: {value}")
        return
    if not target.is_file():
        ERRORS.append(f"{owner.relative_to(ROOT)}: missing local asset: {value} -> {target.relative_to(ROOT)}")

def main():
    if not PUBLIC.is_dir():
        print("ERROR: public/ directory not found")
        return 1

    for page in sorted(PUBLIC.rglob("*.html")):
        parser = References(page)
        try:
            parser.feed(page.read_text(encoding="utf-8"))
            parser.close()
        except Exception as exc:
            ERRORS.append(f"{page.relative_to(ROOT)}: HTML parse failed: {exc}")

    for manifest in (PUBLIC / "manifest.webmanifest", PUBLIC / "admin-manifest.webmanifest"):
        if manifest.exists():
            try:
                json.loads(manifest.read_text(encoding="utf-8"))
            except Exception as exc:
                ERRORS.append(f"{manifest.relative_to(ROOT)}: invalid JSON: {exc}")

    sw = PUBLIC / "service-worker.js"
    if sw.exists():
        source = sw.read_text(encoding="utf-8")
        match = re.search(r"const\s+SHELL\s*=\s*\[(.*?)\];", source, re.S)
        if match:
            for path in re.findall(r"""["'](/[^"']+)["']""", match.group(1)):
                if not (PUBLIC / path.lstrip("/")).is_file():
                    ERRORS.append(f"public/service-worker.js: missing shell resource {path}")
        else:
            ERRORS.append("public/service-worker.js: could not locate SHELL resource list")

    if ERRORS:
        print("Static asset validation failed:")
        for error in ERRORS:
            print(f" - {error}")
        return 1
    print(f"Static asset validation passed for {len(list(PUBLIC.rglob('*.html')))} HTML pages.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
