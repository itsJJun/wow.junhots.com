"""One-off: list what Blizzard's Battle.net API returns for WoW Forever (run by .github/workflows/blizzard-probe.yml).
Writes probe.json: for each endpoint the HTTP status and the first part of the answer. Never prints the keys."""
import base64, json, os, sys, urllib.error, urllib.parse, urllib.request

def token():
    cid, sec = os.environ['BLIZZARD_CLIENT_ID'], os.environ['BLIZZARD_CLIENT_SECRET']
    req = urllib.request.Request('https://oauth.battle.net/token', data=b'grant_type=client_credentials',
                                 headers={'Authorization': 'Basic ' + base64.b64encode((cid + ':' + sec).encode()).decode()})
    return json.load(urllib.request.urlopen(req, timeout=30))['access_token']

TOK = token(); OUT = {}

def get(path, ns, region='us', extra=None, keep=2500):
    q = {'namespace': ns + '-' + region, 'locale': 'en_US'}; q.update(extra or {})
    url = 'https://%s.api.blizzard.com%s?%s' % (region, path, urllib.parse.urlencode(q))
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOK}), timeout=60)
        body = r.read(); st = r.status
    except urllib.error.HTTPError as e:
        body = e.read(); st = e.code
    except Exception as e:
        body = str(e).encode(); st = -1
    txt = body.decode('utf-8', 'replace')
    OUT['%s %s %s' % (region, ns, path)] = {'status': st, 'bytes': len(body), 'head': txt[:keep]}
    print(st, len(body), region, ns, path)
    try: return json.loads(txt) if st == 200 else None
    except Exception: return None

S, D, P = 'static-forever', 'dynamic-forever', 'profile-forever'
for r in [1, 2, 3, 15]:
    get('/data/wow/ruleset/%d' % r, D, keep=3000)
    get('/data/wow/ruleset/%d/auctions/' % r, D, keep=200)
get('/data/wow/region/91', D)
for path in ['/data/wow/quest/area/14', '/data/wow/quest/area/17', '/data/wow/quest/type/index', '/data/wow/quest/788',
             '/data/wow/quest/790', '/data/wow/quest/804', '/data/wow/quest/2161', '/data/wow/quest/1505', '/data/wow/quest/category/61',
             '/data/wow/profession/197/skill-tier/2948', '/data/wow/profession/333', '/data/wow/item/2589',
             '/data/wow/item/4334', '/data/wow/item/863', '/data/wow/item-set/index', '/data/wow/spell/14673', '/data/wow/media/spell/14673',
             '/data/wow/talent-tree/index', '/data/wow/reputation-faction/76', '/data/wow/item-class/4', '/data/wow/achievement/6',
             '/data/wow/mount/index', '/data/wow/playable-race/2', '/data/wow/quest/type/1']:
    get(path, S, keep=6000)
tt = get('/data/wow/talent-tree/index', S, keep=200)
for t in ((tt or {}).get('spec_talent_trees') or []):
    if 'Demonology' in t.get('name', ''):
        get(urllib.parse.urlparse(t['key']['href']).path, S, keep=8000)
for t in ((tt or {}).get('class_talent_trees') or [])[:1]:
    get(urllib.parse.urlparse(t['key']['href']).path, S, keep=4000)
st = get('/data/wow/profession/197/skill-tier/2948', S, keep=200)
for c in ((st or {}).get('categories') or [])[:1]:
    for r in (c.get('recipes') or [])[:2]:
        get('/data/wow/recipe/%d' % r['id'], S, keep=3000)
for q in [{'id': '[19000,]', 'orderby': 'id', '_page': 1, '_pageSize': 1000}, {'orderby': 'id', '_page': 1000},
          {'name.en_US': 'Cloth', 'orderby': 'id', '_page': 1}]:
    get('/data/wow/search/item', S, extra=q, keep=600)
for path in ['/data/wow/search/quest', '/data/wow/search/mount', '/data/wow/search/journal-encounter', '/data/wow/search/media']:
    get(path, S, extra={'orderby': 'id', '_page': 1}, keep=600)
json.dump(OUT, open('probe.json', 'w'), indent=1)
