#!/usr/bin/env python3
"""Copy the Atlean Talks images from the old WordPress site into wp-content/uploads/.

The posts keep their image addresses (https://atleanworld.com/wp-content/uploads/...),
so once atleanworld.com points at this site the same addresses are served from here.
Large images are scaled down to 1600 px wide; names and formats stay the same.

Run where atleanworld.com is reachable (it still serves WordPress):
    pip install pillow && python tools/import_wp_images.py
"""
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PREFIX = "https://atleanworld.com/wp-content/uploads/"
URL_RE = re.compile(r'https://(?:www\.)?atleanworld\.com/wp-content/uploads/[^"\'\s<>)]+')
MAX_W = 1600

posts = json.loads((ROOT / "data" / "posts.json").read_text(encoding="utf-8"))
urls = set()
for p in posts:
    urls.update(URL_RE.findall(p.get("cover") or ""))
    urls.update(URL_RE.findall(p.get("body") or ""))

ok, failed = 0, []
for url in sorted(urls):
    rel = url.split("/wp-content/uploads/", 1)[1].split("?")[0]
    dest = ROOT / "wp-content" / "uploads" / rel
    if dest.exists():
        ok += 1
        continue
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "aw-website-image-import"})
        data = urllib.request.urlopen(req, timeout=60).read()
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        if img.width > MAX_W and fmt in ("JPEG", "PNG", "WEBP"):
            img = img.resize((MAX_W, round(img.height * MAX_W / img.width)), Image.LANCZOS)
            buf = io.BytesIO()
            if fmt == "JPEG":
                img.convert("RGB").save(buf, "JPEG", quality=82, optimize=True, progressive=True)
            else:
                img.save(buf, fmt, optimize=True)
            if buf.tell() < len(data):
                data = buf.getvalue()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        ok += 1
        print(f"ok   {rel} ({len(data) // 1024} KB)")
    except Exception as e:  # keep going; report at the end
        failed.append(f"{rel}: {e}")

print(f"\n{ok} of {len(urls)} images in wp-content/uploads/")
for f in failed:
    print("FAILED", f)
sys.exit(1 if failed and not ok else 0)
