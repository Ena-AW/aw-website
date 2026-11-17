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

Old WordPress addresses: `data/redirects.json` maps old addresses that still get Google traffic (from the Search Console export of November 2026) to their new page. Old job ads go to Open Jobs, filtered by language when the old address names one. `build.py` turns each entry into a small page that forwards the visitor, because GitHub Pages can't do server redirects. Addresses that aren't listed are caught by rules in `404.html` (`/jobs/…`, `/job-location/…`, `/category/…`, `/tag/…`, `/author/…`). Blog posts kept their addresses, so they need no redirect.

Blog images from WordPress live in `wp-content/uploads/` at their old paths, so `https://atleanworld.com/wp-content/uploads/…` keeps working after the switch (`tools/import_wp_images.py`).

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

## Jobs from Atleable

Atleable's jobs are in the same Supabase database (`public.jobs`), so the website reads them directly. No API between the two is needed, and nothing in Atleable's tables changes.

- `website.sync_atleable_jobs()` (`supabase/migrations/20261116150000_atleable_jobs_sync.sql`) copies jobs published in Atleable into `website.jobs`. Edits to the title, description, location, employment type and work model follow; when a job is archived, unpublished or deleted in Atleable it is closed on the website.
- Which jobs go on the site is set in `website.atleable_rule()`: `mkt` (the current setting: only published jobs of the MKT client), `all` (every published job) or `manual` (copied in as drafts).
- Applications never go to Workable: the job page's apply form sends the CV to the job's pipeline in Atleable (`website.jobs.atleable_id` is Atleable's job id).
- Position, language, salary, web address and spotlight are set in the admin panel and never overwritten. Setting a job to Closed in the admin hides it until its state changes in Atleable.
- The `atleable-sync` Edge Function runs the sync and rebuilds the site when something changed. It is called every 15 minutes by `.github/workflows/atleable-sync.yml`, by the **Sync from Atleable** button in the admin's Jobs tab, and, if you want jobs to appear right away, by Atleable after it saves a job:

  ```
  POST https://<project>.supabase.co/functions/v1/atleable-sync
  x-sync-key: <ATLEABLE_SYNC_KEY>
  ```

  It replies `{"added": 1, "updated": 0, "closed": 0, "rebuilt": true}`.

Setup, once:

1. Apply the migration and deploy the function with `supabase functions deploy atleable-sync --no-verify-jwt`.
2. Supabase → Edge Functions → Secrets: add `ATLEABLE_SYNC_KEY` (a long random string). `GITHUB_TOKEN` and `GITHUB_REPO` are already there for `website-rebuild`.
3. GitHub → Settings → Secrets and variables → Actions: add the secret `ATLEABLE_SYNC_KEY` with the same value. The repository variable `SUPABASE_URL` must be set.

## Job pages and the apply form

Every published job gets a page at `/jobs/<slug>/`, built from `src/templates/job.html` in the layout of the job description reference (opening with the title, a photo of the country from `media/destinations/` and the key facts; a sticky section bar; one chapter per part of the description; the apply form; the blue closing). Styles in `assets/css/job.css`, script in `assets/js/job.js`.

City photos come from `data/city-photos.json`, a small Unsplash library per city (Lisbon, Porto, Braga, Athens, Thessaloniki, Sofia, Gdańsk, Limassol, Paris), hotlinked from images.unsplash.com as Unsplash asks. Jobs in the same city take turns, so two Lisbon jobs open on different photos; chapters 2 and 3 get the next photos of the city, and the photographers are credited at the bottom of the page. A job in a town without its own photos (e.g. Viana do Castelo) uses its country's photos. To add photos, add entries to that file. `build.py` splits the Atleable description into chapters at its dividers ("::::::") and headings (an `<h3>` or a short bold line such as "Requirements" or "What we offer:"), and drops empty spacer lines.

The apply form never goes to Workable. It posts the CV and details to the `website-apply` Edge Function, which checks them (and the Cloudflare Turnstile anti-bot check) and forwards them to Atleable, server to server:

```
POST https://aw-ats-458449481561.europe-west1.run.app/api/website/applications
X-Website-Key: <ATLEABLE_WEBSITE_KEY>
```

Atleable puts the application in the job's Applied stage. Jobs added by hand in the admin (not from Atleable) show their apply link instead.

Setup, once:

1. Deploy the function: `supabase functions deploy website-apply --no-verify-jwt`.
2. Supabase → Edge Functions → Secrets: add `ATLEABLE_WEBSITE_KEY` (the key Atleable gave) and `TURNSTILE_SECRET` (the Turnstile secret key for site key `0x4AAAAAAEj9k0XBclhf6p7N`).
3. Cloudflare Turnstile: the site's hostnames must include `atleanworld.com` and `ena-aw.github.io` (preview).


## Social media publishing (Facebook and Instagram)

The admin's **Social media** tab plans posts, carousels, reels and stories. The `social-publish` Edge Function sends each scheduled one to the Atlean World Facebook Page and Instagram when its time comes, and writes the links (or the error) back to the post. pg_cron calls it every 5 minutes (`supabase/migrations/20261117160000_social_publishing.sql`). LinkedIn is not connected yet: its part of a post is skipped and the other networks still go out.

- Meta access is a Business Manager **system user** token, which does not expire, with `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` and `business_management`. The Instagram account must be a business account linked to the Facebook Page.
- Instagram takes only JPEG photos between 4:5 and 1.91:1. Other photos are converted and cropped once and kept in the media bucket under `social/ig/`. Videos must be MP4. If Instagram is still processing a video, the post stays scheduled and the next run publishes it.
- A post that fails on one network can be scheduled again: networks it already went out on are skipped.

Setup:

1. Supabase → Edge Functions → Secrets: `META_SYSTEM_TOKEN` (the token), `SOCIAL_CRON_KEY` (a long random string), and `META_PAGE_ID` only if the token reaches more than one Page.
2. Supabase → Vault: `project_url` (`https://<project>.supabase.co`) and `social_cron_key` (the same value as `SOCIAL_CRON_KEY`).
3. Deploy with `supabase functions deploy social-publish --no-verify-jwt` and apply the migration.
4. Admin → Social media → Accounts → **Connect** on Facebook or Instagram (the first scheduled run also connects by itself).
