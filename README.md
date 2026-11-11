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

Preview locally: `python build.py --serve`, then open http://localhost:8000.

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/pages.yml`).
