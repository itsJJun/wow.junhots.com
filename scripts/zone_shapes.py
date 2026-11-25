#!/usr/bin/env python3
"""Real zone outlines on the continent maps (25 Nov, Jun: the world map's boxes looked messy, use the real borders).

The game lights a zone up when you point at it on the continent map: each zone's UiMapArt has a HighlightFileDataID,
a soft 128x128 glow of the zone's shape. Drawn over the zone's map rectangle on the continent (as wide as the rectangle,
square, from its top left corner) it fills the zone's land exactly. This script traces each glow into an SVG path in
continent pixels (1002 x 668, the Level route's maps/1415.webp and 1414.webp) and finds a label spot inside the shape.

Out: public/level-route/data/maps/zones.json = { "<uiMap>": [path, labelX, labelY] }
Needs: pip install opencv-python-headless pillow numpy. Game files: wago.tools (Forever build).
Run: python3 scripts/zone_shapes.py [work dir]
"""
import csv, json, os, subprocess, sys
import numpy as np
import cv2
from PIL import Image

B = '1.60.1.71037'   # Forever build on wago.tools
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = sys.argv[1] if len(sys.argv) > 1 else '/tmp/zone-shapes'
os.makedirs(os.path.join(W, 'hl'), exist_ok=True)
CONT = {0: [-16000, 7466.6, -19199.9, 16000], 1: [-11733.3, 12799.9, -19733.2, 17066.6]}   # same as the route's WMAP
UP = 6   # trace at 6x the continent's pixels, then scale the path down


def fetch(url, path):
    if not os.path.exists(path) or os.path.getsize(path) < 100:
        subprocess.run(['curl', '-s', '-m', '120', '-o', path, url], check=True)
    return path


for t in ['UiMapXMapArt', 'UiMapArt']:
    fetch('https://wago.tools/db2/%s/csv?build=%s' % (t, B), os.path.join(W, t + '.csv'))
rows = lambda t: list(csv.DictReader(open(os.path.join(W, t + '.csv'), encoding='utf-8')))
ART = {int(r['UiMapID']): int(r['UiMapArtID']) for r in rows('UiMapXMapArt')}
HL = {int(r['ID']): int(r['HighlightFileDataID']) for r in rows('UiMapArt')}
T = json.load(open(os.path.join(REPO, 'public/level-route/data/travel.json')))

out = {}
for z in T['zones']:   # [uiMap, map, x0, x1, y0, y1, name, area, minLv, maxLv]
    um, mp = z[0], z[1]
    f = HL.get(ART.get(um), 0)
    if mp not in CONT or not f:
        continue
    b = CONT[mp]
    uv = lambda x, y: (1002 * (b[3] - y) / (b[3] - b[2]), 668 * (b[1] - x) / (b[1] - b[0]))
    x0, y0 = uv(z[3], z[5])
    x1, _ = uv(z[2], z[4])
    w = x1 - x0
    S = max(8, round(w * UP))
    g = Image.open(fetch('https://wago.tools/api/casc/%d?version=%s' % (f, B), os.path.join(W, 'hl/%d.blp' % f))).convert('L')
    a = np.asarray(g.resize((S, S), Image.BICUBIC), dtype=np.float32)
    m = (a >= a.max() * 0.13).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cs = [c for c in cs if cv2.contourArea(c) > S * S * 0.002]
    if not cs:
        continue
    parts = []
    for c in cs:
        c = cv2.approxPolyDP(c, UP * 0.6, True)
        pts = [(x0 + p[0][0] / UP, y0 + p[0][1] / UP) for p in c]
        parts.append('M' + 'L'.join('%.1f %.1f' % p for p in pts) + 'Z')
    # label spot: the point deepest inside the biggest piece (distance transform), not the box centre
    big = max(cs, key=cv2.contourArea)
    mm = np.zeros_like(m)
    cv2.drawContours(mm, [big], -1, 1, -1)
    d = cv2.distanceTransform(mm, cv2.DIST_L2, 5)
    yy, xx = np.unravel_index(np.argmax(d), d.shape)
    out[str(um)] = [''.join(parts), round(x0 + xx / UP, 1), round(y0 + yy / UP, 1)]

p = os.path.join(REPO, 'public/level-route/data/maps/zones.json')
json.dump(out, open(p, 'w'), separators=(',', ':'))
print('zones.json: %d zones, %d KB' % (len(out), os.path.getsize(p) // 1024))
