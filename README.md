# wow.junhots.com

Free tools for the WoW Forever realm: gear upgrades for every class, Tailoring and Enchanting leveling,
enchant priorities and macros, auction house helpers and class guides.

Fan-made. Not affiliated with or endorsed by Blizzard Entertainment.

## How it works

- `public/` is the whole site, served as static files by the Cloudflare Worker **junhots-wow**.
- `src/index.js` only handles `/api/*`: the site's auction house scan (uploaded on `/admin/`),
  feedback reports (with a Turnstile robot check) and soft rate limits. It uses this Worker's own KV namespace `WOW`.
- `src/census.js` keeps the level census fresh: a cron every 3 hours reads classicplus.io, and the Worker swaps the
  newest census into Mat timing, Sell spare mats, Tailoring finder, Profession leveling and Enchants as they are served.
- `scripts/build_site.py` builds `public/` from the finished tool pages in the WoW Forever project folder.

This Worker is separate from the junhots.com (Heroes of the Storm) site: its own name, domain, KV and secrets.

## Change the site

1. Edit the tool pages in the project folder, then run `python3 scripts/build_site.py`.
   It ends by running `node scripts/check-vendor-prices.cjs`, which stops the build if any vendor price on the site
   differs from the game. The game's prices live in `scripts/vendor-prices.json`; refresh them from your
   TradeSkillMaster save with `python3 scripts/vendor_ref.py "<...>/SavedVariables/TradeSkillMaster.lua"`.
2. Check it locally with `npx wrangler dev` (local test keys go in `.dev.vars`, which is never committed).
3. Commit on a branch and open a pull request. Only `main` goes live, after the pull request is merged.

## Settings kept in Cloudflare (never in this repo)

| Name | Kind | What it is |
| --- | --- | --- |
| `ADMIN_PASSWORD` | secret | password for `/admin/` (price upload, feedback inbox) |
| `TURNSTILE_SECRET` | secret | Turnstile secret key for the feedback form |
| `TURNSTILE_SITEKEY` | variable | Turnstile site key (public) |

`keep_vars: true` in `wrangler.jsonc` keeps them when the Worker is deployed.
