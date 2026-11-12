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

Atlean Talks (the blog) comes from data/posts.json, or from Supabase when the
SUPABASE_URL and SUPABASE_ANON_KEY environment variables are set (the admin panel
writes there). Each published post becomes /<slug>/ from src/templates/post.html,
the same URLs the WordPress site used, and <!-- talks:list --> /
<!-- talks:categories --> in a page are replaced by the list of posts.

Usage:  python build.py           build once
        python build.py --serve   build, then serve on http://localhost:8000
"""
import html as htmlmod
import json
import math
import os
import re
import shutil
import sys
import urllib.request
from datetime import date
from pathlib import Path

import seo

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "_site"
STATIC_DIRS = ["assets", "data", "media"]

NAV_RE = re.compile(r"\A\s*<!--\s*nav:\s*([\w-]+)\s*-->\s*\n?")
INCLUDE_RE = re.compile(r"<!--\s*include:([\w-]+)\s*-->")


TALKS_RE = re.compile(r"<!--\s*talks:(list|categories)\s*-->")
FIELD_RE = re.compile(r"\{\{post\.(\w+)\}\}")
SLUG_RE = re.compile(r"\A[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def esc(text):
    return htmlmod.escape(str(text or ""), quote=True)


def supabase_get(table, query):
    """Read rows from Supabase's REST API with the public (anon) key. Row-level
    security only lets the anon key see published rows."""
    url = os.environ["SUPABASE_URL"].rstrip("/") + f"/rest/v1/{table}?{query}"
    key = os.environ["SUPABASE_ANON_KEY"]
    schema = os.environ.get("SUPABASE_SCHEMA", "website")
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept-Profile": schema})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def load_posts():
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ANON_KEY"):
        rows = supabase_get("posts", "select=*&status=eq.published&order=published_at.desc")
        posts = [{
            "slug": r["slug"], "title": r["title"], "date": (r.get("published_at") or "")[:10],
            "category": r.get("category") or "", "author": r.get("author") or "",
            "excerpt": r.get("excerpt") or "", "cover": r.get("cover_url") or "",
            "body": r.get("body") or "", "showAuthorPhoto": r.get("show_author_photo", True),
            "updated": (r.get("updated_at") or "")[:10],
        } for r in rows]
        print(f"Loaded {len(posts)} post(s) from Supabase")
    else:
        path = ROOT / "data" / "posts.json"
        posts = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        posts = [p for p in posts if p.get("status", "published") == "published"]
    for p in posts:
        if not SLUG_RE.match(p["slug"]):
            sys.exit(f"post '{p['title']}': slug '{p['slug']}' may only use a-z, 0-9 and hyphens")
        words = len(re.sub(r"<[^>]+>", " ", p["body"]).split())
        p["minutes"] = max(1, math.ceil(words / 220))
        d = date.fromisoformat(p["date"])
        p["date_human"] = f"{d.day} {d.strftime('%B %Y')}"
    posts.sort(key=lambda p: p["date"], reverse=True)
    return posts


LANG_CODES = {
    "german": ("Deutsch", "de"), "dutch": ("Nederlands", "nl"), "french": ("Français", "fr"),
    "italian": ("Italiano", "it"), "spanish": ("Español", "es"), "portuguese": ("Português", "pt"),
    "english": ("English", "en"), "greek": ("Ελληνικά", "el"), "polish": ("Polski", "pl"),
    "swedish": ("Svenska", "sv"), "danish": ("Dansk", "da"), "norwegian": ("Norsk", "no"),
    "finnish": ("Suomi", "fi"), "czech": ("Čeština", "cs"), "turkish": ("Türkçe", "tr"),
}


def write_job_data():
    """With Supabase configured, the jobs list and the home page's spotlight
    jobs come from the admin panel instead of the JSON files in data/."""
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ANON_KEY")):
        return
    rows = supabase_get("jobs", "select=*&status=eq.published&order=updated_at.desc")
    jobs = [{
        "slug": r["slug"], "title": r["title"], "location": r["location"], "locationSlug": r["location_slug"],
        "country": r["country"], "position": r["position"], "language": r["language"],
        "employmentType": r["employment_type"], "workModel": r["work_model"],
    } for r in rows]
    spotlight = []
    for r in sorted((r for r in rows if r.get("spotlight")), key=lambda r: r.get("spotlight_order") or 99)[:5]:
        native, code = LANG_CODES.get(r["language"].strip().lower(), (r["language"], ""))
        spotlight.append({"language": native, "languageCode": code, "title": r["title"],
                          "location": r["location"] or r["country"], "url": f"jobs/{r['slug']}/"})
    (OUT / "data" / "jobs.json").write_text(json.dumps(jobs, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "data" / "spotlight-jobs.json").write_text(json.dumps(spotlight, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Loaded {len(jobs)} job(s) from Supabase, {len(spotlight)} in the spotlight")


TEAM_DIR = ROOT / "media" / "team" / "web"


def team_photos():
    """media/team/web/<first-last>.webp, the same photos as the About us page."""
    return sorted(p.stem for p in TEAM_DIR.glob("*.webp")) if TEAM_DIR.is_dir() else []


def author_photo(name, photos):
    """Match an author's name to a team photo: "Pedro Maia" -> pedro-maia.webp,
    "Ena" -> ena.webp. A first name alone matches only if one photo has it."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    if not slug:
        return None
    if slug in photos:
        return slug
    first = slug.split("-")[0]
    hits = [p for p in photos if p.split("-")[0] == first]
    return hits[0] if len(hits) == 1 else None


def category_slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def render_talk_row(p, heading="h2"):
    cat = f'<span class="aw-talk__cat">{esc(p["category"])}</span>' if p["category"] else ""
    return (
        f'<li class="aw-talk" data-cat="{category_slug(p["category"])}">'
        f'<a href="{{{{root}}}}{p["slug"]}/">'
        f'{cat}'
        f'<{heading} class="aw-talk__title">{esc(p["title"])}</{heading}>'
        f'<p class="aw-talk__excerpt">{esc(p["excerpt"])}</p>'
        f'<time class="aw-talk__date" datetime="{p["date"]}">{p["date_human"]}</time>'
        f'</a></li>'
    )


def render_talks(kind, posts):
    if kind == "list":
        return "\n".join(render_talk_row(p) for p in posts)
    cats = sorted({p["category"] for p in posts if p["category"]}, key=str.lower)
    chips = ['<button type="button" class="aw-chip" data-cat="" aria-pressed="true">All</button>']
    chips += [f'<button type="button" class="aw-chip" data-cat="{category_slug(c)}" aria-pressed="false">{esc(c)}</button>' for c in cats]
    return "\n".join(chips)


def related_posts(post, posts, n=3):
    others = [p for p in posts if p["slug"] != post["slug"]]
    same = [p for p in others if p["category"] and p["category"] == post["category"]]
    rest = [p for p in others if p not in same]
    return (same + rest)[:n]


IMG_TAG_RE = re.compile(r"<img\b(?![^>]*\bloading=)", re.I)


def lazy_images(body):
    """Images inside an article load only when the reader scrolls near them."""
    return IMG_TAG_RE.sub('<img loading="lazy" decoding="async"', body)


def plain_excerpt(body, limit=155):
    """For a post without an excerpt: the start of its text, for the meta description."""
    text = " ".join(htmlmod.unescape(re.sub(r"<[^>]+>", " ", body or "")).split())
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def post_seo(post):
    return {
        "type": "article", "headline": post["title"], "image": post["cover"],
        "published": post["date"], "modified": post.get("updated") or None,
        "author": post["author"], "section": post["category"],
        "breadcrumbs": [("Home", ""), ("Atlean Talks", "atleantalks/"), (post["title"], post["slug"] + "/")],
    }


def render_post(template, post, posts):
    values = {k: esc(v) for k, v in post.items() if k != "body"}
    values["body"] = lazy_images(post["body"])
    values["description"] = esc(post["excerpt"] or plain_excerpt(post["body"]))
    values["cover_html"] = (
        f'<figure class="aw-post__cover"><img src="{esc(post["cover"])}" alt="" width="1076" height="605"></figure>'
        if post["cover"] else ""
    )
    photo = author_photo(post["author"], team_photos()) if post.get("showAuthorPhoto", True) else None
    values["author_html"] = (
        f'<span class="aw-post__author">'
        + (f'<img src="{{{{root}}}}media/team/web/{photo}.webp" alt="" width="32" height="32">' if photo else "")
        + f'By {esc(post["author"])}</span>'
    ) if post["author"] else ""
    values["category_html"] = (
        f'<a class="aw-post__cat" href="{{{{root}}}}atleantalks/?category={category_slug(post["category"])}">{esc(post["category"])}</a>'
        if post["category"] else ""
    )
    values["related"] = "\n".join(render_talk_row(p, "h3") for p in related_posts(post, posts))

    def field(m):
        if m.group(1) not in values:
            sys.exit(f"post template: unknown field '{{{{post.{m.group(1)}}}}}'")
        return str(values[m.group(1)])
    return FIELD_RE.sub(field, template)


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    partials = {p.stem: p.read_text(encoding="utf-8") for p in (SRC / "partials").glob("*.html")}

    posts = load_posts()
    page_dirs = {p.parent.relative_to(SRC / "pages").as_posix() for p in (SRC / "pages").rglob("index.html")}
    template = (SRC / "templates" / "post.html").read_text(encoding="utf-8")

    sources = [(p.relative_to(SRC / "pages"), p.read_text(encoding="utf-8"), None) for p in sorted((SRC / "pages").rglob("*.html"))]
    for post in posts:
        if post["slug"] in page_dirs or post["slug"] in STATIC_DIRS:
            sys.exit(f"post slug '{post['slug']}' clashes with a page or folder of the site")
        sources.append((Path(post["slug"]) / "index.html", render_post(template, post, posts), post_seo(post)))

    sitemap = []
    for rel, html, meta in sources:
        depth = len(rel.parts) - 1
        root = "../" * depth or "./"
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
        html = TALKS_RE.sub(lambda m: render_talks(m.group(1), posts), html)
        if nav:
            html = html.replace(f'data-nav="{nav}"', f'data-nav="{nav}" aria-current="page"')
        # canonical URL, social sharing tags and structured data (seo.py)
        path = "" if rel.parent == Path(".") else rel.parent.as_posix() + "/"
        if not seo.is_noindex(html):
            html = seo.add_head_tags(html, path, meta)
            sitemap.append((path, (meta or {}).get("modified") or (meta or {}).get("published")))
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
    (OUT / "sitemap.xml").write_text(seo.sitemap_xml(sitemap), encoding="utf-8")
    (OUT / "robots.txt").write_text(seo.robots_txt(), encoding="utf-8")

    write_job_data()
    # the three newest articles, for the Atlean Talks section of the home page
    latest = [{"title": p["title"], "url": f"{p['slug']}/", "date": p["date"], "cover": p["cover"]} for p in posts[:3]]
    (OUT / "data" / "team-photos.json").write_text(json.dumps(team_photos()), encoding="utf-8")   # for the admin panel
    (OUT / "data" / "talks-latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Built {len(sources)} page(s), {len(posts)} of them blog posts, into {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    build()
    if "--serve" in sys.argv:
        import functools
        import http.server

        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT))
        print("Serving on http://localhost:8000  (Ctrl+C to stop)")
        http.server.ThreadingHTTPServer(("", 8000), handler).serve_forever()
