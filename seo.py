"""Search engine and social sharing tags, sitemap.xml and robots.txt.

build.py calls these for every page it writes:

  add_head_tags(html, path, meta)  adds the canonical URL, Open Graph / X (Twitter)
                                    tags and structured data (JSON-LD) before </head>
  sitemap_xml(entries)             every indexable page, with the date it last changed
  robots_txt()                     keeps /admin/ out of search engines

Two environment variables (set as repository variables, like SUPABASE_URL):

  SITE_URL       the live address, used in canonical links and the sitemap.
                 Default: https://atleanworld.com
  SITE_INDEXING  "on" lets search engines index the site. Anything else (the
                 default) adds <meta name="robots" content="noindex"> to every page,
                 so the GitHub Pages preview never competes with the live site in
                 Google. Set it to "on" when the new site goes live.

A page opts out of everything here with <meta name="robots" content="noindex">
in its own <head> (the admin panel does): it gets no extra tags and stays out of
the sitemap.
"""
import html as htmlmod
import json
import os
import re

SITE_URL = (os.environ.get("SITE_URL") or "https://atleanworld.com").rstrip("/")
INDEXING = os.environ.get("SITE_INDEXING", "").strip().lower() == "on"

SITE_NAME = "Atlean World"
DEFAULT_IMAGE = "media/brand/og-default.jpg"       # 1200 x 630, used when a page has no image of its own
THEME_COLOR = "#193360"

ORGANIZATION = {
    "@type": "Organization",
    "@id": SITE_URL + "/#organization",
    "name": SITE_NAME,
    "url": SITE_URL + "/",
    "logo": SITE_URL + "/media/brand/Atlean-world-logo.png",
    "email": "careers@atleanworld.com",
    "address": {
        "@type": "PostalAddress",
        "streetAddress": "Avenida de França, 140",
        "addressLocality": "Vila Nova de Famalicão",
        "addressCountry": "PT",
    },
    "sameAs": [
        "https://www.linkedin.com/company/atleanworld",
        "https://www.instagram.com/atleanworld/",
        "https://www.tiktok.com/@atleanworld",
    ],
}

NOINDEX_RE = re.compile(r'<meta\s+name="robots"\s+content="[^"]*noindex', re.I)
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
DESC_RE = re.compile(r'<meta\s+name="description"\s+content="([^"]*)"', re.I)

COUNTRY_CODES = {
    "portugal": "PT", "greece": "GR", "poland": "PL", "bulgaria": "BG", "cyprus": "CY",
    "spain": "ES", "germany": "DE", "netherlands": "NL", "italy": "IT", "france": "FR",
}
EMPLOYMENT_TYPES = {
    "full-time": "FULL_TIME", "part-time": "PART_TIME", "contract": "CONTRACTOR",
    "contractor": "CONTRACTOR", "temporary": "TEMPORARY", "internship": "INTERN",
}


def is_noindex(html):
    return bool(NOINDEX_RE.search(html))


def url_for(path):
    """"about-us/" -> https://atleanworld.com/about-us/ ; "" -> the home page."""
    return f"{SITE_URL}/{path}"


def absolute(src):
    """A media path or a full URL (Supabase storage) -> a full URL."""
    if not src:
        return ""
    return src if re.match(r"https?://", src) else url_for(src.lstrip("/"))


def jsonld(data):
    text = json.dumps({"@context": "https://schema.org", **data}, ensure_ascii=False, indent=1)
    return '<script type="application/ld+json">\n' + text.replace("</", "<\\/") + "\n</script>"


def breadcrumbs(items):
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i, "name": name, "item": url_for(path)}
            for i, (name, path) in enumerate(items, 1)
        ],
    }


def page_label(title):
    """"About Us — Atlean World" -> "About Us"."""
    return re.split(r"\s+[—|]\s+", title)[0].strip()


def add_head_tags(html, path, meta=None):
    """Add canonical, social and structured data tags to one page.

    path   the page's address below the site root: "", "about-us/", "my-post/"
    meta   optional extras: type ("website" / "article" / "job"), image,
           published, modified, author, section, breadcrumbs, job (a job dict)
    """
    if is_noindex(html):
        return html
    meta = meta or {}
    m = TITLE_RE.search(html)
    title = htmlmod.unescape(m.group(1).strip()) if m else SITE_NAME
    m = DESC_RE.search(html)
    desc = htmlmod.unescape(m.group(1)) if m else ""
    url = url_for(path)
    kind = meta.get("type", "website")
    image = absolute(meta.get("image")) or absolute(DEFAULT_IMAGE)
    label = meta.get("headline") or (page_label(title) if path else title)
    e = lambda s: htmlmod.escape(str(s), quote=True)

    tags = []
    if not INDEXING:
        tags.append('<meta name="robots" content="noindex, nofollow">')
    tags += [
        f'<link rel="canonical" href="{e(url)}">',
        f'<meta name="theme-color" content="{THEME_COLOR}">',
        f'<meta property="og:site_name" content="{SITE_NAME}">',
        '<meta property="og:locale" content="en_GB">',
        f'<meta property="og:type" content="{"article" if kind == "article" else "website"}">',
        f'<meta property="og:url" content="{e(url)}">',
         f'<meta property="og:title" content="{e(label)}">',
    ]
    if desc:
        tags.append(f'<meta property="og:description" content="{e(desc)}">')
    tags.append(f'<meta property="og:image" content="{e(image)}">')
    if image == absolute(DEFAULT_IMAGE):
        tags += ['<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
                 f'<meta property="og:image:alt" content="{SITE_NAME}">']
    tags.append('<meta name="twitter:card" content="summary_large_image">')
    if kind == "article":
        if meta.get("published"):
            tags.append(f'<meta property="article:published_time" content="{e(meta["published"])}">')
        if meta.get("modified"):
            tags.append(f'<meta property="article:modified_time" content="{e(meta["modified"])}">')
        if meta.get("section"):
            tags.append(f'<meta property="article:section" content="{e(meta["section"])}">')

    # structured data: what Google reads to show rich results
    graph = []
    if path == "":
        graph.append(ORGANIZATION)
        graph.append({"@type": "WebSite", "@id": SITE_URL + "/#website", "name": SITE_NAME,
                      "url": SITE_URL + "/", "publisher": {"@id": ORGANIZATION["@id"]}})
    else:
        graph.append(breadcrumbs(meta.get("breadcrumbs") or [("Home", ""), (label, path)]))
    if kind == "article":
        article = {
            "@type": "BlogPosting",
            "headline": label[:110],
            "description": desc,
            "image": [image],
            "mainEntityOfPage": url,
            "publisher": {"@id": ORGANIZATION["@id"], "@type": "Organization", "name": SITE_NAME,
                          "logo": {"@type": "ImageObject", "url": ORGANIZATION["logo"]}},
        }
        if meta.get("published"):
            article["datePublished"] = meta["published"]
            article["dateModified"] = meta.get("modified") or meta["published"]
        if meta.get("author"):
            article["author"] = {"@type": "Person", "name": meta["author"]}
        else:
            article["author"] = {"@id": ORGANIZATION["@id"], "@type": "Organization", "name": SITE_NAME}
        if meta.get("section"):
            article["articleSection"] = meta["section"]
        graph.append(article)
    if kind == "job" and meta.get("job"):
        graph.append(job_posting(meta["job"], url))
    tags += [jsonld(g) for g in graph]

    block = "\n<!-- seo (added by build.py, see seo.py) -->\n" + "\n".join(tags) + "\n"
    return html.replace("</head>", block + "</head>", 1)


def job_posting(job, url):
    """schema.org JobPosting for one job page (/jobs/<slug>/), from a row of the
    website.jobs table. This is what lets jobs show up in Google's job search.
    Google requires title, description, datePosted, hiringOrganization and
    jobLocation; validThrough and baseSalary are recommended."""
    city, _, country = (job.get("location") or "").rpartition(",")
    country = (country or job.get("country") or "").strip()
    code = COUNTRY_CODES.get(country.lower(), country)
    data = {
        "@type": "JobPosting",
        "title": job["title"],
        "description": job.get("description") or job["title"],
        "datePosted": (job.get("created_at") or job.get("datePosted") or "")[:10],
        "url": url,
        "identifier": {"@type": "PropertyValue", "name": SITE_NAME, "value": job.get("atleable_id") or job["slug"]},
        "hiringOrganization": {"@type": "Organization", "name": SITE_NAME, "sameAs": SITE_URL + "/",
                               "logo": ORGANIZATION["logo"]},
        "jobLocation": {"@type": "Place", "address": {
            "@type": "PostalAddress", "addressLocality": city.strip() or country, "addressCountry": code}},
        # true when people apply on the job page itself, false when "Apply" leads elsewhere
        "directApply": not job.get("apply_url"),
    }
    etype = EMPLOYMENT_TYPES.get((job.get("employment_type") or job.get("employmentType") or "").strip().lower())
    if etype:
        data["employmentType"] = etype
    if (job.get("work_model") or job.get("workModel") or "").strip().lower() == "remote":
        data["jobLocationType"] = "TELECOMMUTE"
        data["applicantLocationRequirements"] = {"@type": "Country", "name": country}
    if job.get("valid_through"):
        data["validThrough"] = job["valid_through"]
    if job.get("language"):
        data["skills"] = f"Fluent {job['language']}"
    return data


def sitemap_xml(entries):
    """entries: list of (path, lastmod or None)."""
    rows = []
    for path, lastmod in sorted(entries, key=lambda x: (x[0] != "", x[0])):
        row = f"  <url><loc>{htmlmod.escape(url_for(path))}</loc>"
        if lastmod:
            row += f"<lastmod>{lastmod}</lastmod>"
        rows.append(row + "</url>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(rows) + "\n</urlset>\n")


def robots_txt():
    lines = ["# atleanworld.com", "User-agent: *"]
    if INDEXING:
        lines += ["Disallow: /admin/", "Allow: /"]
    else:
        lines += ["# Preview build: SITE_INDEXING is not \"on\", so nothing is indexed yet.", "Disallow: /"]
    lines += ["", f"Sitemap: {SITE_URL}/sitemap.xml", ""]
    return "\n".join(lines)
