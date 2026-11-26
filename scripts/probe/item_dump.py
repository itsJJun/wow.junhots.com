"""One-off (branch only): every wearable Forever item from Blizzard's API (static-forever-us), for our own Gear upgrades
item list. Ids = Item.db2 rows with ClassID 2/4 and a wearable InventoryType (item_ids.json). Writes items.json.gz."""
import base64, gzip, json, os, threading, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

cid, sec = os.environ['BLIZZARD_CLIENT_ID'], os.environ['BLIZZARD_CLIENT_SECRET']
req = urllib.request.Request('https://oauth.battle.net/token', data=b'grant_type=client_credentials',
                             headers={'Authorization': 'Basic ' + base64.b64encode((cid + ':' + sec).encode()).decode()})
TOK = json.load(urllib.request.urlopen(req, timeout=30))['access_token']
lock = threading.Lock(); last = [0.0]


def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k not in ('_links', 'key')}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


def get(i):
    url = 'https://us.api.blizzard.com/data/wow/item/%d?%s' % (i, urllib.parse.urlencode({'namespace': 'static-forever-us', 'locale': 'en_US'}))
    for n in range(5):
        with lock:  # ~20 requests a second (limit 100/s, 36,000/hour)
            w = last[0] + 0.05 - time.time()
            if w > 0: time.sleep(w)
            last[0] = time.time()
        try:
            return i, strip(json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOK}), timeout=60)))
        except urllib.error.HTTPError as e:
            if e.code == 404: return i, None
            time.sleep(3 * (n + 1))
        except Exception:
            time.sleep(3 * (n + 1))
    return i, 'error'


ids = json.load(open(os.path.join(os.path.dirname(__file__), 'item_ids.json')))
out, missing, err = {}, [], []
with ThreadPoolExecutor(12) as ex:
    for i, r in ex.map(get, ids):
        if r is None: missing.append(i)
        elif r == 'error': err.append(i)
        else: out[i] = r
open('items.json.gz', 'wb').write(gzip.compress(json.dumps({'items': out, 'missing': missing, 'errors': err}).encode(), 9))
print('items', len(out), 'missing', len(missing), 'errors', len(err))
