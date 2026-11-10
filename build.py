#!/usr/bin/env python3
"""Build the static site into _site/.

Each page in src/pages/ is plain HTML with three small placeholders:

  <!-- nav: home -->       first line: which menu item is the current page
  <!-- include:header -->  replaced by src/partials/header.html
  <!-- include:footer -->  replaced by src/partials/footer.html
  {{root}}                 relative path back to the site root ("./", "../", ...)

src/pages/index.html            -> _site/index.html
src/pages/about-us/index.html   -> _site/about-us/index.html  (URL: /about-us/)

assets/, data/ and media/ are copied as they are; files in static/ go to the site root.

Usage:  python build.py           build once
        python build.py --serve   build, then serve on http://localhost:8000
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "_site"
STATIC_DIRS = ["assets", "data", "media"]

NAV_RE = re.compile(r"\A\s*<!--\s*nav:\s*([\w-]+)\s*-->\s*\n?")
INCLUDE_RE = re.compile(r"<!--\s*include:([\w-]+)\s*-->")


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    partials = {p.stem: p.read_text(encoding="utf-8") for p in (SRC / "partials").glob("*.html")}

    pages = sorted((SRC / "pages").rglob("*.html"))
    for page in pages:
        rel = page.relative_to(SRC / "pages")
        depth = len(rel.parts) - 1
        root = "../" * depth or "./"

        html = page.read_text(encoding="utf-8")
        nav = None
        m = NAV_RE.match(html)
        if m:
            nav = m.group(1)
            html = html[m.end():]

        def include(match):
            name = match.group(1)
            if name not in partials:
                sys.exit(f"{rel}: unknown include '{name}'")
            return partials[name]

        html = INCLUDE_RE.sub(include, html)
        if nav:
            html = html.replace(f'data-nav="{nav}"', f'data-nav="{nav}" aria-current="page"')
        html = html.replace("{{root}}", root)

        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(html, encoding="utf-8")

    for name in STATIC_DIRS:
        if (ROOT / name).is_dir():
            shutil.copytree(ROOT / name, OUT / name)
    # static/ holds files that must sit at the site root (favicon.ico, robots.txt, ...)
    if (ROOT / "static").is_dir():
        shutil.copytree(ROOT / "static", OUT, dirs_exist_ok=True)
    (OUT / ".nojekyll").touch()   # GitHub Pages: serve files as they are

    print(f"Built {len(pages)} page(s) into {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    build()
    if "--serve" in sys.argv:
        import functools
        import http.server

        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT))
        print("Serving on http://localhost:8000  (Ctrl+C to stop)")
        http.server.ThreadingHTTPServer(("", 8000), handler).serve_forever()
