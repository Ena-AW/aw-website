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

404.html is served by the host for every address that doesn't exist, at any
depth, so its {{root}} is the absolute site path from SITE_BASE ("/" by default;
the Pages workflow sets "/aw-website/" for the preview).

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
_base = (os.environ.get("SITE_BASE") or "").strip("/")
SITE_BASE = f"/{_base}/" if _base else "/"   # where the site lives on its host

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


def load_jobs():
    """Published jobs as rows of website.jobs: from Supabase (the admin panel and
    the Atleable sync write there), or from data/jobs.json without Supabase."""
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ANON_KEY"):
        return supabase_get("jobs", "select=*&status=eq.published&order=updated_at.desc")
    path = ROOT / "data" / "jobs.json"
    rows = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    return [{
        "slug": j["slug"], "title": j["title"], "location": j.get("location", ""), "location_slug": j.get("locationSlug", ""),
        "country": j.get("country", ""), "position": j.get("position", ""), "language": j.get("language", ""),
        "employment_type": j.get("employmentType", ""), "work_model": j.get("workModel", ""),
        "salary": j.get("salary", ""), "description": j.get("description", ""), "apply_url": j.get("applyUrl", ""),
        "atleable_id": j.get("atleableId"), "created_at": j.get("createdAt", ""),
    } for j in rows]


def write_job_data(rows):
    """With Supabase configured, the jobs list and the home page's spotlight
    jobs come from the admin panel instead of the JSON files in data/."""
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ANON_KEY")):
        return
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


JOB_RE = re.compile(r"\{\{job\.(\w+)\}\}")
CONSENT_TEXT = ("I agree that Atlean World keeps my CV and the details in this form to consider me for this job "
                "and similar ones, as explained in the Privacy Policy. I can ask for them to be deleted at any time.")
# Country codes for the phone field: the markets we recruit for first, then the rest A to Z.
PHONE_CODES = [
    ("PT", "+351"), ("GR", "+30"), ("BG", "+359"), ("PL", "+48"), ("CY", "+357"), ("ES", "+34"), ("DE", "+49"),
    ("NL", "+31"), ("BE", "+32"), ("FR", "+33"), ("IT", "+39"), ("GB", "+44"), ("IE", "+353"),
    ("AL", "+355"), ("AR", "+54"), ("AT", "+43"), ("AU", "+61"), ("BA", "+387"), ("BR", "+55"), ("CA", "+1"),
    ("CH", "+41"), ("CL", "+56"), ("CN", "+86"), ("CO", "+57"), ("CZ", "+420"), ("DK", "+45"), ("DZ", "+213"),
    ("EE", "+372"), ("EG", "+20"), ("FI", "+358"), ("GE", "+995"), ("HR", "+385"), ("HU", "+36"), ("IL", "+972"),
    ("IN", "+91"), ("IR", "+98"), ("IS", "+354"), ("JP", "+81"), ("KR", "+82"), ("LB", "+961"), ("LT", "+370"),
    ("LU", "+352"), ("LV", "+371"), ("MA", "+212"), ("MD", "+373"), ("ME", "+382"), ("MK", "+389"), ("MT", "+356"),
    ("MX", "+52"), ("NO", "+47"), ("PE", "+51"), ("PH", "+63"), ("RO", "+40"), ("RS", "+381"), ("RU", "+7"),
    ("SE", "+46"), ("SI", "+386"), ("SK", "+421"), ("TN", "+216"), ("TR", "+90"), ("UA", "+380"), ("US", "+1"),
    ("VE", "+58"), ("ZA", "+27"),
]


def apply_endpoint():
    """The website-apply Edge Function, which forwards applications to Atleable."""
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    return f"{url}/functions/v1/website-apply" if url else ""


def render_apply(job):
    """The apply form. Jobs from Atleable send the CV straight to that job's
    pipeline in Atleable (via website-apply); other jobs use their apply link."""
    if not job.get("atleable_id"):
        if job.get("apply_url"):
            return f'<p><a class="aw-tbtn" href="{esc(job["apply_url"])}" rel="noopener">Apply now</a></p>'
        return '<p>Online applications for this job aren’t open yet. Please check back soon.</p>'
    codes = "".join(f'<option value="{c}"{" selected" if cc == "PT" else ""}>{cc} {c}</option>' for cc, c in PHONE_CODES)
    return f"""      <form class="aw-aform" id="aw-apply-form" novalidate data-endpoint="{esc(apply_endpoint())}">
        <input type="hidden" name="job_id" value="{esc(job["atleable_id"])}">
        <div class="aw-arow">
          <div class="aw-afield">
            <label class="aw-alabel" for="aw-a-name">Full name</label>
            <input class="aw-ainput" id="aw-a-name" name="name" type="text" required maxlength="120" autocomplete="name" aria-describedby="aw-a-name-err">
            <p class="aw-aerr" id="aw-a-name-err" data-for="name"></p>
          </div>
          <div class="aw-afield">
            <label class="aw-alabel" for="aw-a-email">Email</label>
            <input class="aw-ainput" id="aw-a-email" name="email" type="email" required maxlength="200" autocomplete="email" aria-describedby="aw-a-email-err">
            <p class="aw-aerr" id="aw-a-email-err" data-for="email"></p>
          </div>
        </div>
        <div class="aw-arow">
          <div class="aw-afield">
            <label class="aw-alabel" for="aw-a-phone">Phone</label>
            <div class="aw-aphone">
              <select class="aw-ainput aw-aphone__code" name="phone_code" aria-label="Country code" autocomplete="tel-country-code">{codes}</select>
              <input class="aw-ainput" id="aw-a-phone" name="phone_number" type="tel" required inputmode="tel" maxlength="20" autocomplete="tel-national" placeholder="912 345 678" aria-describedby="aw-a-phone-err">
            </div>
            <p class="aw-aerr" id="aw-a-phone-err" data-for="phone"></p>
          </div>
          <div class="aw-afield">
            <label class="aw-alabel" for="aw-a-linkedin">LinkedIn profile <span class="aw-aopt">optional</span></label>
            <input class="aw-ainput" id="aw-a-linkedin" name="linkedin_url" type="url" maxlength="300" placeholder="linkedin.com/in/your-name" aria-describedby="aw-a-linkedin-err">
            <p class="aw-aerr" id="aw-a-linkedin-err" data-for="linkedin_url"></p>
          </div>
        </div>
        <div class="aw-afield">
          <span class="aw-alabel" id="aw-a-cv-label">CV</span>
          <label class="aw-afile" for="aw-a-cv">
            <input id="aw-a-cv" name="cv" type="file" required accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-labelledby="aw-a-cv-label" aria-describedby="aw-a-cv-hint aw-a-cv-err">
            <span class="aw-afile__btn">Choose file</span>
            <span class="aw-afile__name" data-empty="No file chosen">No file chosen</span>
          </label>
          <p class="aw-ahint" id="aw-a-cv-hint">PDF or Word, up to 10 MB.</p>
          <p class="aw-aerr" id="aw-a-cv-err" data-for="cv"></p>
        </div>
        <div class="aw-afield">
          <label class="aw-acheck">
            <input type="checkbox" name="consent" value="true" required aria-describedby="aw-a-consent-err">
            <span data-consent-text>{esc(CONSENT_TEXT)} <a href="{{{{root}}}}privacy-policy/" target="_blank" rel="noopener">Read the Privacy Policy</a>.</span>
          </label>
          <p class="aw-aerr" id="aw-a-consent-err" data-for="consent"></p>
        </div>
        <input type="hidden" name="consent_text" value="{esc(CONSENT_TEXT)}">
        <div class="aw-ahp" aria-hidden="true"><label>Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="cf-turnstile" data-sitekey="0x4AAAAAAEj9k0XBclhf6p7N" data-theme="light"></div>
        <p class="aw-aerr" data-for="captcha"></p>
        <button class="aw-tbtn aw-asubmit" type="submit">Send application</button>
        <p class="aw-astatus" role="status" aria-live="polite"></p>
      </form>
      <div class="aw-athanks" id="aw-apply-thanks" tabindex="-1" hidden>
        <h3>Thank you, your application is in.</h3>
        <p>A recruiter will look at your CV and contact you by email or phone. Meanwhile, have a look at our <a href="{{{{root}}}}open-jobs/">other open jobs</a>.</p>
      </div>"""


def plain_text(body):
    return " ".join(htmlmod.unescape(re.sub(r"<[^>]+>", " ", body or "")).split())


EMPTY_P_RE = re.compile(r"<p>(?:\s|&nbsp;|<br\s*/?>)*</p>", re.I)
RULE_P_RE = re.compile(r"<p>(?:<(?:em|strong)>)*\s*[:.\-_=*~•·]{8,}\s*(?:</(?:em|strong)>)*</p>", re.I)


def clean_description(body):
    """Atleable descriptions come from Workable: drop the empty spacer
    paragraphs and turn "::::::::" divider lines into a real divider."""
    body = RULE_P_RE.sub("<hr>", body or "")
    body = EMPTY_P_RE.sub("", body)
    return re.sub(r"(?:\s*<hr>\s*){2,}", "<hr>", body).strip()


def render_job(template, job):
    loc = job.get("location") or job.get("country") or ""
    facts = [("Location", loc), ("Language", job.get("language")), ("Area", job.get("position")),
             ("Work model", job.get("work_model")), ("Contract", job.get("employment_type")), ("Salary", job.get("salary"))]
    summary = plain_text(job.get("description"))
    summary = summary if len(summary) <= 155 else summary[:155].rsplit(" ", 1)[0] + "…"
    values = {
        "title": esc(job["title"]),
        "summary": esc(summary or f'{job["title"]} in {loc}. Apply with Atlean World.'),
        "kicker_html": f'<p class="aw-job__kicker">{esc(job["language"])}-speaking role</p>' if job.get("language") else "",
        "chips_html": "".join(f"<li>{esc(v)}</li>" for v in (loc, job.get("work_model"), job.get("employment_type")) if v),
        "facts_html": "".join(f"<div><dt>{k}</dt><dd>{esc(v)}</dd></div>" for k, v in facts if v),
        "description": lazy_images(clean_description(job.get("description"))) or f"<p>{esc(job['title'])}, {esc(loc)}.</p>",
        "apply_html": render_apply(job),
    }

    def field(m):
        if m.group(1) not in values:
            sys.exit(f"job template: unknown field '{{{{job.{m.group(1)}}}}}'")
        return values[m.group(1)]
    return JOB_RE.sub(field, template)


def job_seo(job):
    return {"type": "job", "job": job,
            "breadcrumbs": [("Home", ""), ("Open jobs", "open-jobs/"), (job["title"], f"jobs/{job['slug']}/")]}


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

    jobs = load_jobs()
    job_template = (SRC / "templates" / "job.html").read_text(encoding="utf-8")
    for job in jobs:
        if not SLUG_RE.match(job["slug"] or ""):
            print(f"skipping job '{job['title']}': bad slug '{job['slug']}'")
            continue
        sources.append((Path("jobs") / job["slug"] / "index.html", render_job(job_template, job), job_seo(job)))

    sitemap = []
    for rel, html, meta in sources:
        depth = len(rel.parts) - 1
        root = "../" * depth or "./"
        if rel == Path("404.html"):   # served at any depth: links must be absolute
            root = SITE_BASE
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

    write_job_data(jobs)
    # the three newest articles, for the Atlean Talks section of the home page
    latest = [{"title": p["title"], "url": f"{p['slug']}/", "date": p["date"], "cover": p["cover"]} for p in posts[:3]]
    (OUT / "data" / "team-photos.json").write_text(json.dumps(team_photos()), encoding="utf-8")   # for the admin panel
    (OUT / "data" / "talks-latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Built {len(sources)} page(s), {len(posts)} of them blog posts and {len(jobs)} job pages, into {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    build()
    if "--serve" in sys.argv:
        import functools
        import http.server

        class Handler(http.server.SimpleHTTPRequestHandler):
            def send_error(self, code, message=None, explain=None):
                # like the live host: unknown addresses get the site's 404 page
                page = OUT / "404.html"
                if code != 404 or not page.exists():
                    return super().send_error(code, message, explain)
                body = page.read_bytes()
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)

        handler = functools.partial(Handler, directory=str(OUT))
        print("Serving on http://localhost:8000  (Ctrl+C to stop)")
        http.server.ThreadingHTTPServer(("", 8000), handler).serve_forever()
