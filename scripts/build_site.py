#!/usr/bin/env python3
"""Build wow.junhots.com (public/) from the finished WoW Forever tool pages.

  python3 scripts/build_site.py                 # tool pages from /mnt/project-files (the WoW Forever project folder)
  WF_SRC=/path/to/project python3 scripts/build_site.py

The tools are built in the WoW Forever project (each tool's index.html, plus hub/build_hub.py for names, categories
and blurbs, hub/theme.py for the shared look). This script turns them into website pages:
  - one page per tool at its own address (SLUG below), with the site header, footer and nav;
  - @view-transition at the very top of every page, speculation rules (prerender on hover), canonical + og tags;
  - Inter / JetBrains Mono served from /assets/fonts instead of Google Fonts;
  - claude.ai artifact links swapped for site paths;
  - home page, /updates/ (from public/data/updates.json), 404, sitemap.xml, robots.txt.
Re-run it after any tool changes, then commit public/ in a branch and open a PR.
"""
import datetime, html, importlib.util, io, json, os, re, shutil, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(REPO, 'public')
SRC = os.environ.get('WF_SRC', '/mnt/project-files')
SITE = 'https://wow.junhots.com'
SITE_NAME = 'junhots WoW tools'
HOTS = 'https://junhots.com'
SOCIAL = [('Twitch', 'https://www.twitch.tv/junhots_'), ('YouTube', 'https://www.youtube.com/@junhots'), ('Twitter', 'https://x.com/junhots_')]
# Cloudflare Web Analytics site token (public, not a secret). Empty = no analytics script.
CF_BEACON = os.environ.get('CF_BEACON', '')

# tool id (hub/build_hub.py TOOLS) -> page address on the site
SLUG = {'crafted': 'gear-upgrades', 'leveling': 'profession-leveling', 'enchants': 'enchants', 'macros': 'enchant-macros',
        'tailoring': 'tailoring-finder', 'timing': 'mat-timing', 'sell': 'sell-spare-mats', 'flips': 'vendor-flips',
        'warlock': 'warlock-guide', 'demons': 'demon-trainer', 'route': 'level-route', 'dungeons': 'dungeons', 'talents': 'talent-planner',
        'farm': 'farm-finder'}
# tools that fetch their own data files (<tool folder>/data/ -> /<slug>/data/)
DATA_DIRS = {'route': 'level-route/data', 'dungeons': 'dungeon-guide/data', 'farm': 'farm-finder/data'}
HUB_ARTIFACT = 'CHaDEsKnVJdVHSheWPz7XF'
# shorter tab names in the site header (category id -> label); others use the Hub's category label
NAV_LABEL = {'character': 'Gear', 'guides': 'Classes'}


def load(name, path):
    sys.path.insert(0, os.path.dirname(path))
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


hub = load('build_hub', os.path.join(SRC, 'hub/build_hub.py'))
theme = load('theme', os.path.join(SRC, 'hub/theme.py'))
TOOLS = [t for t in hub.TOOLS if t['id'] in SLUG and os.path.exists(os.path.join(SRC, t['src']))]
TOOL = {t['id']: t for t in TOOLS}
CATS = [dict(c, tools=[i for i in c['tools'] if i in TOOL]) for c in hub.CATS]
CATS = [c for c in CATS if c['tools']]
CAT_OF = {i: c for c in CATS for i in c['tools']}
ICONS = json.load(open(os.path.join(SRC, 'hub/icons.json')))
path_of = lambda tid: '/%s/' % SLUG[tid]
esc = html.escape
TODAY = datetime.date.today()

MARK = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 21 7v10l-9 5.2L3 17V7z" fill="var(--accent)"/>'
        '<path d="M14.2 7.2v7a3.2 3.2 0 0 1-6.4.4" fill="none" stroke="var(--on-accent)" stroke-width="2.4" stroke-linecap="round"/></svg>')
FILES_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
              '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 17v-6M9 14l3 3 3-3"/></svg>')
SPECULATION = ('<script type="speculationrules">{"prerender":[{"where":{"and":[{"href_matches":"/*"},'
               '{"not":{"selector_matches":"[target=_blank], [data-no-prerender]"}}]},"eagerness":"moderate"}]}</script>')


# ---------------------------------------------------------------- icons (.webp files instead of inline data URIs)
def write_icons():
    from PIL import Image
    import base64
    os.makedirs(os.path.join(PUB, 'assets/icons'), exist_ok=True)
    for key, uri in ICONS.items():
        raw = base64.b64decode(uri.split(',', 1)[1])
        im = Image.open(io.BytesIO(raw)).convert('RGB')
        im.save(os.path.join(PUB, 'assets/icons/%s.webp' % key), 'WEBP', quality=86, method=6)


icon_url = lambda key: '/assets/icons/%s.webp' % key


# ---------------------------------------------------------------- shared chrome
def builtin_scan():
    # newest auction scan built into the pages: the site's uploaded scan is only used when it is newer
    best = 0
    for f, k in (('tailoring-finder/data.json', 'scan'), ('profession-leveling/data.json', 'scan')):
        try:
            best = max(best, int(json.load(open(os.path.join(SRC, f)))[k]))
        except Exception:
            pass
    try:
        best = max(best, int(json.load(open(os.path.join(SRC, 'crafted-upgrades/gear_db.json')))['meta']['scan']))
    except Exception:
        pass
    return best


BUILTIN_SCAN = None


def head_tags(title, desc, path, og=None):
    global BUILTIN_SCAN
    if BUILTIN_SCAN is None:
        BUILTIN_SCAN = builtin_scan()
    url = SITE + path
    og = og or '/assets/og/default.jpg'
    tags = [
        '<meta name="ws-prices" content="%d">' % BUILTIN_SCAN,
        '<link rel="canonical" href="%s">' % url,
        '<meta name="description" content="%s">' % esc(desc),
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="%s">' % SITE_NAME,
        '<meta property="og:title" content="%s">' % esc(title),
        '<meta property="og:description" content="%s">' % esc(desc),
        '<meta property="og:url" content="%s">' % url,
        '<meta property="og:image" content="%s%s">' % (SITE, og),
        '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="theme-color" content="#141413">',
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
        '<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>',
        '<link rel="stylesheet" href="/assets/site.css">',
        '<script src="/assets/site.js" defer></script>',
        '<script src="/assets/npc.js" defer></script>',
        SPECULATION,
    ]
    if CF_BEACON:
        tags.append('<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
                    'data-cf-beacon=\'{"token": "%s"}\'></script>' % CF_BEACON)
    return '\n'.join(tags) + '\n'


HOME_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
             '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>')
SETUP_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
              '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>')
UPD_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/></svg>')
MIN_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>')
# runs first in <head>: the side panel's size (full or icons) is known before the page is drawn, so it never jumps
SIDE_JS = "<script>try { if (localStorage.getItem('ws.side') === 'mini') document.documentElement.classList.add('ws-mini'); if (localStorage.getItem('ws.owner')) document.documentElement.classList.add('ws-owner'); } catch (e) {}</script>"


def header(active_cat=None, active_tool=None, active_top=None):
    """Computers: the Hub's left side panel (every tool one click away, game files always shown).
    Phones (under 900px): a top bar with section tabs and the section's tools, since a hidden menu costs a tap."""
    cur = active_top or (active_cat and active_cat['id'])
    ind = lambda on, n: '<i class="%s" aria-hidden="true"></i>' % n if on else ''
    cur_attr = lambda on: ' aria-current="page"' if on else ''
    # ---- side panel
    items = ['<a href="/"%s title="Home">%s<span>Home</span>%s</a>' % (cur_attr(cur == 'home'), HOME_ICON, ind(cur == 'home', 'ws-ind'))]
    for c in CATS:
        items.append('<div class="ws-glabel">%s</div>' % esc(c['label']))
        for i in c['tools']:
            on = i == active_tool
            items.append('<a href="%s"%s title="%s"><img src="%s" alt="" width="20" height="20"><span>%s</span>%s</a>' % (
                path_of(i), cur_attr(on), esc(TOOL[i]['label']), icon_url(TOOL[i]['icon']), esc(TOOL[i]['label']), ind(on, 'ws-ind')))
    items.append('<div class="ws-glabel">Site</div>')
    items.append('<a href="/setup/"%s title="Set up once">%s<span>Set up once</span>%s</a>' % (cur_attr(cur == 'setup'), SETUP_ICON, ind(cur == 'setup', 'ws-ind')))
    items.append('<a href="/updates/"%s title="Updates">%s<span>Updates</span>%s</a>' % (cur_attr(cur == 'updates'), UPD_ICON, ind(cur == 'updates', 'ws-ind')))
    side = ('<aside class="ws-side" aria-label="Site menu"><div class="ws-sbrand">'
            '<a class="ws-brand" href="/" aria-label="%s home">%s<span class="t"><b>junhots</b><small>WoW Forever tools</small></span></a>' % (SITE_NAME, MARK) +
            '<button type="button" class="ws-ico ws-min" title="Make the menu smaller" aria-label="Make the menu smaller">%s</button></div>' % MIN_ICON +
            '<div class="ws-snav" role="navigation" aria-label="Tools">%s</div>' % ''.join(items) +
            '<div class="ws-sfoot"><div class="ws-fstat" aria-label="Your loaded game files"></div>'
            '<button type="button" class="ws-pbtn" data-ws-files aria-expanded="false" aria-controls="wsPop" title="Load your WoW files: '
            'auction prices, gear and recipes, bags and bank, quests done, flights">%s<span>Load game files</span></button>' % FILES_ICON +
            '<div class="ws-srow"><button type="button" class="ws-rep" data-ws-feedback title="Wrong price, wrong item, something broken?">Report a problem</button></div>'
            '<div class="ws-srow"><a href="%s" title="Jun\'s Heroes of the Storm site">HotS site ↗</a>' % HOTS +
            '<button type="button" class="wf-toggle inline" data-wf-toggle></button></div></div></aside>\n')
    # ---- phone top bar
    tabs = [('home', '/', 'Home')] + [(c['id'], path_of(c['tools'][0]), NAV_LABEL.get(c['id'], c['label'])) for c in CATS] + [('updates', '/updates/', 'Updates')]
    links = ''.join('<a href="%s"%s>%s%s</a>' % (h, cur_attr(k == cur), esc(lbl), ind(k == cur, 'ws-tab')) for k, h, lbl in tabs)
    sub = ''
    if active_cat and len(active_cat['tools']) > 1:
        sub = ('<div class="ws-sub" role="navigation" aria-label="%s"><div>' % esc(active_cat['label']) +
               ''.join('<a href="%s"%s><img src="%s" alt="" width="18" height="18">%s</a>' % (
                   path_of(i), cur_attr(i == active_tool), icon_url(TOOL[i]['icon']), esc(TOOL[i]['label']))
                   for i in active_cat['tools']) + '</div></div>')
    head = ('<div class="ws-head" role="banner"><div class="ws-bar">'
            '<a class="ws-brand" href="/" aria-label="%s home">%s<b>junhots</b></a>' % (SITE_NAME, MARK) +
            '<div class="ws-tabs" role="navigation" aria-label="Sections">%s</div>' % links +
            '<div class="ws-acts">'
            '<button type="button" class="ws-btn" data-ws-files aria-expanded="false" aria-controls="wsPop" title="Game files">%s'
            '<span class="ws-dots"></span></button>' % FILES_ICON +
            '<button type="button" class="ws-btn wf-toggle inline" data-wf-toggle></button>'
            '<a class="ws-btn" href="%s" title="Jun\'s Heroes of the Storm site">HotS</a>' % HOTS +
            '</div></div>%s</div>\n' % sub)
    return side + head + '<div class="ws-pop" id="wsPop" role="dialog" aria-label="Game files" hidden></div>\n'


def footer():
    social = ''.join('<a href="%s" rel="me noopener" target="_blank">%s</a>' % (u, n) for n, u in SOCIAL)
    return ('\n<div class="ws-foot" role="contentinfo"><div>'
            '<span>Made by junhots for the WoW Forever realm.</span>'
            '<a href="/updates/">Updates</a><a href="/about/">Data sources</a><button type="button" data-ws-feedback>Report a problem</button><a href="%s">Heroes of the Storm site</a>' % HOTS +
            '<span class="ws-social">%s</span>' % social +
            '<span class="ws-legal">Fan-made and free. Not affiliated with or endorsed by Blizzard Entertainment. '
            'World of Warcraft and its game icons are trademarks and property of Blizzard Entertainment, Inc. '
            'Files you load stay in your browser and are never uploaded.</span>'
            '<a class="ws-login" href="/admin/" rel="nofollow">Log in</a>'
            '</div></div>\n')


# ---------------------------------------------------------------- tool pages
def rewrite_links(s):
    # claude.ai artifact links -> site paths (internal links open in the same tab)
    amap = {HUB_ARTIFACT: '/'}
    for t in TOOLS:
        if t.get('url'):
            amap[t['url'].rsplit('/', 1)[1]] = path_of(t['id'])

    def sub(m):
        return '"%s"' % amap[m.group(1)] if m.group(1) in amap else m.group(0)
    s = re.sub(r'"https://claude\.ai/artifact/([A-Za-z0-9]+)"(?: target="_blank")?(?: rel="noopener")?', sub, s)
    # Sell spare mats' links to other tools: in the Hub they switch tabs; here they go to the tool's page
    s = s.replace("""'<a href="/">'""", """'<a href="' + ({%s}[id] || '/') + '">'""" %
                  ','.join('%s:"%s"' % (i, path_of(i)) for i in TOOL))
    s = s.replace('href="/" id="sellGo"', 'href="%s" id="sellGo"' % path_of('sell'))
    left = re.findall(r'https://claude\.ai/artifact/[A-Za-z0-9]+', s)
    if left:
        print('  ! artifact link left as is:', ', '.join(sorted(set(left))))
    return s


IMG_DIR = 'assets/i'
B64_IMG = re.compile(r'data:image/(webp|png|jpeg|gif);base64,([A-Za-z0-9+/=]{400,})')


GDB = re.compile(r'<script id="gdb" type="application/octet-stream">([A-Za-z0-9+/=\s]{1000,})</script>')


def externalize_data(s):
    """Gear upgrades' item data (gzip, base64 inline in the Hub) becomes /data/gear-<hash>.bin, cached for good."""
    import base64, hashlib
    m = GDB.search(s)
    if not m:
        return s
    raw = base64.b64decode(''.join(m.group(1).split()))
    # our own leveling stat weights (scripts/own-weights/own_weights.json, re-run daily) replace the item data's weights
    spec = importlib.util.spec_from_file_location('own_weights_apply', os.path.join(REPO, 'scripts/own-weights/apply.py'))
    ow = importlib.util.module_from_spec(spec); spec.loader.exec_module(ow)   # stdlib only, no sys.path change
    raw = ow.pack(ow.weights_into(json.loads(__import__('gzip').decompress(raw))))
    name = 'gear-%s.bin' % hashlib.sha1(raw).hexdigest()[:14]
    open(os.path.join(PUB, 'data', name), 'wb').write(raw)
    return s[:m.start()] + '<script id="gdb" type="application/octet-stream" data-src="/data/%s"></script>' % name + s[m.end():]


def externalize_images(s):
    """Page weight (review 16 Nov): inline icons (data: URIs) become files under /assets/i/<hash>.<ext>. The browser
    caches them for good, pages share them, and only the icons a page actually shows are downloaded."""
    import base64, hashlib
    os.makedirs(os.path.join(PUB, IMG_DIR), exist_ok=True)

    def sub(m):
        ext = 'jpg' if m.group(1) == 'jpeg' else m.group(1)
        raw = base64.b64decode(m.group(2))
        name = hashlib.sha1(raw).hexdigest()[:14] + '.' + ext
        path = os.path.join(PUB, IMG_DIR, name)
        if not os.path.exists(path):
            open(path, 'wb').write(raw)
        return '/%s/%s' % (IMG_DIR, name)
    return B64_IMG.sub(sub, s)


def site_assets(s):
    """Inline downloads in the Hub pages become real files on the site (smaller pages, cacheable)."""
    return re.sub(r'window\.WF_SNAPZIP = "data:application/zip;base64,[^"]*";', 'window.WF_SNAPZIP = "/downloads/GearSnapshot.zip";', s)


def strip_google_fonts(s):
    s = re.sub(r'<link[^>]+href="https://fonts\.(googleapis|gstatic)\.com[^"]*"[^>]*>\s*', '', s)
    return s


def build_tool(t):
    cat = CAT_OF.get(t['id'])
    path = path_of(t['id'])
    s = open(os.path.join(SRC, t['src']), encoding='utf-8').read()
    s = externalize_data(externalize_images(site_assets(strip_google_fonts(rewrite_links(s)))))
    title = '%s · WoW Forever · junhots' % t['label']
    desc = t.get('blurb') or t.get('short') or ''
    if len(desc) > 200:
        desc = desc[:197].rsplit(' ', 1)[0] + '…'
    s = re.sub(r'<title>.*?</title>', '<title>%s</title>' % esc(title), s, count=1, flags=re.S)
    attrs = ' lang="en" class="ws-site"'
    if t.get('needs'):
        attrs += ' data-ws-needs="%s"' % path_of(t['needs'][0])
    s = re.sub(r'<html([^>]*)>', lambda m: '<html%s%s>' % (re.sub(r'\s*(lang|class)="[^"]*"', '', m.group(1)), attrs), s, count=1)
    s = s.replace('<head>', '<head>\n<style>@view-transition { navigation: auto; }</style>\n<script>window.wsHash0 = location.hash;</script>\n' + SIDE_JS, 1)
    og = '/assets/og/%s.jpg' % SLUG[t['id']]
    i = s.index('</head>')
    s = s[:i] + head_tags(title, desc, path, og if os.path.exists(PUB + og) else None) + s[i:]
    s = re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + '\n' + header(cat, t['id']), s, count=1)
    i = s.rindex('</body>')
    # Tools that put their current tab in the address (#now) while loading would make the browser jump down to it
    # once the page is read. Opening a page without a #tab should start at the top, under the site header.
    s = s[:i] + footer() + ('<script>if (!window.wsHash0 && location.hash) history.replaceState(history.state, "", '
                            'location.pathname + location.search);</script>\n') + s[i:]
    out = os.path.join(PUB, SLUG[t['id']], 'index.html')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(s)
    print('  %-22s %5d KB' % (path, len(s.encode()) // 1024))
    if t['id'] in DATA_DIRS:
        dst = os.path.join(PUB, SLUG[t['id']], 'data')
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(os.path.join(SRC, DATA_DIRS[t['id']]), dst)


# ---------------------------------------------------------------- own pages
def own_page(path, title, desc, body, active_top=None, og=None, noindex=False):
    block = site_assets(strip_google_fonts(theme.theme_block('site')))
    # the tools' fold buttons and "Jump to" bar are for long tool pages, not for these short ones
    block = re.sub(r'<style id="wf-qol">.*?</style>\n<script>.*?</script>\n', '', block, flags=re.S)
    return ('<!DOCTYPE html>\n<html lang="en" class="ws-site">\n<head>\n<style>@view-transition { navigation: auto; }</style>\n' + SIDE_JS + '\n'
            '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<title>%s</title>\n' % esc(title) + ('<meta name="robots" content="noindex">\n' if noindex else '') +
            head_tags(title, desc, path, og) + block + '</head>\n<body>\n' + header(active_top=active_top) +
            '<main class="ws-main">\n' + body + '\n</main>' + footer() + '</body>\n</html>\n')


# Home tool list: a few plain words under each tool's name (the longer blurb is the hover title)
HINT = {'crafted': 'Better gear for your level', 'talents': 'Plan your talents', 'route': 'Every quest in order', 'dungeons': 'Bosses, drops and quests',
        'leveling': 'Cheapest way to 300', 'enchants': 'Which enchants to learn', 'macros': 'Macros for enchanting others',
        'tailoring': 'Crafts that make gold', 'timing': 'Buy now or wait', 'sell': 'Sell, vendor or keep', 'flips': 'Buy cheap, sell for more',
        'farm': 'Best gold per kill', 'warlock': 'Demonology guide', 'demons': 'Which demon books to buy'}


def build_home(updates):
    first = CATS[0]['tools'][0] if CATS else None
    steps = [
        (path_of('crafted') if 'crafted' in TOOL else '/', 'Find gear upgrades', 'Better gear for your class, and where to get it'),
        ('/setup/', 'Set up once', 'Three addons, then load your files: your own gear, bags and prices'),
        (path_of('route') if 'route' in TOOL else '/', 'Level 1 to 60', 'Every quest in order, with flights and dungeons'),
    ]
    step_ic = {'gear': icon_url(TOOL['crafted']['icon']) if 'crafted' in TOOL else '', 'setup': icon_url('inv_misc_bag_10'),
               'route': icon_url(TOOL['route']['icon']) if 'route' in TOOL else ''}
    step_html = ''.join('<a class="ws-card" data-step="%s" href="%s"><img src="%s" alt="" width="36" height="36"><span><b>%s</b><span>%s</span></span></a>' % (
        k, h, step_ic[k], esc(a), esc(b)) for k, (h, a, b) in zip(('gear', 'setup', 'route'), steps))
    # every tool once, as a compact list by category (the side menu has them too on computers)
    cols, n = [], 0
    for c in CATS:
        rows = []
        for i in c['tools']:
            t = TOOL[i]; n += 1
            rows.append('<a class="ws-tool" href="%s" title="%s"><img src="%s" alt="" width="32" height="32"%s><span><b>%s</b><small>%s</small></span></a>' % (
                path_of(i), esc(t.get('short') or ''), icon_url(t['icon']), ' loading="lazy"' if n > 8 else '', esc(t['label']), esc(HINT.get(i, ''))))
        cols.append('<div class="ws-drow"><h3>%s</h3><div>%s</div></div>' % (esc(c['label']), ''.join(rows)))
    secs = ['<section class="ws-sec"><h2>All tools</h2><div class="ws-dir">%s</div></section>' % ''.join(cols)]
    latest = ''
    if updates:
        latest = ('<section class="ws-sec"><h2>Latest updates</h2><div class="ws-ups">%s</div>'
                  '<a href="/updates/" style="color:var(--muted);font-size:13px">All updates</a></section>' % ''.join(update_html(u, True) for u in updates[:2]))
    # top: Kalimdor map art for new visitors; your own character in 3D once your game files are loaded (site.js homeTop)
    body = ('<section class="ws-top"><div class="ws-top-bg" aria-hidden="true"></div>'
            '<div class="ws-top-char" hidden><canvas role="img" aria-label="Your character wearing your gear. Drag to turn."></canvas><span class="ws-tag">Drag to turn</span></div>'
            '<div class="ws-top-main"><div class="ws-eb">Free tools for WoW Forever</div>'
            '<h1 class="ws-h">Know what to do next, from level 1 to 60</h1>'
            '<p class="ws-lead">Quest route, gear upgrades, professions and gold, for your class. Saved in your browser.</p>'
            '<div class="ws-pick" hidden></div></div></section>\n'
            '<section class="ws-sec ws-start"><h2>Start here</h2><div class="ws-steps">%s</div></section>\n' % step_html +
            '\n'.join(secs) + latest +
            '')
    desc = 'Free WoW Forever tools: gear upgrades for every class, a 1-60 quest route, cheapest profession leveling, gold making and class guides.'
    open(os.path.join(PUB, 'index.html'), 'w', encoding='utf-8').write(
        own_page('/', 'WoW Forever tools · junhots', desc, body, active_top='home'))


def update_html(u, lazy):
    d = datetime.date.fromisoformat(u['date'])
    img = ('<img src="%s" alt="" width="168" height="94"%s>' % (esc(u['image']), ' loading="lazy"' if lazy else '')) if u.get('image') else '<span></span>'
    link = ' <a href="%s">%s</a>' % (esc(u['link']), esc(u.get('linkText') or 'Open')) if u.get('link') else ''
    return ('<article class="ws-up">%s<div><time datetime="%s">%s</time><h3>%s</h3><p>%s%s</p></div></article>'
            % (img, d.isoformat(), d.strftime('%b %-d, %Y'), esc(u['title']), esc(u['text']), link))


def build_updates(updates):
    body = ('<div class="ws-hero"><h1>Updates</h1><p>What changed on the site, newest first.</p></div>'
            '<div class="ws-ups">%s</div>' % ''.join(update_html(u, i > 2) for i, u in enumerate(updates)))
    os.makedirs(os.path.join(PUB, 'updates'), exist_ok=True)
    open(os.path.join(PUB, 'updates/index.html'), 'w', encoding='utf-8').write(
        own_page('/updates/', 'Updates · WoW Forever · junhots', 'What changed on junhots WoW tools, newest first.', body, active_top='updates', og='/assets/og/updates.jpg'))


CREDITS = [
    ('Marcellus font', 'https://fonts.google.com/specimen/Marcellus', 'The heading font, by Astigmatic (SIL Open Font License).'),
    # (name, url or None, what it gives the tools)
    ('MythicSim Forever engine', 'https://github.com/sage3648/mythicsim-forever-engine', 'Combat sims (MIT license) behind our own leveling stat weights on Gear upgrades.'),
    ('Forever Leveling BiS addon', None, 'Gear rules (ported from its scoring) behind Gear upgrades, and the stat weights for the enchant ranking on Enchants.'),
    ('wago.tools', 'https://wago.tools/', 'Forever\'s own game data tables: item stats, icons, random suffixes and gear rules for Gear upgrades.'),
    ('wowtbc.gg WoW Forever database', 'https://wowtbc.gg/warcraftforever/', 'Recipes, reagents, skill levels and trainer data for Profession leveling and the Craft finder.'),
    ('classicplus.io', 'https://classicplus.io/', 'The daily level census of Horde characters that Mat timing and the "level crowd" tags read.'),
    ('TradeSkillMaster public data', 'https://www.tradeskillmaster.com/', 'Horde PvP sale rates and price history in the Craft finder and Sell spare mats.'),
    ('Blizzard Battle.net API', 'https://develop.battle.net/', 'Hourly Horde auction prices, listed counts and random suffix prices, for visitors who have not loaded their own scan. Item stats and quest rewards for Gear upgrades.'),
    ('Forever AH', 'https://forever-ah.com/', 'Backup for the hourly Horde prices (also read from Blizzard\'s Battle.net API).'),
    ('Auctionator', 'https://www.curseforge.com/wow/addons/auctionator', 'In-game auction scans (with Gear Snapshot\'s own scan): the file you load yourself, and the prices for each random suffix.'),
    ('Wowhead (WoW Forever)', 'https://www.wowhead.com/forever/', 'Vendor prices, the Warlock guide links and item pages for items this site has no card for yet.'),
    ('Dungeon Journal addon (by Exehn)', None, 'Bosses, drops, dungeon quests and where each boss stands, on Dungeons, Gear upgrades and in the Level 1-60 route.'),
    ('Questie / QuestieDB addon (Forever)', 'https://github.com/Questie/Questie', 'Where each NPC and monster stands and its level, for the NPC cards (hover a name), the Level 1-60 route and the Farm finder, and quest rewards for Gear upgrades (GPL-3.0).'),
    ('CMaNGOS Classic-DB', 'https://github.com/cmangos/classic-db', 'Classic drop chances for the Farm finder (GPL-3.0). Forever may have changed some; the page says so. Which items drop in the world, for Gear upgrades.'),
    ('AzerothCore', 'https://www.azerothcore.org/', 'Which game model each NPC uses, so the NPC cards can show Blizzard\'s picture of it (AGPL-3.0 data).'),
    ('OpenMap addon', 'https://github.com/openmap-world/openmap', 'The list of the game\'s dungeon map files and the boss spots in Lower Blackrock Spire, on Dungeons (MIT licence, /dungeons/data/OpenMap-LICENSE.txt). The maps are Blizzard\'s own.'),
]


def build_about():
    rows = ''.join('<li><b>%s</b>%s<br><span>%s</span></li>' % (
        ('<a href="%s" rel="noopener" target="_blank">%s</a>' % (u, esc(n))) if u else esc(n), '', esc(w)) for n, u, w in CREDITS)
    body = ('<div class="ws-hero"><h1>Data sources</h1><p>Where the numbers on this site come from. Thank you to everyone who makes this data.</p></div>'
            '<div class="ws-prose"><ul class="ws-credits">%s</ul>'
            '<h2>How fresh is it?</h2><p>Each tool shows the date of its own data at the top. Built-in auction prices are from the Horde auction house on the PvP realm. '
            'Load your own scan (Gear Snapshot or Auctionator, button in the side panel) and Gear upgrades, Enchants, Mat timing, Profession leveling, the Craft finder and Sell spare mats all use it.</p>'
            '<h2>Your files</h2><p>Game files you load stay in your browser (saved on this device so you do not have to load them again). They are never uploaded.</p></div>' % rows)
    os.makedirs(os.path.join(PUB, 'about'), exist_ok=True)
    open(os.path.join(PUB, 'about/index.html'), 'w', encoding='utf-8').write(
        own_page('/about/', 'Data sources · WoW Forever · junhots', 'Where the data behind junhots WoW Forever tools comes from.', body))


ADMIN_JS = r"""
(function () {
  var $ = function (id) { return document.getElementById(id); }, KEY = 'ws.admin';
  var pw = function () { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var when = function (ms) { return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
  function api(path, opt) {
    opt = opt || {}; opt.headers = Object.assign({ authorization: 'Bearer ' + pw() }, opt.headers || {});
    return fetch(path, opt).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function scanInfo() {
    fetch('/api/ah/meta', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (m) {
      $('ownScan').textContent = m.at ? 'Visitors now get the scan ' + (m.scan ? 'from ' + when(m.scan * 1000) + ', uploaded ' : 'uploaded ') + when(m.at) + ' (' + Math.round(m.size / 1024) + ' KB).' : 'No scan uploaded yet: visitors get the prices built into each page.';
    });
  }
  function reports() {
    api('/api/admin/feedback').then(function (j) {
      $('ownFbN').textContent = j.items.length ? '(' + j.items.length + ')' : '';
      try { localStorage.setItem('ws.fbseen', String(Date.now())); } catch (x) {}   // the reminder bar counts reports after this
      $('ownFb').innerHTML = j.items.length ? j.items.map(function (it) {
        return '<li><div class="own-meta">' + esc(when(it.at)) + ' · <a href="' + esc(it.page) + '">' + esc(it.page || '?') + '</a>' + (it.contact ? ' · ' + esc(it.contact) : '') + (it.country ? ' · ' + esc(it.country) : '') +
          '<button type="button" data-del="' + esc(it.key) + '">Delete</button></div><p>' + esc(it.text) + '</p></li>';
      }).join('') : '<li class="own-none">No reports. Nice.</li>';
    }).catch(function (e) { $('ownFb').innerHTML = '<li class="own-none">' + esc(e.message) + '</li>'; });
  }
  function unlock() {
    api('/api/admin/check').then(function () { $('ownLock').hidden = true; $('ownBody').hidden = false; try { localStorage.setItem('ws.owner', '1'); } catch (x) {} scanInfo(); reports(); },
      function (e) { $('ownPwMsg').textContent = e.message; try { sessionStorage.removeItem(KEY); } catch (x) {} });
  }
  $('ownLock').addEventListener('submit', function (e) {
    e.preventDefault(); try { sessionStorage.setItem(KEY, $('ownPw').value); } catch (x) {} $('ownPw').value = ''; unlock();
  });
  $('ownFile').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (f) (/gearsnapshot/i.test(f.name) ? f.text().then(function (t) { var lua = window.wsGsToAuctionator && window.wsGsToAuctionator(t); return lua ? upload(new File([lua], 'Gear Snapshot scan.lua', { lastModified: f.lastModified })) : uploadSfx(t, $('ownMsg'), ''); }) : upload(f)); });
  // Gear Snapshot saves a price per random suffix (Auctionator keeps one per item): every item you click in the AH,
  // or all of them after a full scan. Pull those entries out of the Lua file: ["Name of Suffix"] = { ["p"] = …, ["t"] = …, ["n"] = … }
  function sfxFromSnap(text) {
    var items = {}, n = 0, re = /\["([^"\]]+ of [^"\]]+)"\] = \{([^{}]*)\}/g, m, num = function (b, k) { var x = b.match(new RegExp('\\["' + k + '"\\] = (\\d+)')); return x ? +x[1] : 0; };
    while ((m = re.exec(text))) { var e = { p: num(m[2], 'p'), n: num(m[2], 'n'), t: num(m[2], 't') }; if (e.p && e.t) { items[m[1]] = e; n++; } }
    var ah = text.indexOf('["ah"]'), full = ah < 0 ? null : text.slice(ah).match(/\["full"\] = (\d+)/);
    return { items: items, count: n, full: full ? +full[1] : null };
  }
  function uploadSfx(text, msg, before) {
    var x = sfxFromSnap(text);
    if (!x.count) { msg.textContent = before + 'No suffix prices in Gear Snapshot yet (click items in the auction house, then /reload).'; return Promise.resolve(); }
    return api('/api/admin/sfx', { method: 'POST', body: JSON.stringify({ items: x.items, full: x.full }), headers: { 'content-type': 'application/json' } }).then(function (j) {
      msg.textContent = before + x.count.toLocaleString() + ' suffix prices sent (' + j.count.toLocaleString() + ' on the site now).';
    }, function (e) { msg.textContent = before + 'Suffix prices not sent: ' + e.message; });
  }
  // one click: the newest Auctionator.lua from the WoW folder linked in Load game files (or the last one loaded there)
  $('ownLatest').addEventListener('click', function () {
    var msg = $('ownMsg'), W = window.wsFiles;
    if (!W) { msg.textContent = 'Not ready yet, try again.'; return; }
    msg.textContent = 'Reading your WoW folder…';
    W.sync().then(function () { return W.get('ah'); }).then(function (rec) {
      if (!rec) { msg.textContent = 'No Auctionator.lua yet. Load your game files (bottom left) first.'; return; }
      upload(new File([rec.data], rec.name, { lastModified: rec.mod || rec.at }));
    }, function (e) { msg.textContent = 'Could not read it: ' + e.message; });
  });
  function upload(f) {
    var msg = $('ownMsg');
    msg.textContent = 'Reading ' + f.name + '…';
    f.arrayBuffer().then(function (buf) {
      var rec = window.WFAH.parse(new Uint8Array(buf));   // same parser the pages use: refuse a file they cannot read
      msg.textContent = 'Uploading: ' + rec.items.toLocaleString() + ' prices, scanned ' + when(rec.scan * 1000) + '…';
      return api('/api/admin/ah', { method: 'POST', body: buf, headers: { 'x-file-name': f.name, 'x-scan': String(rec.scan) } }).then(function () {
        var done = 'Done. ' + rec.items.toLocaleString() + ' prices from ' + when(rec.scan * 1000) + ' are live (visitors see them within 5 minutes). ';
        msg.textContent = done; scanInfo();
        // then the suffix prices from Gear Snapshot, if the WoW folder has it
        var W = window.wsFiles; if (!W) return;
        return W.get('snap').then(function (s) { if (s && s.data) return uploadSfx(new TextDecoder().decode(s.data), msg, done); });
      });
    }).catch(function (e) { msg.textContent = 'Not uploaded: ' + e.message; });
  }
  $('ownFb').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b) return;
    b.disabled = true; api('/api/admin/feedback/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }).then(reports);
  });
  $('ownOut').onclick = function () { try { sessionStorage.removeItem(KEY); } catch (x) {} location.reload(); };
  if (pw()) unlock();
})();
"""


SETUP_ADDONS = [
    # (name, link, what for, needed by)
    ('Gear Snapshot', '/downloads/GearSnapshot.zip', 'Saves your gear, level, talents, professions, known recipes, quests, flight points, your bags, bank and mail (all your characters), the monsters you loot, '
     'and auction prices for every item and every random suffix: click Gear Snapshot scan at the auction house. Made for this site.',
     'Every tool: your own prices, gear, bags and quests (otherwise: hourly Horde prices).'),
    ('Auctionator', 'https://www.curseforge.com/wow/addons/auctionator', 'Optional. Gear Snapshot 1.8 scans the auction house itself, and it also saves the prices when Auctionator scans.',
     'Prices, if you don\'t use Gear Snapshot\'s scan.'),
    ('TradeSkillMaster', 'https://www.curseforge.com/wow/addons/tradeskill-master', 'Optional. Gear Snapshot 1.7 saves your bags now.',
     'Bags and bank, if you don\'t use Gear Snapshot.'),
    ('Forever Leveling BiS', None, 'Optional. Gear Snapshot 1.8 reads your spec from your talents. A spec you pick in this addon wins.',
     'Gear upgrades (spec).'),
]


def build_setup():
    rows = ''.join('<li><b>%s</b> <span class="ws-need">%s</span><br>%s</li>' % (
        ('<a href="%s"%s>%s</a>' % (u, '' if u.startswith('/') else ' rel="noopener" target="_blank"', esc(n))) if u else esc(n),
        esc('For: ' + need), esc(what)) for n, u, what, need in SETUP_ADDONS)
    body = ('<div class="ws-hero"><h1>Set up once</h1><p>Every tool works without this. Do it once (about 10 minutes) and the tools use your own character, '
            'bags and auction prices.</p></div>'
            '<div class="ws-prose ws-setup">'
            '<p class="ws-phone-note">This part is done on your gaming PC, not on a phone.</p>'
            '<h2>1. Install the addons</h2>'
            '<p>The easiest way is the CurseForge app: pick the <b>WoW Forever</b> version of each addon. To install by hand, unzip into '
            '<code>World of Warcraft\\_forever_\\Interface\\AddOns\\</code> (each addon is one folder there).</p>'
            '<ul class="ws-credits">%s</ul>'
            '<h2>2. Make the game save your files</h2>'
            '<p>WoW only writes addon files when you type <code>/reload</code> or log out, so after each step below type <code>/reload</code>.</p>'
            '<ul class="ws-steps"><li><b>Prices:</b> open the auction house, click <b>Gear Snapshot scan</b> (above the window) or Auctionator\'s Full Scan, wait for 100%%, then <code>/reload</code>.</li>'
            '<li><b>Gear and recipes:</b> open each profession window once, then <code>/reload</code>.</li>'
            '<li><b>Bags and bank:</b> open your bank and mailbox, then <code>/reload</code>.</li></ul>'
            '<h2>3. Load them on this site</h2>'
            '<p>Press <b>Load game files</b> (bottom of the side panel, or the folder button at the top on phones), then <b>Pick WTF folder</b> '
            'and choose <code>World of Warcraft\\_forever_\\WTF</code>. The site finds the files itself. Do it again after each <code>/reload</code>.</p>'
            '<p>Load a file once and every tool uses it. Files stay in your browser and are never uploaded.</p>'
            '<p><a class="ws-cta" href="#" data-ws-open-files>Load game files</a></p></div>' % rows)
    os.makedirs(os.path.join(PUB, 'setup'), exist_ok=True)
    open(os.path.join(PUB, 'setup/index.html'), 'w', encoding='utf-8').write(
        own_page('/setup/', 'Set up once · WoW Forever · junhots', 'Which addons to install and how to load your WoW Forever files into the tools.', body, active_top='setup'))


def build_admin():
    body = ('<div class="ws-hero"><h1>Admin</h1><p>Read reports. Only for the site owner.</p></div>'
            '<form class="own-lock" id="ownLock"><label>Password <input id="ownPw" type="password" autocomplete="current-password" required></label>'
            '<button type="submit">Unlock</button><span id="ownPwMsg" role="status"></span></form>'
            '<div id="ownBody" class="ws-prose" hidden>'
            '<h2>Auction prices</h2><p><b>No upload needed:</b> prices update hourly from Blizzard for every auction house. An upload is only a backup if that stops.</p><p id="ownScan"></p>'
            '<p>In game: click Gear Snapshot scan (or Auctionator\'s Full Scan), wait for 100%%, then /reload. Then press Upload latest scan. The newest of the two is sent, with every suffix price.</p>'
            '<p><button type="button" class="own-btn" id="ownLatest">Upload latest scan</button> '
            '<label class="own-btn own-alt">Pick a file<input id="ownFile" type="file" accept=".lua,.bak,text/plain" hidden></label> <span id="ownMsg" role="status"></span></p>'
            '<h2>Reports <span id="ownFbN"></span></h2><ul class="own-fb" id="ownFb"></ul>'
            '<p><button type="button" class="own-out" id="ownOut">Lock</button></p></div>'
            '<script>%s</script>' % ADMIN_JS)
    os.makedirs(os.path.join(PUB, 'admin'), exist_ok=True)
    open(os.path.join(PUB, 'admin/index.html'), 'w', encoding='utf-8').write(
        own_page('/admin/', 'Admin · junhots WoW tools', 'Site admin.', body, noindex=True))


def build_404():
    body = ('<div class="ws-hero ws-404"><h1>Page not found</h1><p>That page does not exist (any more). '
            '<a href="/" style="color:var(--accent)">Go to all tools</a>.</p></div>')
    open(os.path.join(PUB, '404.html'), 'w', encoding='utf-8').write(
        own_page('/404', 'Page not found · junhots WoW tools', 'Page not found.', body, noindex=True))


def build_seo(updates):
    paths = ['/'] + [path_of(t['id']) for t in TOOLS] + ['/setup/', '/updates/', '/about/']
    last = updates[0]['date'] if updates else TODAY.isoformat()
    urls = ''.join('<url><loc>%s%s</loc><lastmod>%s</lastmod></url>\n' % (SITE, p, last) for p in paths)
    open(os.path.join(PUB, 'sitemap.xml'), 'w').write(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s</urlset>\n' % urls)
    open(os.path.join(PUB, 'robots.txt'), 'w').write('User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % SITE)
    fav = MARK.replace('var(--accent)', '#e0a54c').replace('var(--on-accent)', '#1c1406').replace(' aria-hidden="true"', ' xmlns="http://www.w3.org/2000/svg"')
    open(os.path.join(PUB, 'favicon.svg'), 'w').write(fav)


def main():
    print('Tools from', SRC)
    os.makedirs(PUB, exist_ok=True)
    shutil.rmtree(os.path.join(PUB, IMG_DIR), ignore_errors=True)   # icons of this build only
    # Old gear-<hash>.bin files stay: a tab or prerendered page from before a deploy still asks for its own file.
    # The name only changes when the item data does, so they don't pile up.
    write_icons()
    os.makedirs(os.path.join(PUB, 'downloads'), exist_ok=True)
    shutil.copyfile(os.path.join(SRC, 'crafted-upgrades/GearSnapshot.zip'), os.path.join(PUB, 'downloads/GearSnapshot.zip'))
    updates = json.load(open(os.path.join(PUB, 'data/updates.json')))
    updates.sort(key=lambda u: u['date'], reverse=True)
    for t in TOOLS:
        build_tool(t)
    build_home(updates)
    build_updates(updates)
    build_about()
    build_setup()
    build_admin()
    build_404()
    build_seo(updates)
    import item_data; item_data.main()   # item hover cards: /data/items.json from the gear page's item data
    print('Done: %s' % PUB)
    check_updates()
    check_vendor_prices()
    check_routes()


def check_updates():
    """Every change visitors will notice gets an entry on /updates/ (Jun, 21 Nov): warn when pages changed but updates.json didn't."""
    import subprocess
    try:
        out = subprocess.run(['git', 'status', '--porcelain', '--', 'public'], cwd=REPO, capture_output=True, text=True).stdout
    except Exception:
        return
    files = [l[3:].strip() for l in out.splitlines()]
    pages = [f for f in files if f.endswith('index.html') and f not in ('public/index.html', 'public/updates/index.html')]
    if pages and 'public/data/updates.json' not in files:
        print('\nNOTE: %d page(s) changed but public/data/updates.json did not. If visitors will notice, add an Updates entry '
              '(date, title, one or two plain sentences, image in public/assets/updates/, link).' % len(pages))


def check_vendor_prices():
    """Every vendor price shown must match the game (scripts/check-vendor-prices.cjs, 23 Nov: Anti-Venom showed 84c, one craft's 3)."""
    import subprocess
    try:
        r = subprocess.run(['node', os.path.join(REPO, 'scripts', 'check-vendor-prices.cjs')], cwd=REPO, capture_output=True, text=True, timeout=600)
    except Exception as e:
        print('\nWARNING: vendor price check did not run (%s). Run: node scripts/check-vendor-prices.cjs' % e)
        return
    print('\n' + (r.stdout + r.stderr).strip())
    if r.returncode:
        sys.exit('Vendor price check FAILED: fix the prices above before opening a pull request.')



def check_routes():
    """Profession leveling never picks a pricier recipe or a short detour (scripts/check-routes.cjs, 25 Nov: one point
    of Jungle Stew between Rockscale Cod and Spider Sausage)."""
    import subprocess
    try:
        r = subprocess.run(['node', os.path.join(REPO, 'scripts', 'check-routes.cjs')], cwd=REPO, capture_output=True, text=True, timeout=600)
    except Exception as e:
        print('\nWARNING: route check did not run (%s). Run: node scripts/check-routes.cjs' % e)
        return
    print('\n' + (r.stdout + r.stderr).strip())
    if r.returncode:
        sys.exit('Route check FAILED: fix the planner before opening a pull request.')

if __name__ == '__main__':
    main()
