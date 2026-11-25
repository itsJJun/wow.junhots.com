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
for path in ['/data/wow/item/19019', '/data/wow/media/item/19019', '/data/wow/item/2589', '/data/wow/item-class/index',
             '/data/wow/item-set/index', '/data/wow/playable-class/index', '/data/wow/playable-class/9', '/data/wow/playable-race/index',
             '/data/wow/playable-specialization/index', '/data/wow/power-type/index', '/data/wow/creature-family/index',
             '/data/wow/creature-type/index', '/data/wow/creature/1', '/data/wow/creature/6109', '/data/wow/media/creature-display/1',
             '/data/wow/quest/index', '/data/wow/quest/2', '/data/wow/quest/category/index', '/data/wow/quest/area/index',
             '/data/wow/profession/index', '/data/wow/profession/197', '/data/wow/recipe/1', '/data/wow/spell/686',
             '/data/wow/media/spell/686', '/data/wow/talent-tree/index', '/data/wow/talent/index', '/data/wow/pvp-talent/index',
             '/data/wow/journal-instance/index', '/data/wow/journal-encounter/index', '/data/wow/journal-expansion/index',
             '/data/wow/mount/index', '/data/wow/pet/index', '/data/wow/achievement/index', '/data/wow/achievement-category/index',
             '/data/wow/reputation-faction/index', '/data/wow/reputation-tiers/index', '/data/wow/title/index', '/data/wow/toy/index',
             '/data/wow/heirloom/index', '/data/wow/guild-crest/index', '/data/wow/keystone-affix/index', '/data/wow/region/index',
             '/data/wow/modified-crafting/index']:
    get(path, S)
get('/data/wow/search/item', S, extra={'name.en_US': 'Robe of the Archmage', 'orderby': 'id', '_page': 1})
get('/data/wow/search/creature', S, extra={'name.en_US': 'Hogger', 'orderby': 'id', '_page': 1})
get('/data/wow/search/spell', S, extra={'name.en_US': 'Shadow Bolt', 'orderby': 'id', '_page': 1})
for path in ['/data/wow/realm/index', '/data/wow/connected-realm/index', '/data/wow/ruleset/index', '/data/wow/ruleset/1/auctions/',
             '/data/wow/region/index', '/data/wow/token/index', '/data/wow/pvp-season/index', '/data/wow/pvp-region/index',
             '/data/wow/mythic-keystone/index', '/data/wow/search/connected-realm']:
    get(path, D)
ri = get('/data/wow/realm/index', D)
realms = [r.get('slug') for r in (ri or {}).get('realms', [])][:12]
for slug in realms[:6]:
    get('/data/wow/realm/' + slug, D, keep=1500)
cri = get('/data/wow/connected-realm/index', D)
for c in ((cri or {}).get('connected_realms') or [])[:3]:
    href = c.get('href', ''); path = urllib.parse.urlparse(href).path
    if path: get(path, D, keep=3000)
ps = get('/data/wow/pvp-season/index', D)
names = []
if ps and ps.get('current_season'):
    sid = ps['current_season']['id']
    get('/data/wow/pvp-season/%d' % sid, D)
    lb = get('/data/wow/pvp-season/%d/pvp-leaderboard/index' % sid, D)
    for l in ((lb or {}).get('leaderboards') or [])[:2]:
        path = urllib.parse.urlparse(l['key']['href']).path
        d = get(path, D, keep=1500)
        for e in ((d or {}).get('entries') or [])[:3]:
            c = e.get('character') or {}
            if c.get('name') and (c.get('realm') or {}).get('slug'): names.append((c['realm']['slug'], c['name'].lower()))
# guilds/characters: only names that the API itself gave out (public leaderboards)
for slug, name in names[:2]:
    base = '/profile/wow/character/%s/%s' % (slug, urllib.parse.quote(name))
    for sub in ['', '/equipment', '/specializations', '/statistics', '/character-media', '/professions', '/reputations',
                '/achievements', '/quests', '/quests/completed', '/hunter-pets', '/titles', '/pvp-summary', '/appearance', '/status']:
        get(base + sub, P, keep=3000)
for region in ['eu', 'kr', 'tw']:
    get('/data/wow/ruleset/index', D, region=region)
    get('/data/wow/realm/index', D, region=region, keep=800)
json.dump(OUT, open('probe.json', 'w'), indent=1)
