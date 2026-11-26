#!/usr/bin/env python3
"""Per class/spec leveling weights with gen.py: typical gear kit + weapons per level, stat deltas -> FLB-shaped brackets."""
import os
import json, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lvl, gen
from kit import kit, DB, SEL, CLASS_ID, KEYMAP, _score, eff, wand_dps
from run_class import talents_at, smooth, LEVELS, FIRST

lvl.ITERS = 3000
PHYS = {'hitP': 'mhitP', 'critP': 'mcritP'}

def wscore(x, W, oh=False):
    s = _score(x, W)
    if x.get('w'): s += W.get('ohDps' if oh else 'dps', W.get('dps', 0)) * x['w'][0]
    return s

def weapons(C, L, rank=3):
    """Typical weapons: rank-th best quest/dungeon weapon of each allowed kind; best set of 2H / MH+OH / MH+shield."""
    cid = CLASS_ID[C['cls']]; w = SEL[C['cls']][C['spec']]['b']; W = next((st for up, st in w if L <= up), w[-1][1])
    wp = set(DB['wprof'].get(str(cid)) or [])
    pool = [x for x in DB['items'] if L - 10 <= eff(x) <= L and any(s['t'] in ('q', 'd') for s in x['src'])
            and not (x.get('cm') and not (x['cm'] >> (cid - 1)) & 1)]
    def pick(f, oh=False):
        c = sorted([x for x in pool if f(x)], key=lambda x: -wscore(x, W, oh)); return c[min(rank, len(c)) - 1] if c else None
    melee = lambda x: x['c'] == 2 and x['s'] in wp and x.get('w')
    two = pick(lambda x: melee(x) and x['v'] == 17)
    mh = pick(lambda x: melee(x) and x['v'] in (13, 21))
    sets = []
    if two and '2h' in C['wsets']: sets.append(([(gen.MH, two, '2h')], wscore(two, W)))
    if 'dual' in C['wsets'] and mh:
        oh = pick(lambda x: melee(x) and x['v'] in (13, 22) and x['i'] != mh['i'], True)
        if oh: sets.append(([(gen.MH, mh, '1h'), (gen.OH, oh, '1h')], wscore(mh, W) + wscore(oh, W, True)))
    if 'shield' in C['wsets'] and mh:
        sh = pick(lambda x: x['c'] == 4 and x['s'] == 6)
        if sh: sets.append(([(gen.MH, mh, '1h'), (gen.OH, sh, 'shield')], wscore(mh, W) + _score(sh, W)))
    if 'held' in C['wsets'] and mh:
        hd = pick(lambda x: x['v'] == 23)
        sets.append(([(gen.MH, mh, '1h')] + ([(gen.OH, hd, 'held')] if hd else []), wscore(mh, W) + (_score(hd, W) if hd else 0)))
    if not sets and mh: sets.append(([(gen.MH, mh, '1h')], wscore(mh, W)))
    if not sets: return {}
    best = max(sets, key=lambda s: s[1])[0]
    if C['cls'] == 'HUNTER':
        rg = pick(lambda x: x['c'] == 2 and x['s'] in (2, 3, 18) and x['s'] in wp and x.get('w'))
        if rg: best.append((gen.RANGED, rg, 'ranged'))
    out = {}
    for slot, x, kind in best:
        st = {}
        for k, v in (x.get('st') or {}).items():
            if k in KEYMAP:
                kk = KEYMAP[k]; kk = PHYS.get(kk, kk) if C['phys'] else kk
                st[kk] = st.get(kk, 0) + v
        out[slot] = (x['i'], st, kind)
    return out, [x['n'] for _, x, _ in best]

def gear_at(C, L):
    g, names = kit(C['cls'], C['spec'], L)
    out = {}
    for k, v in g.items():
        if k == 'heal': continue
        k = PHYS.get(k, k) if C['phys'] else k
        if k in gen.STAT or k in gen.PSEUDO: out[k] = out.get(k, 0) + v
    # whole points (percent stats to 0.5): the engine refuses fractional stat auras
    return {k: (round(v * 2) / 2 if k in gen.PSEUDO else round(v)) for k, v in out.items() if round(v * 2)}

def weights_at(C, L):
    g = gear_at(C, L); wpn, wn = weapons(C, L) or ({}, [])
    tal = talents_at(C['talents'], C['main'], L)
    W = wand_dps(L) if C.get('wand') else 0.0
    k0, cal = gen.kph(C, L, g, wpn, tal, verbose=True, wand=W)
    out = {}
    for s, d in C['delta'].items():
        k, _ = gen.kph(C, L, g, wpn, tal, bonus={s: d}, cal=cal, wand=W); out[s] = (k - k0) / d
    if W:
        k, _ = gen.kph(C, L, g, wpn, tal, cal=cal, wand=W + 5); out['wandDps'] = (k - k0) / 5
    for slot, key in ((gen.MH, 'dps'), (gen.OH, 'ohDps'), (gen.RANGED, 'rangedDps')):
        if slot in wpn and wpn[slot][2] in ('1h', '2h', 'ranged'):
            dmg = gen.STRIKE['ranged' if slot == gen.RANGED else wpn[slot][2]][1]
            if C.get('form_speed') and slot == gen.MH: spd_override = C['form_speed']
            else: spd_override = None
            spd = next(x['w'][1] for x in DB['items'] if x['i'] == wpn[slot][0])
            k, _ = gen.kph(C, L, g, wpn, tal, cal=cal, strike={slot}, wand=W); out[key] = (k - k0) / (dmg / (spd_override or spd))
    ref = out[C['ref']] or 1e-9
    res = {}
    for s, v in out.items():
        for key in C['site'].get(s, [s]): res[key] = round(max(0.0, v / ref), 3)
    return res, {'kph': round(k0, 1), 'talents': tal, 'gear': g, 'weapons': wn, 'wand': W}

def run(C):
    b, info = [], {}
    for up, L in [FIRST] + LEVELS:
        t0 = time.time()
        w, i = weights_at(C, L); b.append([up, w]); info[L] = i
        print('   L%d %.0fs' % (L, time.time() - t0), flush=True)
    return {'source': 'own-sim', 'b': smooth(b)}, info
