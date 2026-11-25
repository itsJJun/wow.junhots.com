"""One-off (branch only): every Forever spec talent tree from Blizzard's API, keyed by tree and spec id. Writes talents.json.gz."""
import base64, gzip, json, os, urllib.parse, urllib.request

cid, sec = os.environ['BLIZZARD_CLIENT_ID'], os.environ['BLIZZARD_CLIENT_SECRET']
req = urllib.request.Request('https://oauth.battle.net/token', data=b'grant_type=client_credentials',
                             headers={'Authorization': 'Basic ' + base64.b64encode((cid + ':' + sec).encode()).decode()})
TOK = json.load(urllib.request.urlopen(req, timeout=30))['access_token']


def get(path):
    url = 'https://us.api.blizzard.com%s?%s' % (path, urllib.parse.urlencode({'namespace': 'static-forever-us', 'locale': 'en_US'}))
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOK}), timeout=60))


out = {}
idx = get('/data/wow/talent-tree/index')
for t in idx.get('class_talent_trees', []):
    c = get(urllib.parse.urlparse(t['key']['href']).path)
    for s in c.get('spec_talent_trees', []):
        p = urllib.parse.urlparse(s['key']['href']).path
        out[p.split('/talent-tree/')[1]] = get(p)
open('talents.json.gz', 'wb').write(gzip.compress(json.dumps(out).encode(), 9))
print('trees', len(out))
