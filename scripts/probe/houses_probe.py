"""One-off: size and fingerprint of every Forever auction house per ruleset (US + EU). Writes houses.json. Never prints keys."""
import base64, hashlib, json, os, urllib.error, urllib.parse, urllib.request
cid, sec = os.environ['BLIZZARD_CLIENT_ID'], os.environ['BLIZZARD_CLIENT_SECRET']
TOK = json.load(urllib.request.urlopen(urllib.request.Request('https://oauth.battle.net/token', data=b'grant_type=client_credentials',
      headers={'Authorization': 'Basic ' + base64.b64encode((cid + ':' + sec).encode()).decode()}), timeout=30))['access_token']
def get(region, path):
    url = 'https://%s.api.blizzard.com%s?%s' % (region, path, urllib.parse.urlencode({'namespace': 'dynamic-forever-' + region, 'locale': 'en_US'}))
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOK}), timeout=180)
        return json.load(r), r.headers.get('Last-Modified')
    except urllib.error.HTTPError as e:
        return {'error': e.code}, None
OUT = {}
for region in ['us', 'eu']:
    rs, _ = get(region, '/data/wow/ruleset/index')
    for r in rs.get('rulesets', []):
        rid = r['id']; info, _ = get(region, '/data/wow/ruleset/%d' % rid)
        lst, _ = get(region, '/data/wow/ruleset/%d/auctions/' % rid)
        for h in lst.get('auctions', []):
            hid = h['id']; d, lm = get(region, '/data/wow/ruleset/%d/auctions/%d' % (rid, hid))
            a = d.get('auctions') or []
            c, lm2 = get(region, '/data/wow/ruleset/%d/auctions/%d/commodities' % (rid, hid))
            ca = c.get('auctions') or []
            ids = sorted(x['id'] for x in a)
            key = '%s r%d(%s) h%d %s' % (region, rid, info.get('name'), hid, h['name'])
            OUT[key] = {'auctions': len(a), 'commodities': len(ca), 'items': len({x['item']['id'] for x in a} | {x['item']['id'] for x in ca}),
                        'minid': ids[0] if ids else 0, 'maxid': ids[-1] if ids else 0,
                        'fp': hashlib.md5(json.dumps(ids[:500]).encode()).hexdigest()[:8], 'lm': lm, 'lm2': lm2,
                        'linen': min([-(-x['buyout'] // x['quantity']) for x in a if x['item']['id'] == 2589 and x.get('buyout')] +
                                     [x['unit_price'] for x in ca if x['item']['id'] == 2589] or [0]),
                        'keys': sorted(d.keys())}
            print(key, OUT[key]['auctions'], OUT[key]['commodities'], OUT[key]['fp'], flush=True)
json.dump(OUT, open('houses.json', 'w'), indent=1)
