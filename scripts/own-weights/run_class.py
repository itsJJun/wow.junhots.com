#!/usr/bin/env python3
"""Leveling weights for one class: every spec, every 5-level bracket -> FLB-shaped JSON {spec: {b: [[upTo, {stat: w}]]}}."""
import os
import json, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lvl
lvl.ITERS = 3000
from lvl import kph
from kit import kit, wand_dps, weapon_caster

LEVELS = [(14, 12), (19, 17), (24, 22), (29, 27), (34, 32), (39, 37), (44, 42), (49, 47), (54, 52), (59, 57), (60, 60)]
FIRST = (9, 10)   # levels 1-9 use the level 10 result

def talents_at(full, main, L):
    pts = max(0, L - 9); trees = full.split('-') + ['', '', '']; trees = trees[:3]
    out = ['', '', '']
    order = [main] + [i for i in range(3) if i != main]
    for t in order:
        for ch in trees[t]:
            v = min(int(ch), pts); out[t] += str(v); pts -= v
    return '-'.join(x.rstrip('0') for x in out)

SITE = {'sp': ['splpwr', 'spldmg'], 'shadow': ['shasplpwr'], 'fire': ['firsplpwr'], 'frost': ['frosplpwr'], 'arcane': ['arcsplpwr'],
        'nature': ['natsplpwr'], 'holy': ['holsplpwr'], 'int': ['int'], 'spi': ['spi'], 'sta': ['sta'], 'mp5': ['manargn'],
        'hitP': ['hitPct'], 'critP': ['critPct'], 'armor': ['armor'], 'wandDps': ['rangedDps']}
DELTA = {'sp': 20, 'shadow': 20, 'fire': 20, 'int': 20, 'spi': 20, 'sta': 30, 'mp5': 10, 'hitP': 2, 'critP': 2, 'armor': 200}

def weights_at(cfg, L):
    g, _ = kit(cfg['cls'], cfg['spec'], L); wg, _ = weapon_caster(cfg['cls'], cfg['spec'], L)
    for k, v in wg.items(): g[k] = g.get(k, 0) + v
    g = {k: v for k, v in g.items() if k in lvl.STAT or k in lvl.PSEUDO}
    for k in list(g):
        if k in ('heal',): g.pop(k)
    # schools other than the spec's count as nothing for the kit; keep generic spell power
    tal = talents_at(cfg['talents'], cfg['main'], L); pet = cfg['pet'](L); rot = cfg['rot']
    W = wand_dps(L) if cfg.get('wand') else 0.0
    k0, dur = kph(L, g, tal, pet, rot, wand=W, verbose=True)
    out = {}
    for s, d in DELTA.items():
        k, _ = kph(L, g, tal, pet, rot, bonus={s: d}, dur=dur, wand=W); out[s] = (k - k0) / d
    if W:
        k, _ = kph(L, g, tal, pet, rot, dur=dur, wand=W + 5); out['wandDps'] = (k - k0) / 5
    ref = out['sp'] or 1e-9
    res = {}
    for s, v in out.items():
        for key in SITE[s]: res[key] = round(max(0.0, v / ref), 3)
    return res, {'kph': round(k0, 1), 'talents': tal, 'pet': pet, 'wand': W, 'gear': g}

def run(cfg):
    b, info = [], {}
    w10, i10 = weights_at(cfg, FIRST[1]); b.append([FIRST[0], w10]); info[FIRST[1]] = i10
    for up, L in LEVELS:
        w, i = weights_at(cfg, L); b.append([up, w]); info[L] = i
    return {'source': 'own-sim', 'b': smooth(b)}, info

def smooth(b):
    """Light smoothing across neighbouring brackets (1-2-1), so one noisy sim can't swing a bracket; ends kept."""
    out = [b[0]]
    for i in range(1, len(b) - 1):
        keys = set(b[i][1]) | set(b[i - 1][1]) | set(b[i + 1][1])
        prev = b[i - 1][1] if i > 1 else b[i][1]   # the level 1-9 bracket is a different game; don't mix it in
        nxt = b[i + 1][1]
        out.append([b[i][0], {k: round((prev.get(k, 0) + 2 * b[i][1].get(k, 0) + nxt.get(k, 0)) / 4, 3) for k in keys}])
    out.append(b[-1])
    return out
