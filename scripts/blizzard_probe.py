"""One-time probe of Blizzard's Battle.net API for WoW Forever auctions (prints a summary, never the keys).

Env: BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET. Run by .github/workflows/blizzard-probe.yml.
"""
import base64, collections, json, os, sys, urllib.parse, urllib.request

ID, SECRET = os.environ.get('BLIZZARD_CLIENT_ID', ''), os.environ.get('BLIZZARD_CLIENT_SECRET', '')
if not ID or not SECRET:
    sys.exit('BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET are not set as Actions secrets')
req = urllib.request.Request('https://oauth.battle.net/token', data=b'grant_type=client_credentials',
                             headers={'Authorization': 'Basic ' + base64.b64encode((ID + ':' + SECRET).encode()).decode()})
TOKEN = json.load(urllib.request.urlopen(req, timeout=30))['access_token']
print('token ok')

def get(path, ns='dynamic-forever-us'):
    url = 'https://us.api.blizzard.com' + path + '?' + urllib.parse.urlencode({'namespace': ns, 'locale': 'en_US'})
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOKEN}), timeout=120)
    return json.load(r), r.headers

for path in ['/data/wow/ruleset/index', '/data/wow/ruleset/1/auctions/']:
    try:
        d, h = get(path)
        print(path, '->', json.dumps(d)[:800])
    except Exception as e:
        print(path, 'FAILED', e)

d, h = get('/data/wow/ruleset/1/auctions/113')
print('house 113 keys', list(d.keys()), 'last-modified', h.get('Last-Modified'))
auc = d.get('auctions') or []
print('auctions', len(auc))
itemkeys = collections.Counter(k for a in auc for k in (a.get('item') or {}).keys())
print('item fields', dict(itemkeys))
topkeys = collections.Counter(k for a in auc for k in a.keys())
print('auction fields', dict(topkeys))
mods = collections.Counter()
for a in auc:
    for m in (a.get('item') or {}).get('modifiers') or []:
        mods[m.get('type')] += 1
print('modifier types', dict(mods.most_common(20)))
# a few items known to roll random suffixes on Forever (Gear Snapshot scan): 14283, 15211, 9845, 7468
for want in (14283, 15211, 9845, 7468):
    rows = [a for a in auc if (a.get('item') or {}).get('id') == want][:4]
    print('item', want, json.dumps(rows)[:700])
withx = [a for a in auc if set((a.get('item') or {}).keys()) - {'id'}][:5]
print('samples with extra item fields', json.dumps(withx)[:1500])
try:
    c, _ = get('/data/wow/ruleset/1/auctions/113/commodities')
    ca = c.get('auctions') or []
    print('commodities', len(ca), json.dumps(ca[:2]))
except Exception as e:
    print('commodities FAILED', e)
