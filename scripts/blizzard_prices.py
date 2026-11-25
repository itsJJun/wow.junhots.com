"""Hourly auction prices from Blizzard's Battle.net API for WoW Forever (run by .github/workflows/blizzard-prices.yml).

Reads one auction house (Horde Auction House 113, us: the PvP Horde house, see src/fah.js), sums it up per item and per
random suffix, and sends the summary to the site (POST /api/admin/bliz, Bearer ADMIN_PASSWORD). Pages read it from
/api/bliz through site.js. Prints a short summary, never the keys.

Env: BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET (Battle.net developer client), ADMIN_PASSWORD (the site's admin page).
Args: --out FILE (also write the summary there), --no-post.

Blizzard's data (checked 25 Nov 2026):
  /data/wow/ruleset/1/auctions/113?namespace=dynamic-forever-us  {auctions: [{item: {id, bonus_lists, modifiers,
     context}, buyout (whole auction), quantity, time_left, bid?}], ...}  ~128k auctions
  /data/wow/ruleset/1/auctions/113/commodities                     {auctions: [{item: {id}, unit_price, quantity}]}
  Last-Modified = when Blizzard took the snapshot (hourly). All rulesets list the same houses.
  A random suffix ("of the Channeler") is a bonus list: ItemBonus Type 5 -> ItemNameDescription (scripts/data/
  bonus_suffix.json, from wago.tools db2 build 1.60.1.71091). Bid-only auctions have no buyout and are skipped.

Summary format (text, one line each):
  #<snapshot unix time>,<house>,<items>
  i,<item id>,<cheapest buyout per unit>,<units listed>,<auctions>
  s,<item id>,<suffix without "of ">,<cheapest buyout>,<units listed>
"""
import base64, email.utils, json, os, sys, urllib.parse, urllib.request

HOUSE, RULESET, REGION = 113, 1, 'us'
SITE = 'https://wow.junhots.com/api/admin/bliz'
HERE = os.path.dirname(os.path.abspath(__file__))


def token():
    cid, sec = os.environ.get('BLIZZARD_CLIENT_ID', ''), os.environ.get('BLIZZARD_CLIENT_SECRET', '')
    if not cid or not sec:
        sys.exit('BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET are not set')
    req = urllib.request.Request('https://oauth.battle.net/token', data=b'grant_type=client_credentials',
                                 headers={'Authorization': 'Basic ' + base64.b64encode((cid + ':' + sec).encode()).decode()})
    return json.load(urllib.request.urlopen(req, timeout=30))['access_token']


def get(tok, path):
    url = 'https://%s.api.blizzard.com%s?%s' % (REGION, path, urllib.parse.urlencode({'namespace': 'dynamic-forever-' + REGION, 'locale': 'en_US'}))
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok}), timeout=180)
    lm = r.headers.get('Last-Modified')
    return json.load(r), int(email.utils.parsedate_to_datetime(lm).timestamp()) if lm else 0


def summarize(auctions, commodities, suffix_of):
    items, sfx, unknown = {}, {}, set()

    def add(iid, unit, qty):
        e = items.get(iid)
        if e is None:
            items[iid] = [unit, qty, 1]
        else:
            e[0] = min(e[0], unit); e[1] += qty; e[2] += 1

    for a in auctions:
        it, buy, qty = a.get('item') or {}, a.get('buyout'), a.get('quantity') or 0
        iid = it.get('id')
        if not iid or not buy or qty <= 0:
            continue   # bid-only
        unit = -(-buy // qty)   # whole auction / units, rounded up like the game shows it
        add(iid, unit, qty)
        for b in it.get('bonus_lists') or []:
            name = suffix_of.get(str(b))
            if name:
                k = (iid, name); e = sfx.get(k)
                if e is None: sfx[k] = [unit, qty]
                else: e[0] = min(e[0], unit); e[1] += qty
                break
        else:
            for b in it.get('bonus_lists') or []:
                if str(b) not in suffix_of: unknown.add(b)
    for a in commodities:
        iid, unit, qty = (a.get('item') or {}).get('id'), a.get('unit_price'), a.get('quantity') or 0
        if iid and unit and qty > 0:
            add(iid, unit, qty)
    return items, sfx, unknown


def main():
    args = sys.argv[1:]
    out = args[args.index('--out') + 1] if '--out' in args else None
    suffix_of = json.load(open(os.path.join(HERE, 'data', 'bonus_suffix.json')))
    tok = token()
    house, t1 = get(tok, '/data/wow/ruleset/%d/auctions/%d' % (RULESET, HOUSE))
    comm, t2 = get(tok, '/data/wow/ruleset/%d/auctions/%d/commodities' % (RULESET, HOUSE))
    auctions, commodities = house.get('auctions') or [], comm.get('auctions') or []
    items, sfx, unknown = summarize(auctions, commodities, suffix_of)
    snap = max(t1, t2)
    if len(items) < 1000:
        sys.exit('only %d items: not sending' % len(items))
    lines = ['#%d,%d,%d' % (snap, HOUSE, len(items))]
    lines += ['i,%d,%d,%d,%d' % (i, e[0], e[1], e[2]) for i, e in sorted(items.items())]
    lines += ['s,%d,%s,%d,%d' % (i, n, e[0], e[1]) for (i, n), e in sorted(sfx.items())]
    text = '\n'.join(lines) + '\n'
    print('snapshot', snap, '| auctions', len(auctions), '| commodities', len(commodities), '| items', len(items),
          '| suffix prices', len(sfx), '| bonus lists with no suffix name', len(unknown), '| bytes', len(text))
    if out:
        open(out, 'w').write(text)
    if '--no-post' in args:
        return
    pw = os.environ.get('ADMIN_PASSWORD', '')
    if not pw:
        sys.exit('ADMIN_PASSWORD is not set: not sent to the site')
    req = urllib.request.Request(SITE, data=text.encode(), method='POST',
                                 headers={'Authorization': 'Bearer ' + pw, 'Content-Type': 'text/plain; charset=utf-8',
                                          'User-Agent': 'wow.junhots.com price job'})
    print('site:', urllib.request.urlopen(req, timeout=60).read().decode()[:200])


if __name__ == '__main__':
    main()
