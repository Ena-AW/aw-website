# AW Website

Source for atleanworld.com (moving off WordPress).

## Claude skills

- `.claude/skills/apple-design` from [emilkowalski/skills](https://github.com/emilkowalski/skills) (MIT, commit 715c180).

## How the site is built

Plain HTML, CSS and JavaScript. No framework.

| Folder | What's in it |
| --- | --- |
| `src/pages/` | One HTML file per page. `src/pages/about-us/index.html` becomes `/about-us/`. |
| `src/partials/` | `header.html` and `footer.html`, shared by every page. |
| `assets/css`, `assets/js` | `site.css` / `site.js` for every page, plus one file per page (e.g. `home.css`). |
| `data/` | Content the admin panel will manage later (e.g. `spotlight-jobs.json`, `posts.json`). |
| `src/templates/post.html` | The layout of one Atlean Talks article. Every published post becomes `/<slug>/`. |
| `media/` | Logos, images and videos. |

In a page, `<!-- include:header -->` and `<!-- include:footer -->` insert the shared parts,
`<!-- nav: home -->` on the first line marks the current menu item, and `{{root}}` is the path back to the site root.

Atlean Talks: build.py reads the posts from `data/posts.json` (later from Supabase), writes the list into `/atleantalks/` and one page per post at its old WordPress address.

Page not found: `src/pages/404.html` (styles in `assets/css/404.css`). GitHub Pages shows it for any address that doesn't exist; `static/.htaccess` does the same on an Apache/cPanel host. Because it can appear at any depth, its links are absolute, built from `SITE_BASE` (set automatically by the Pages workflow).

Preview locally: `python build.py --serve`, then open http://localhost:8000.

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/pages.yml`).

## SEO (`seo.py`)

`build.py` runs every page through `seo.py`, which adds before `</head>`:

- a canonical link and Open Graph / X tags (title and description come from the page's own `<title>` and `<meta name="description">`; the share image is the article cover or `media/brand/og-default.jpg`),
- structured data: Organization + WebSite on the home page, BlogPosting on every article, breadcrumbs everywhere else, and `seo.job_posting()` for the job pages (Google for Jobs).

It also writes `sitemap.xml` and `robots.txt` (which keeps `/admin/` out). A page with `<meta name="robots" content="noindex">` in its head is skipped and left out of the sitemap.

Two repository variables (Settings → Secrets and variables → Actions → Variables):

| Variable | What it does |
| --- | --- |
| `SITE_URL` | The live address for canonical links and the sitemap. Default `https://atleanworld.com`. |
| `SITE_INDEXING` | Set to `on` at go-live. Until then every page says `noindex`, so the preview never competes with the live site in Google. |

At go-live: set `SITE_INDEXING=on`, then submit `https://atleanworld.com/sitemap.xml` in Google Search Console.

## Admin panel (`/admin/`)

Sign in with Google, using an Atlean account. Tabs: **Jobs**, **Atlean Talks**, **Home page** (the 3–5 spotlight jobs, in order), **Social media** (planner for Instagram, Facebook and LinkedIn: calendar, list, composer with previews), **Media** and **Users** (admins only).

Article authors get their photo from `media/team/web/<first-last>.webp` when the name matches ("Pedro Maia" → `pedro-maia.webp`); it can be switched off per article.

- Data lives in the Atleable Supabase project, in its own `website` schema (`supabase/migrations/`), so it never touches Atleable's tables. Row-level security lets visitors read only published jobs and articles; only people listed under Users can change anything.
- Media files go to the public `media` storage bucket, in folders (logos, images, videos, documents, blog).
- Saving anything calls the `website-rebuild` Edge Function (`supabase/functions/`), which starts the GitHub Pages workflow. The site updates in about a minute.
- `build.py` reads jobs and articles from Supabase when the repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set (Settings → Secrets and variables → Actions → Variables); otherwise it uses the JSON files in `data/`.
- `assets/vendor/supabase` (supabase-js 2.45.4, MIT) and `assets/vendor/quill` (Quill 2.0.2, BSD-3) are kept in the repo, so the panel doesn't depend on a CDN.
