#!/usr/bin/env python3
"""Put own_weights.json into the Gear upgrades page data.

  python3 scripts/own-weights/apply.py            # public/data/gear-<hash>.bin the page reads -> new bin with our weights

The page reads its item data from /data/gear-<hash>.bin (gzip JSON, see build_site.py externalize_data). This swaps the
stat weights (W) and meta.weights for the ones in own_weights.json, writes the new bin and points the page at it.
build_site.py calls weights_into() too, so a full site build keeps our weights whatever the project's gear_db.json holds.
"""
import gzip, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PAGE = os.path.join(REPO, 'public/gear-upgrades/index.html')
SRC = re.compile(r'(<script id="gdb" type="application/octet-stream" data-src="/data/)(gear-[0-9a-f]+\.bin)(">)')


def weights_into(db, ow=None):
    """db: the page's item data (dict). Returns it with our stat weights, if own_weights.json has every spec it uses."""
    ow = ow or json.load(open(os.path.join(HERE, 'own_weights.json')))
    miss = [(c, s) for c, v in db['W'].items() for s in v if s not in ow['W'].get(c, {})]
    if miss:
        print('own weights: missing %s, keeping the item data weights' % miss, file=sys.stderr)
        return db
    db['W'] = {c: {s: {'b': x['b']} for s, x in v.items()} for c, v in ow['W'].items()}
    db['meta']['weights'] = ow['meta']
    return db


def pack(db):
    return gzip.compress(json.dumps(db, separators=(',', ':')).encode(), 9, mtime=0)


if __name__ == '__main__':
    page = open(PAGE, encoding='utf-8').read()
    m = SRC.search(page)
    old = os.path.join(REPO, 'public/data', m.group(2))
    db = weights_into(json.loads(gzip.decompress(open(old, 'rb').read())))
    raw = pack(db)
    name = 'gear-%s.bin' % hashlib.sha1(raw).hexdigest()[:14]
    if name == m.group(2):
        print('no change'); sys.exit(0)
    open(os.path.join(REPO, 'public/data', name), 'wb').write(raw)
    open(PAGE, 'w', encoding='utf-8').write(page[:m.start(2)] + name + page[m.end(2):])
    print('page now reads', name)
