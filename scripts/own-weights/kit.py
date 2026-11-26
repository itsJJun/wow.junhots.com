"""A typical (not best) gear kit for a class/spec at a level, from the site's item list: per slot the 3rd best
quest or dungeon item a character of that level can wear (required level L-10..L), picked with a selector weight set."""
import os
import json
DB = json.load(open(os.environ.get('OW_GEAR_DB', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'gear_db.json'))))
# Weights that pick the typical kit: Forever Leveling BiS v1.3.0 (MIT), frozen so the sims don't feed on their own output
SEL = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'selector_weights.json')))
SLOTS = {1: 'head', 2: 'neck', 3: 'shoulder', 16: 'back', 5: 'chest', 20: 'chest', 9: 'wrist', 10: 'hands', 6: 'waist',
         7: 'legs', 8: 'feet', 11: 'finger', 12: 'trinket'}
CLASS_ID = {'WARRIOR': 1, 'PALADIN': 2, 'HUNTER': 3, 'ROGUE': 4, 'PRIEST': 5, 'SHAMAN': 7, 'MAGE': 8, 'WARLOCK': 9, 'DRUID': 11}
KEYMAP = {'splpwr': 'sp', 'spldmg': 'sp', 'shasplpwr': 'shadow', 'firsplpwr': 'fire', 'frosplpwr': 'frost', 'arcsplpwr': 'arcane',
          'natsplpwr': 'nature', 'holsplpwr': 'holy', 'sta': 'sta', 'int': 'int', 'spi': 'spi', 'str': 'str', 'agi': 'agi',
          'atkpwr': 'ap', 'rgdatkpwr': 'rap', 'armor': 'armor', 'manargn': 'mp5', 'hitPct': 'hitP', 'critPct': 'critP', 'splheal': 'heal'}

def eff(x):
    """Level a player wears an item from: its required level, or (none set, common on quest rewards) item level - 4."""
    return x['r'] if x['r'] else max(1, x['l'] - 4)

def _score(x, w):
    return sum(v * w.get(k, 0) for k, v in (x.get('st') or {}).items())

def kit(cls, spec, L, rank=3):
    cid = CLASS_ID[cls]; w = SEL[cls][spec]['b']
    ww = next((st for up, st in w if L <= up), w[-1][1])
    maxarm = DB['aprof'].get(str(cid), DB['aprof'].get(cid, 1)) if isinstance(DB['aprof'], dict) else 1
    if maxarm >= 3 and L < 40: maxarm -= 1
    def ok(x):
        if eff(x) > L or eff(x) < L - 10: return False
        if x.get('cm') and not (x['cm'] >> (cid - 1)) & 1: return False
        if not any(s['t'] in ('q', 'd') for s in x['src']): return False
        if x['c'] == 4 and x['s'] in (1, 2, 3, 4) and x['s'] > maxarm and x['v'] not in (16,): return False
        return True
    pool = [x for x in DB['items'] if ok(x)]
    out = {}; picked = []
    for v, slot in SLOTS.items():
        c = sorted([x for x in pool if x['v'] == v and x['c'] == 4], key=lambda x: -_score(x, ww))
        n = 2 if slot in ('finger', 'trinket') else 1
        if slot == 'chest' and v == 20: continue
        if slot == 'chest': c = sorted([x for x in pool if x['v'] in (5, 20) and x['c'] == 4], key=lambda x: -_score(x, ww))
        for r in (rank - 1, rank, rank + 1):   # average of the 2nd-4th best: a typical, not lucky, item
            take = c[r - 1: r - 1 + n] if len(c) >= r + n - 1 else c[:n]
            picked += [(x, 1 / 3) for x in take]
    for x, f in picked:
        for k, val in (x.get('st') or {}).items():
            if k in KEYMAP: out[KEYMAP[k]] = out.get(KEYMAP[k], 0) + val * f
    return {k: round(v, 1) for k, v in out.items()}, [x['n'] for x, f in picked]

def wand_dps(L, rank=3):
    ws = sorted([x['w'][0] for x in DB['items'] if x['c'] == 2 and x['s'] == 19 and L - 10 <= eff(x) <= L and x.get('w')
                 and any(s['t'] in ('q', 'd') for s in x['src'])], reverse=True)
    return ws[rank - 1] if len(ws) >= rank else (ws[-1] if ws else 0.0)

def weapon_caster(cls, spec, L, rank=3):
    """Spell weapon kit: best of staff vs main hand + held off-hand (stats only)."""
    cid = CLASS_ID[cls]; w = SEL[cls][spec]['b']; ww = next((st for up, st in w if L <= up), w[-1][1])
    wp = DB['wprof'].get(str(cid)) or []
    pool = [x for x in DB['items'] if L - 10 <= eff(x) <= L and any(s['t'] in ('q', 'd') for s in x['src'])]
    def pick(f):
        c = sorted([x for x in pool if f(x)], key=lambda x: -_score(x, ww)); return c[min(rank, len(c)) - 1] if c else None
    two = pick(lambda x: x['c'] == 2 and x['v'] == 17 and x['s'] in wp)
    mh = pick(lambda x: x['c'] == 2 and x['v'] in (13, 21) and x['s'] in wp)
    oh = pick(lambda x: x['v'] == 23)
    a = _score(two, ww) if two else 0; b = (_score(mh, ww) if mh else 0) + (_score(oh, ww) if oh else 0)
    items = [two] if a >= b else [mh, oh]
    out = {}
    for x in items:
        for k, val in ((x or {}).get('st') or {}).items():
            if k in KEYMAP: out[KEYMAP[k]] = out.get(KEYMAP[k], 0) + val
    return out, [x['n'] for x in items if x]

if __name__ == '__main__':
    for L in (20, 30, 40, 48, 55):
        g, names = kit('WARLOCK', 'demonology', L); wg, wn = weapon_caster('WARLOCK', 'demonology', L)
        for k, v in wg.items(): g[k] = g.get(k, 0) + v
        print(L, g, 'wand', wand_dps(L), wn)
