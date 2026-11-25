"""One-off (branch only): dump Forever's static game data from Blizzard's API for checks against our own data.
Recipes per profession (with reagents), talent trees per spec, quests per zone. Writes static.json.gz. Never prints keys."""
import base64, gzip, json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

R = 'us'


def token():
    cid, sec = os.environ['BLIZZARD_CLIENT_ID'], os.environ['BLIZZARD_CLIENT_SECRET']
    req = urllib.request.Request('https://oauth.battle.net/token', data=b'grant_type=client_credentials',
                                 headers={'Authorization': 'Basic ' + base64.b64encode((cid + ':' + sec).encode()).decode()})
    return json.load(urllib.request.urlopen(req, timeout=30))['access_token']


TOK = token()
ERR = []


def get(path):
    url = 'https://%s.api.blizzard.com%s?%s' % (R, path, urllib.parse.urlencode({'namespace': 'static-forever-' + R, 'locale': 'en_US'}))
    for n in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOK}), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                ERR.append(path); return None
            time.sleep(2 * (n + 1))
        except Exception:
            time.sleep(2 * (n + 1))
    ERR.append(path); return None


def path_of(href):
    return urllib.parse.urlparse(href).path


def pmap(f, xs, n=12):
    with ThreadPoolExecutor(n) as ex:
        return list(ex.map(f, xs))


out = {'patch': None, 'professions': [], 'recipes': {}, 'talents': {}, 'quests': {}, 'areas': {}}
it = get('/data/wow/item/2589')
m = re.search(r'static-([\d.]+)_(\d+)-forever', it['_links']['self']['href']) if it else None
out['patch'] = [m.group(1), int(m.group(2))] if m else None

# ---- recipes ----
rids = set()
for p in (get('/data/wow/profession/index') or {}).get('professions', []):
    pd = get('/data/wow/profession/%d' % p['id']) or {}
    tiers = []
    for t in pd.get('skill_tiers', []):
        td = get('/data/wow/profession/%d/skill-tier/%d' % (p['id'], t['id'])) or {}
        cats = []
        for c in td.get('categories', []):
            ids = [r['id'] for r in c.get('recipes', [])]; rids.update(ids)
            cats.append({'name': c.get('name'), 'recipes': ids})
        tiers.append({'id': t['id'], 'name': t.get('name'), 'min': td.get('minimum_skill_level'), 'max': td.get('maximum_skill_level'), 'categories': cats})
    out['professions'].append({'id': p['id'], 'name': p['name'], 'type': (pd.get('type') or {}).get('type'), 'tiers': tiers})


def recipe(rid):
    d = get('/data/wow/recipe/%d' % rid)
    if not d:
        return rid, None
    ci = d.get('crafted_item') or d.get('alliance_crafted_item') or {}
    return rid, {'name': d.get('name'), 'item': ci.get('id'), 'itemName': ci.get('name'),
                 'qty': (d.get('crafted_quantity') or {}).get('value') or (d.get('crafted_quantity') or {}).get('minimum'),
                 'qtyMax': (d.get('crafted_quantity') or {}).get('maximum'),
                 'reagents': [[r['reagent']['id'], r['quantity']] for r in d.get('reagents', [])], 'rank': d.get('rank')}


out['recipes'] = dict(pmap(recipe, sorted(rids)))
print('recipes', len(rids))

# ---- talents ----
ti = get('/data/wow/talent-tree/index') or {}
for t in ti.get('spec_talent_trees', []):
    d = get(path_of(t['key']['href']))
    if d:
        out['talents'][t.get('name') or path_of(t['key']['href'])] = d
for t in ti.get('class_talent_trees', []):
    d = get(path_of(t['key']['href']))
    if d:
        out['talents']['class:' + (t.get('name') or path_of(t['key']['href']))] = d
print('talent trees', len(out['talents']))

# ---- quests ----
qids = set()
for a in (get('/data/wow/quest/area/index') or {}).get('areas', []):
    d = get('/data/wow/quest/area/%d' % a['id']) or {}
    ids = [q['id'] for q in d.get('quests', [])]; qids.update(ids)
    out['areas'][a['id']] = {'name': a.get('name'), 'quests': ids}
for c in (get('/data/wow/quest/category/index') or {}).get('categories', []):
    d = get('/data/wow/quest/category/%d' % c['id']) or {}
    ids = [q['id'] for q in d.get('quests', [])]; qids.update(ids)
    out['areas']['c%d' % c['id']] = {'name': c.get('name'), 'quests': ids, 'category': True}


def quest(qid):
    d = get('/data/wow/quest/%d' % qid)
    if not d:
        return qid, None
    d.pop('_links', None)
    return qid, d


out['quests'] = dict(pmap(quest, sorted(qids)))
print('quests', len(qids))
out['errors'] = ERR[:500]; out['errorCount'] = len(ERR)
open('static.json.gz', 'wb').write(gzip.compress(json.dumps(out, separators=(',', ':')).encode(), 9))
print('errors', len(ERR), 'size', os.path.getsize('static.json.gz'))
