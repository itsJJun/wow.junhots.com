"""Hourly auction data from Blizzard's Battle.net API for WoW Forever (run by .github/workflows/blizzard-prices.yml).

For every auction house with listings in each region (US, EU) it builds:
  - prices: cheapest buyout per unit, units listed, auctions, price per random suffix, and the cheapest listings in
    order (to price buying many), one gzip section per house,
  - history: 14 days per item (lowest price, usual price, most units listed, units sold), one gzip section per house,
  - fp: the cheapest price of a few hundred common items in every house, so a page can tell which house a
    visitor's own scan came from.
It sends them to the site (POST /api/admin/bliz?r=<region>&k=p|h, Bearer ADMIN_PASSWORD); pages read one house at a
time from /api/bliz?h=us-113 and /api/blizh?h=us-113 (src/index.js). Prints a short summary, never the keys.

Env: BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET (Battle.net developer client), ADMIN_PASSWORD (the site's admin page).
Args: --region us|eu (default both), --state DIR (kept between runs by the workflow's cache; default .bliz-state),
      --out DIR (also write the bundles there), --no-post.

Blizzard's data (checked 25 Nov 2026):
  /data/wow/ruleset/1/auctions/?namespace=dynamic-forever-us       the houses (110-125: Alliance, Horde, Blackwater =
     neutral). The ruleset (1 PvP, 2 Normal, 3 Roleplay, 15 Roleplay PvP) does not change the data: every ruleset
     returns the same listings. Houses 112, 115, 118 are empty. US 113 = the big Horde house (checked against an
     in-game scan); which group the others belong to is not known yet.
  /data/wow/ruleset/1/auctions/<house>     {auctions: [{id, item: {id, bonus_lists, modifiers, context}, buyout (whole
     auction), quantity, time_left, bid?}]}       ~125k auctions in a big house
  /data/wow/ruleset/1/auctions/<house>/commodities   {auctions: [{id, item: {id}, unit_price, quantity, time_left}]}
  Last-Modified = when Blizzard took the snapshot (hourly, about :22 EU and :26 US). A house whose snapshot stops
  changing is down (servers offline or in maintenance): the site shows that from the per-house snapshot times.
  /data/wow/item/2589?namespace=static-forever-us   its self link names the static namespace: patch and build. When
  they change, the job opens a GitHub issue to rebuild the item data.
  A random suffix ("of the Channeler") is a bonus list: ItemBonus Type 5 -> ItemNameDescription (scripts/data/
  bonus_suffix.json, from wago.tools db2 build 1.60.1.71091). Bid-only auctions have no buyout and are skipped.

Sold: a listing that is gone an hour later while it still had 2+ hours left (LONG or VERY_LONG) was bought or taken
down by its seller; a commodity listing that shrank sold the difference. Buyers take the cheapest first (a bulk buy
clears the cheapest price, then the next), so a gone listing counts as sold only when no listing of that item that
was cheaper an hour ago is still up. One that went while cheaper ones stayed was taken down (sellers cancel to
undercut and list again); it is not counted. Nor is one whose same stack size shows up again, new, at or under
its price in the same hour (a seller undercut within the hour who listed again). Before 27 Nov 2026 every taken-down listing counted as sold, many times
too high on busy items, so those counts were cleared (SOLD_RULE). Checked on 4 hours of US 113 the same day: this
cut the count a lot on undercut items (Small Radiant Shard 8x, Soul Dust 5x) but it still ran a median 4-6x TSM's
region sold per day, so pages keep using TSM (site.js OWN_SALES) until the average over all houses matches TSM.
An hour is only compared with the hour just before it.

Prices section (text, one line each):
  #<snapshot unix time>,<house>,<items>
  i,<item id>,<cheapest buyout per unit>,<units listed>,<auctions>
  s,<item id>,<suffix without "of ">,<cheapest buyout>,<units listed>
  l,<item id>,<price>x<units>,<price>x<units>...   the cheapest listings in order (up to 500 units or 15 prices),
                                                  only for items with more than one price
History section:
  #<snapshot unix time>,<house>,<items>
  h,<item id>,<day>:<lowest>:<usual>:<most listed>:<sold>:<ran out>;...   day = days since 1 Jan 2020 (UTC), like
          Auctionator; the last day is today so far. usual = median of the day's hourly lowest prices; sold = units
          sold that day; ran out = units whose listing ended with under 2 hours left (most expired; a few were bought
          in their last hour). Sold and ran out are empty when not known.
Fingerprint section ("fp"):
  #<snapshot unix time>,fp,<items>
  ids,<item id>,<item id>...
  f,<house>,<price>,<price>...      0 = not listed there
Bundle (what is posted): one JSON line {"v":1,"region":"us","k":"p","asOf":...,"patch":["1.60.1",70399],
  "h":{"113":[start,end,items,"H",house snapshot time],...}}
  then the gzip sections back to back; start/end are byte offsets in the whole body.
"""
import base64, email.utils, gzip, json, os, pickle, re, statistics, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

RULESET = 1
SITE = 'https://wow.junhots.com/api/admin/bliz'
HERE = os.path.dirname(os.path.abspath(__file__))
DAYS = 14
SOLD_RULE = 2   # 2 = cancelled listings no longer count (27 Nov 2026); older sold counts are cleared once
TL = {'SHORT': 0, 'MEDIUM': 1, 'LONG': 2, 'VERY_LONG': 3}
FACTION = {'Alliance': 'A', 'Horde': 'H', 'Blackwater': 'N'}


def day_of(t):
    return (t - 1577836800) // 86400


def token():
    cid, sec = os.environ.get('BLIZZARD_CLIENT_ID', ''), os.environ.get('BLIZZARD_CLIENT_SECRET', '')
    if not cid or not sec:
        sys.exit('BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET are not set')
    req = urllib.request.Request('https://oauth.battle.net/token', data=b'grant_type=client_credentials',
                                 headers={'Authorization': 'Basic ' + base64.b64encode((cid + ':' + sec).encode()).decode()})
    return json.load(urllib.request.urlopen(req, timeout=30))['access_token']


def get(tok, region, path, tries=3, ns='dynamic'):
    url = 'https://%s.api.blizzard.com%s?%s' % (region, path, urllib.parse.urlencode({'namespace': ns + '-forever-' + region, 'locale': 'en_US'}))
    for n in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok}), timeout=180)
            lm = r.headers.get('Last-Modified')
            return json.load(r), int(email.utils.parsedate_to_datetime(lm).timestamp()) if lm else 0
        except Exception as e:
            if n == tries - 1:
                raise
            time.sleep(5 * (n + 1))


def patch_of(tok, region):
    """the game's patch and build from the static data's namespace ("static-1.60.1_70399-forever-us"), or None"""
    try:
        d, _ = get(tok, region, '/data/wow/item/2589', ns='static')
        m = re.search(r'static-([\d.]+)_(\d+)-forever', d['_links']['self']['href'])
        return [m.group(1), int(m.group(2))] if m else None
    except Exception as e:
        print(region, 'patch check failed:', str(e)[:120]); return None


def patch_issue(region, old, new):
    """open a GitHub issue when Forever patches, so the item data gets rebuilt (needs GITHUB_TOKEN, issues: write)"""
    tok, repo = os.environ.get('GITHUB_TOKEN', ''), os.environ.get('GITHUB_REPOSITORY', '')
    if not tok or not repo:
        return
    body = {'title': 'Forever patched: %s (build %d)' % tuple(new),
            'body': 'Blizzard\'s API for %s moved from patch %s (build %d) to %s (build %d). Rebuild the item, vendor price and '
                    'recipe data (wago.tools / Blizzard API) and check the pages, then add an Updates entry.' % (region.upper(), old[0], old[1], new[0], new[1])}
    req = urllib.request.Request('https://api.github.com/repos/%s/issues' % repo, data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json', 'User-Agent': 'wow.junhots.com price job'})
    try:
        print(region, 'patch issue', json.load(urllib.request.urlopen(req, timeout=30)).get('html_url'))
    except Exception as e:
        print(region, 'patch issue failed:', str(e)[:120])


def listings(auctions, commodities):
    """-> {auction id: (item, units, unit price, time left code, suffix bonus lists)} for listings with a buyout"""
    out = {}
    for a in auctions:
        it, buy, qty = a.get('item') or {}, a.get('buyout'), a.get('quantity') or 0
        if not it.get('id') or not buy or qty <= 0:
            continue   # bid-only
        out[a['id']] = (it['id'], qty, -(-buy // qty), TL.get(a.get('time_left'), 3), tuple(it.get('bonus_lists') or ()))
    for a in commodities:
        it, unit, qty = a.get('item') or {}, a.get('unit_price'), a.get('quantity') or 0
        if it.get('id') and unit and qty > 0:
            out[a['id']] = (it['id'], qty, unit, TL.get(a.get('time_left'), 3), ())
    return out


def prices_text(snap, house, cur, suffix_of):
    items, sfx, ladder = {}, {}, {}
    for iid, qty, unit, tl, bl in cur.values():
        e = items.get(iid)
        if e is None: items[iid] = [unit, qty, 1]
        else: e[0] = min(e[0], unit); e[1] += qty; e[2] += 1
        lad = ladder.setdefault(iid, {}); lad[unit] = lad.get(unit, 0) + qty
        for b in bl:
            name = suffix_of.get(str(b))
            if name:
                k = (iid, name); s = sfx.get(k)
                if s is None: sfx[k] = [unit, qty]
                else: s[0] = min(s[0], unit); s[1] += qty
                break
    lines = ['#%d,%d,%d' % (snap, house, len(items))]
    lines += ['i,%d,%d,%d,%d' % (i, e[0], e[1], e[2]) for i, e in sorted(items.items())]
    lines += ['s,%d,%s,%d,%d' % (i, n, e[0], e[1]) for (i, n), e in sorted(sfx.items())]
    for i in sorted(ladder):
        steps = sorted(ladder[i].items())
        if len(steps) < 2:
            continue
        out, got = [], 0
        for p, q in steps:
            out.append('%dx%d' % (p, q)); got += q
            if got >= 500 or len(out) >= 15:
                break
        lines.append('l,%d,%s' % (i, ','.join(out)))
    return '\n'.join(lines) + '\n', items


def sold_units(prev, cur):
    """units sold and units that ran out (expired) per item between two hourly snapshots of one house"""
    sold, gone, kept, fresh = {}, {}, {}, {}
    for aid, p in prev.items():   # the cheapest of last hour's listings that are still up, per item
        if aid in cur and (p[0] not in kept or p[2] < kept[p[0]]):
            kept[p[0]] = p[2]
    for aid, c in cur.items():    # new listings this hour, by item and stack size
        if aid not in prev:
            fresh.setdefault((c[0], c[1]), []).append(c[2])
    for aid, p in prev.items():
        c = cur.get(aid)
        if c is None:
            if p[3] >= 2:   # still had 2+ hours left: bought, unless a cheaper one stayed (then it was taken down)
                if p[0] not in kept or p[2] <= kept[p[0]]:
                    again = fresh.get((p[0], p[1]))
                    if again and min(again) <= p[2]:   # the same stack listed again at or under its price: a repost
                        again.remove(min(again))
                        continue
                    sold[p[0]] = sold.get(p[0], 0) + p[1]
            else:           # under 2 hours left: most of these ran out
                gone[p[0]] = gone.get(p[0], 0) + p[1]
        elif c[1] < p[1]:   # a commodity listing that shrank
            sold[p[0]] = sold.get(p[0], 0) + p[1] - c[1]
    return sold, gone


def update_history(hist, today, items, sold):
    """hist: {item: {day: [lowest, usual, most listed, sold or None, [hourly lowest...] (today only), ran out or None]}}"""
    for iid, e in items.items():
        d = hist.setdefault(iid, {}).get(today)
        if d is None:
            d = hist[iid][today] = [None, None, 0, None, [], None]
        d[4].append(e[0])
        d[0] = e[0] if d[0] is None else min(d[0], e[0]); d[2] = max(d[2], e[1])
        d[1] = int(statistics.median(d[4]))
    if sold is not None:
        sold, gone = sold
        for iid in set(items) | set(sold) | set(gone):
            d = hist.setdefault(iid, {}).get(today)
            if d is None:   # sold out this hour
                d = hist[iid][today] = [None, None, 0, None, [], None]
            while len(d) < 6: d.append(None)
            d[3] = (d[3] or 0) + sold.get(iid, 0); d[5] = (d[5] or 0) + gone.get(iid, 0)
    for iid in list(hist):
        h = hist[iid]
        for day in list(h):
            if day <= today - DAYS: del h[day]
            elif day < today and h[day][4]: h[day][4] = []   # a finished day keeps only its numbers
        if not h: del hist[iid]


def history_text(snap, house, hist):
    lines = ['#%d,%d,%d' % (snap, house, len(hist))]
    for iid in sorted(hist):
        days = hist[iid]
        e = lambda v: '' if v is None else str(v)
        lines.append('h,%d,%s' % (iid, ';'.join('%d:%s:%s:%d:%s:%s' % (d, e(x[0]), e(x[1]), x[2], e(x[3]), e(x[5] if len(x) > 5 else None))
                                                   for d, x in sorted(days.items()))))
    return '\n'.join(lines) + '\n'


def fingerprint(snap, per_house):
    """the cheapest price of up to 300 items listed in the most houses, most units first"""
    count, units = {}, {}
    for items in per_house.values():
        for i, e in items.items():
            count[i] = count.get(i, 0) + 1; units[i] = units.get(i, 0) + e[1]
    ids = sorted(count, key=lambda i: (-count[i], -units[i]))[:300]
    lines = ['#%d,fp,%d' % (snap, len(ids)), 'ids,' + ','.join(map(str, ids))]
    for h, items in sorted(per_house.items()):
        lines.append('f,%d,%s' % (h, ','.join(str(items[i][0]) if i in items else '0' for i in ids)))
    return '\n'.join(lines) + '\n'


def bundle(region, kind, snap, sections, meta, extra=None):
    """sections: [(key, text)] -> bytes: a JSON line with byte offsets, then gzip sections"""
    blobs = [(k, gzip.compress(t.encode(), 9, mtime=0)) for k, t in sections]
    head = dict({'v': 1, 'region': region, 'k': kind, 'asOf': snap, 'h': {}}, **(extra or {}))
    # offsets depend on the header's length: pad it to a fixed size so they can be filled in after
    pad = 900
    pos = pad
    for k, b in blobs:
        head['h'][str(k)] = [pos, pos + len(b)] + meta.get(k, []); pos += len(b)
    line = json.dumps(head, separators=(',', ':'))
    if len(line) >= pad:
        sys.exit('bundle header too long (%d)' % len(line))
    return (line + ' ' * (pad - 1 - len(line)) + '\n').encode() + b''.join(b for _, b in blobs)


def post(region, kind, body):
    pw = os.environ.get('ADMIN_PASSWORD', '')
    if not pw:
        sys.exit('ADMIN_PASSWORD is not set: not sent to the site')
    req = urllib.request.Request('%s?r=%s&k=%s' % (SITE, region, kind), data=body, method='POST',
                                 headers={'Authorization': 'Bearer ' + pw, 'Content-Type': 'application/octet-stream',
                                          'User-Agent': 'wow.junhots.com price job'})
    for n in range(3):
        try:
            print('site', region, kind, urllib.request.urlopen(req, timeout=120).read().decode()[:200]); return
        except Exception as e:
            print('site', region, kind, 'failed:', str(e)[:200])
            time.sleep(10)
    sys.exit('could not send %s %s to the site' % (region, kind))


def run_region(tok, region, state_dir, out_dir, send, suffix_of):
    path = os.path.join(state_dir, region + '.pkl.gz')
    try:
        state = pickle.loads(gzip.decompress(open(path, 'rb').read()))
    except Exception:
        state = {'asOf': 0, 'prev': {}, 'hist': {}}
    if state.get('soldRule') != SOLD_RULE:   # counts made the old way are cleared once
        for hist in state['hist'].values():
            for days in hist.values():
                for d in days.values():
                    d[3] = None
                    if len(d) > 5: d[5] = None
        state['soldRule'] = SOLD_RULE
    idx, _ = get(tok, region, '/data/wow/ruleset/%d/auctions/' % RULESET)
    houses = [(h['id'], FACTION.get(h['name'].split(' ')[0], '?')) for h in idx.get('auctions') or []]

    def fetch(h):
        a, t1 = get(tok, region, '/data/wow/ruleset/%d/auctions/%d' % (RULESET, h))
        c, t2 = get(tok, region, '/data/wow/ruleset/%d/auctions/%d/commodities' % (RULESET, h))
        return h, max(t1, t2), listings(a.get('auctions') or [], c.get('auctions') or [])

    with ThreadPoolExecutor(4) as ex:
        got = [x for x in ex.map(fetch, [h for h, _ in houses]) if x[2]]
    if not got:
        sys.exit('%s: no listings' % region)
    snap = max(t for _, t, _ in got)
    if snap <= state['asOf']:
        print(region, 'no new snapshot since', state['asOf']); return
    gap = snap - state['asOf']
    compare = 2700 <= gap <= 5400   # only the hour just before
    today = day_of(snap)
    fac = dict(houses)
    p_secs, h_secs, meta, per_house = [], [], {}, {}
    for h, t, cur in sorted(got):
        text, items = prices_text(snap, h, cur, suffix_of)
        prev = state['prev'].get(h)
        sold = sold_units(prev, cur) if compare and prev else None
        update_history(state['hist'].setdefault(h, {}), today, items, sold)
        p_secs.append((h, text)); h_secs.append((h, history_text(snap, h, state['hist'][h])))
        meta[h] = [len(items), fac.get(h, '?'), t]; per_house[h] = items
        state['prev'][h] = {aid: x[:4] for aid, x in cur.items()}
        print(region, h, fac.get(h), '| listings', len(cur), '| items', len(items), '| sold, ran out',
              'not compared' if sold is None else (sum(sold[0].values()), sum(sold[1].values())))
    p_secs.append(('fp', fingerprint(snap, per_house)))
    patch = patch_of(tok, region)
    if patch and state.get('patch') and state['patch'] != patch and send:
        patch_issue(region, state['patch'], patch)
    if patch:
        state['patch'] = patch
    extra = {'patch': patch} if patch else {}
    pb, hb = bundle(region, 'p', snap, p_secs, meta, extra), bundle(region, 'h', snap, h_secs, meta, extra)
    print(region, 'snapshot', snap, '| gap', gap, '| prices', len(pb), 'bytes | history', len(hb), 'bytes')
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        open(os.path.join(out_dir, region + '-p.bin'), 'wb').write(pb)
        open(os.path.join(out_dir, region + '-h.bin'), 'wb').write(hb)
    if send:
        post(region, 'p', pb); post(region, 'h', hb)
    state['asOf'] = snap
    os.makedirs(state_dir, exist_ok=True)
    open(path + '.tmp', 'wb').write(gzip.compress(pickle.dumps(state, 4), 3))
    os.replace(path + '.tmp', path)


def main():
    args = sys.argv[1:]
    opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d
    regions = [opt('--region')] if opt('--region') else ['us', 'eu']
    suffix_of = json.load(open(os.path.join(HERE, 'data', 'bonus_suffix.json')))
    tok = token()
    for r in regions:
        run_region(tok, r, opt('--state', '.bliz-state'), opt('--out'), '--no-post' not in args, suffix_of)


if __name__ == '__main__':
    main()
