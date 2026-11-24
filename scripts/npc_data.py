#!/usr/bin/env python3
"""NPC hover cards: build public/data/npcs.json and the small zone maps in public/assets/npc/map/.

  python3 scripts/npc_data.py <qdb.json> [work dir]

<qdb.json> = QuestieDB_Forever.toc decoded by the Level route's qdb.py (/mnt/project-files/level-route/qdb.py).
Run again after a QuestieDB update. Sources (credited on /about/):
  - where NPCs stand, their title and faction: QuestieDB (Forever), every NPC friendly to Horde or Alliance;
  - which model an NPC uses (for Blizzard's own render picture): AzerothCore creature_template_model (AGPL-3.0),
    kept only where AzerothCore's NPC name is the same as Questie's (Forever-only NPCs have none, so no picture);
  - zone and town names, town outlines: the game's AreaTable + WorldMapOverlay (wago.tools, Forever build);
  - zone maps: the Level route's map images (Blizzard map art), shrunk.

npcs.json: {"z": {area: [name, uiMap or 0, Dungeons page slug if it is a dungeon there]}, "t": {area: name},
            "n": {id: [name, title, "A"/"H"/"AH"/"" , [[area, x, y (-1 inside dungeons), town area or 0], ...], display or 0]}, "k": {name: id}}
"k" holds names that belong to one NPC only, so a page can link by name.
"""
import csv, io, json, os, re, subprocess, sys, concurrent.futures as cf
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = '1.60.1.71037'   # Forever build on wago.tools
QDB = sys.argv[1]
W = sys.argv[2] if len(sys.argv) > 2 else '/home/user/work/npc'
LR = os.environ.get('LR_DATA', '/mnt/project-files/level-route/data')   # Level route data (travel.json, maps/)
OUT_MAP = os.path.join(REPO, 'public/assets/npc/map')
os.makedirs(W, exist_ok=True)
os.makedirs(OUT_MAP, exist_ok=True)


def fetch(url, path):
    if not os.path.exists(path) or os.path.getsize(path) < 200:
        subprocess.run(['curl', '-s', '-m', '300', '-o', path, url], check=True)
    return path


for t in ['AreaTable', 'WorldMapOverlay', 'WorldMapOverlayTile', 'UiMapXMapArt']:
    fetch('https://wago.tools/db2/%s/csv?build=%s' % (t, B), os.path.join(W, t + '.csv'))
AC = 'https://raw.githubusercontent.com/azerothcore/azerothcore-wotlk/master/data/sql/base/db_world/'
fetch(AC + 'creature_template_model.sql', os.path.join(W, 'ac_ctm.sql'))
fetch(AC + 'creature_template.sql', os.path.join(W, 'ac_ct.sql'))
rows = lambda t: list(csv.DictReader(open(os.path.join(W, t + '.csv'), encoding='utf-8')))

AREA = {int(r['ID']): r['AreaName_lang'] for r in rows('AreaTable')}
T = json.load(open(os.path.join(LR, 'travel.json')))
A2U = {}
for z in T['zones']: A2U.setdefault(z[7], z[0])
DUNS = {d['n']: d['s'] for d in json.load(open(os.path.join(REPO, 'public/dungeons/data/dungeons.json')))['d']}   # name -> /dungeons/#slug
HAVE_MAP = {int(f[:-5]) for f in os.listdir(os.path.join(LR, 'maps')) if f.endswith('.webp')}

# ---- model (display) ids: AzerothCore, only where the NPC's name matches ----
unq = lambda s: s.replace("\\'", "'").replace('\\"', '"')
DISP = {}
for m in re.finditer(r"\((\d+),0,(\d+),", open(os.path.join(W, 'ac_ctm.sql'), encoding='utf-8').read()):
    DISP[int(m[1])] = int(m[2])
ACNAME = {int(m[1]): unq(m[2]) for m in re.finditer(r"\((\d+),\d+,\d+,\d+,\d+,\d+,'((?:[^'\\]|\\.)*)'", open(os.path.join(W, 'ac_ct.sql'), encoding='utf-8').read())}


def asmap(x):   # Lua table saved as an array (keys 1..n) -> dict
    if x is None: return {}
    if isinstance(x, dict): return x
    return {str(i + 1): v for i, v in enumerate(x) if v is not None}


# ---- towns: the map's explored-area overlays. A spot is in a town when it is inside that overlay's hover area
# (the part of the map that shows the town's name in game) and the overlay is drawn there ----
ART = {int(r['UiMapID']): int(r['UiMapArtID']) for r in rows('UiMapXMapArt')}
OV = {}
for r in rows('WorldMapOverlay'):
    OV.setdefault(int(r['UiMapArtID']), []).append(r)
OVT = {}
for r in rows('WorldMapOverlayTile'):
    if r['LayerIndex'] == '0': OVT.setdefault(int(r['WorldMapOverlayID']), []).append(r)
os.makedirs(os.path.join(W, 'blp'), exist_ok=True)
need = {int(t['FileDataID']) for u in A2U.values() for o in OV.get(ART.get(u), []) for t in OVT.get(int(o['ID']), [])}


def get_tile(f):
    p = os.path.join(W, 'blp/%d.blp' % f)
    for _ in range(5):
        if os.path.exists(p) and os.path.getsize(p) > 200: return 0
        subprocess.run(['curl', '-s', '-m', '60', '-o', p, 'https://wago.tools/api/casc/%d?version=%s' % (f, B)])
    return f


with cf.ThreadPoolExecutor(6) as ex: bad = [x for x in ex.map(get_tile, sorted(need)) if x]
if bad: sys.exit('failed overlay tiles: %s' % bad)
MASK = {}   # uiMap -> [(area, x0, y0, alpha image)], smallest first


def masks(u):
    if u in MASK: return MASK[u]
    out = []
    for o in OV.get(ART.get(u), []):
        a = int(o['AreaID_0'])
        if not a: continue
        w, h = int(o['TextureWidth']), int(o['TextureHeight'])
        im = Image.new('L', (w, h))
        for t in OVT.get(int(o['ID']), []):
            im.paste(Image.open(os.path.join(W, 'blp/%s.blp' % t['FileDataID'])).convert('RGBA').getchannel('A'),
                     (int(t['ColIndex']) * 256, int(t['RowIndex']) * 256))
        hit = [int(o[k]) for k in ('HitRectLeft', 'HitRectTop', 'HitRectRight', 'HitRectBottom')]
        if not any(hit): continue   # no hit area: the game never names this overlay on hover (Silithus' one covers Cenarion Hold)
        out.append((w * h, a, int(o['OffsetX']), int(o['OffsetY']), im, hit))
    MASK[u] = sorted(out, key=lambda m: m[0])
    return MASK[u]


def town(area, x, y):
    u = A2U.get(area)
    if not u: return 0
    px, py = x / 100 * 1002, y / 100 * 668
    for _, a, ox, oy, im, (l, t, r, b) in masks(u):
        ix, iy = int(px - ox), int(py - oy)
        if l <= px <= r and t <= py <= b and 0 <= ix < im.width and 0 <= iy < im.height and im.getpixel((ix, iy)) > 128 and a != area: return a
    return 0


# ---- NPCs ----
Q = json.load(open(QDB))['Npc']
N, Z, TW, names = {}, {}, {}, {}
for i, r in Q.items():
    fac = r.get('13') or ''
    # friendly to a faction, or one you deal with (vendor, trainer, quest giver: e.g. reputation quartermasters)
    if fac not in ('A', 'H', 'AH') and not (r.get('15') or r.get('10') or r.get('11')): continue
    sp = []
    for z, pts in asmap(r.get('7')).items():
        z = int(z)
        if not AREA.get(z): continue
        pts = [p for p in (pts or []) if isinstance(p, list) and len(p) >= 2 and p[0] is not None]
        ok = [p for p in pts if p[0] >= 0]
        if ok:   # first spot per zone, up to 3 zones (patrols and many-spawn NPCs keep their first spot)
            x, y = round(ok[0][0], 1), round(ok[0][1], 1)
            sp.append([z, x, y, town(z, x, y)])
        elif pts: sp.append([z, -1, -1, 0])   # inside a dungeon: Questie has no map spot
    if not sp: continue
    sp = sp[:3]
    for s in sp:
        Z[s[0]] = [AREA[s[0]], A2U.get(s[0], 0) if A2U.get(s[0], 0) in HAVE_MAP else 0] + ([DUNS[AREA[s[0]]]] if AREA[s[0]] in DUNS else [])
        if s[3]: TW[s[3]] = AREA.get(s[3], '')
    d = DISP.get(int(i), 0) if ACNAME.get(int(i)) == r['1'] else 0
    N[int(i)] = [r['1'], r.get('14') or '', fac, sp, d]
    names.setdefault(r['1'], []).append(int(i))
K = {n: ids[0] for n, ids in names.items() if len(ids) == 1}
out = {'z': {str(k): v for k, v in sorted(Z.items())}, 't': {str(k): v for k, v in sorted(TW.items())},
       'n': {str(k): v for k, v in sorted(N.items())}, 'k': dict(sorted(K.items()))}
p = os.path.join(REPO, 'public/data/npcs.json')
json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('%d NPCs (%d with a picture, %d in a town), %d zones, %d KB -> %s' % (
    len(N), sum(1 for v in N.values() if v[4]), sum(1 for v in N.values() if v[3][0][3]), len(Z), os.path.getsize(p) // 1024, p))

# ---- small zone maps for the card (from the Level route's 1002x668 maps) ----
for u in sorted({v[1] for v in Z.values() if v[1]}):
    dst = os.path.join(OUT_MAP, '%d.webp' % u)
    if os.path.exists(dst): continue
    Image.open(os.path.join(LR, 'maps/%d.webp' % u)).convert('RGB').resize((501, 334), Image.LANCZOS).save(dst, 'WEBP', quality=70, method=6)
print('maps ->', OUT_MAP)
