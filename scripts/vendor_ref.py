#!/usr/bin/env python3
"""Update scripts/vendor-prices.json: what a vendor really pays for each item, read from the game itself.

  python3 scripts/vendor_ref.py "<WoW>/_forever_/WTF/Account/<account>/SavedVariables/TradeSkillMaster.lua"

TradeSkillMaster saves the game's own item info (TSMItemInfoDB: base64 -> raw deflate -> CBOR array, 15 fields per
item: item string, name, item level, min level, max stack, vendor sell price, ...). Those are the numbers in the
in-game tooltip, so scripts/check-vendor-prices.cjs uses them to check every vendor price the site shows.
New items are added and changed ones replaced; items the file doesn't mention are kept.
"""
import base64, json, os, re, struct, sys, zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor-prices.json')
STRIDE, SELL = 15, 5


def cbor(b):
    """Minimal CBOR reader (ints, byte/text strings, arrays, maps, simple values, floats): enough for TSMItemInfoDB."""
    def arg(i, ai):
        if ai < 24: return ai, i
        n = {24: 1, 25: 2, 26: 4, 27: 8}[ai]
        return int.from_bytes(b[i:i + n], 'big'), i + n

    def item(i):
        ib = b[i]; mt, ai = ib >> 5, ib & 31; i += 1
        if mt == 7:
            if ai == 25: return None, i + 2
            if ai == 26: return struct.unpack('>f', b[i:i + 4])[0], i + 4
            if ai == 27: return struct.unpack('>d', b[i:i + 8])[0], i + 8
            return {20: False, 21: True, 22: None}.get(ai), i
        v, i = arg(i, ai)
        if mt == 0: return v, i
        if mt == 1: return -1 - v, i
        if mt in (2, 3): return b[i:i + v].decode('utf-8', 'replace'), i + v
        if mt == 4:
            out = []
            for _ in range(v):
                x, i = item(i); out.append(x)
            return out, i
        if mt == 5:
            out = {}
            for _ in range(v):
                k, i = item(i); x, i = item(i); out[k] = x
            return out, i
        if mt == 6: return item(i)
        raise ValueError('CBOR type %d' % mt)
    return item(0)[0]


def read_tsm(path):
    t = open(path, encoding='utf-8', errors='replace').read()
    m = re.search(r'TSMItemInfoDB = \{.*?\["data"\] = "([^"]+)"', t, re.S)
    if not m: sys.exit('No TSMItemInfoDB in ' + path)
    s = m.group(1)
    a = cbor(zlib.decompress(base64.b64decode(s + '=' * (-len(s) % 4)), -15))
    out = {}
    for k in range(0, len(a) - STRIDE + 1, STRIDE):
        s, sell = a[k], a[k + SELL]
        if isinstance(s, str) and re.fullmatch(r'i:\d+', s) and isinstance(sell, int) and sell >= 0:
            out[s[2:]] = sell
    return out


if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit(__doc__)
    new = read_tsm(sys.argv[1])
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    changed = sum(1 for k, v in new.items() if k in old and old[k] != v)
    added = sum(1 for k in new if k not in old)
    old.update(new)
    json.dump(dict(sorted(old.items(), key=lambda kv: int(kv[0]))), open(OUT, 'w'), separators=(',', ':'))
    print('%d items read, %d new, %d changed, %d in %s' % (len(new), added, changed, len(old), os.path.basename(OUT)))
