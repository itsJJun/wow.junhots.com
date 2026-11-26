#!/usr/bin/env python3
"""Leveling stat weights for any class: kills per hour from the MythicSim Forever engine + a resting/death model.
Same model as lvl.py (the Warlock version), made class-generic: melee weapons, rage/energy, pets that tank, hunters."""
import os
import copy, json, math, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lvl
from lvl import EXP, PES, GO, DRINK, FOOD, rate, run, DEATHS_PER_HOUR, DEATH_COST, REST_STOP, MIX

FIX = lvl.ENG + '/fixtures/levels/'
_TPL = {}
def tpl(name):
    if name not in _TPL: _TPL[name] = json.load(open(FIX + name + '.request.json'))
    return _TPL[name]

# Level 1 attributes (str, agi, sta, int, spi): classic race base + class bonus. Skyborne races not used.
RACE1 = {'RaceHuman': (20, 20, 20, 20, 21), 'RaceOrc': (23, 17, 22, 17, 23), 'RaceDwarf': (22, 16, 23, 19, 19),
         'RaceNightElf': (17, 25, 19, 20, 20), 'RaceUndead': (19, 18, 21, 18, 25), 'RaceTauren': (25, 15, 22, 15, 22),
         'RaceGnome': (15, 23, 19, 24, 20), 'RaceTroll': (21, 22, 21, 16, 21)}
CLASS1 = {'ClassWarrior': (3, 0, 2, 0, 0), 'ClassPaladin': (2, 0, 2, 0, 1), 'ClassHunter': (0, 3, 1, 0, 1),
          'ClassRogue': (1, 3, 1, 0, 0), 'ClassPriest': (0, 0, 0, 2, 3), 'ClassShaman': (1, 0, 1, 1, 2),
          'ClassMage': (0, 0, 0, 3, 2), 'ClassWarlock': (0, 0, 1, 2, 2), 'ClassDruid': (1, 0, 0, 2, 2)}
ATTR = ['str', 'agi', 'sta', 'int', 'spi']
GOKEY = {'str': 'Strength', 'agi': 'Agility', 'sta': 'Stamina', 'int': 'Intellect', 'spi': 'Spirit'}

def base_attrs(ckey, race, L):
    b60 = GO['base_stats'][ckey][race]
    l1 = [a + b for a, b in zip(RACE1[race], CLASS1[ckey])]
    return {k: round(l1[i] + (b60[GOKEY[k]] - l1[i]) * (L - 1) / 59) for i, k in enumerate(ATTR)}, b60

STAT = {'str': 0, 'agi': 1, 'sta': 2, 'int': 3, 'heal': 4, 'sp': 5, 'arcane': 6, 'fire': 7, 'frost': 8, 'holy': 9, 'nature': 10,
        'shadow': 11, 'spi': 16, 'ap': 17, 'rap': 18, 'armor': 30, 'mp5': 34, 'def': 25}
# percent stats: spell hit/crit; physical hit/crit go on melee AND ranged (the engine stores ranged as "over melee")
PSEUDO = {'hitP': [13], 'critP': [15], 'mhitP': [12, 24], 'mcritP': [14, 25]}
MH, OH, RANGED = 14, 15, 16
STRIKE = {'1h': (943, 3.0), '2h': (1897, 5.0), 'ranged': (33, 3.0)}   # Striking / Lesser Impact / Accurate Scope: +N weapon damage

def ammo(L):
    return 'RazorArrow' if L < 40 else 'JaggedArrow' if L < 55 else 'IceThreadedArrow'

_CONST = {}
PWS = [(6, 45, 45), (12, 87, 80), (18, 155, 130), (24, 227, 175), (30, 292, 210), (36, 369, 250), (42, 471, 300), (48, 592, 355),
       (54, 750, 425), (60, 929, 500)]   # Power Word: Shield ranks (Forever client): level, absorb, mana; +10% of spell power
APPROACH = 3.0   # seconds a ranged class casts before the mob reaches it (assumption: about 2 casts)

def request(C, L, gear, wpn, talents, dur, bonus=None, iters=None, gap=0, const=None, strike=None):
    """C: class/spec config. gear: kit stats (no weapon stats). wpn: {slot: (item id, stats, kind)}.
    const: (melee crit, spell crit) parts that don't come from agility/intellect, from a first prepare (see consts)."""
    iters = iters or lvl.ITERS
    r = copy.deepcopy(tpl(C['tmpl']))
    r['raid']['buffs'] = {}; r['raid']['debuffs'] = {}
    r['encounter']['duration'] = dur; r['encounter']['durationVariation'] = 0
    t = r['encounter']['targets'][0]; M = max(10, min(63, L + gap)); e = EXP[M]
    t['level'] = M; t['name'] = 'Level %d mob' % M
    st = [0.0] * 41; st[30] = float(e['CreatureArmor']); st[32] = float(e['CreatureHealth']); t['stats'] = st
    t['minBaseDamage'] = float(e['CreatureAutoAttackDps']) * 2.0; t['swingSpeed'] = 2.0; t['canCrush'] = False
    if not C.get('pet_tanks', lambda L: False)(L) and C.get('tank_engine', True):
        r['raid']['tanks'] = [{'type': 'Player', 'index': 0}]; t['tankIndex'] = 0
    p = r['raid']['parties'][0]['players'][0]
    p['level'] = L; p['race'] = C['race']; p['talentsString'] = talents; p['buffs'] = {}
    items = [{} for _ in range(17)]
    for slot, (iid, _, kind) in wpn.items():
        items[slot] = {'id': iid}
        if strike and slot in strike and kind in STRIKE: items[slot]['enchant'] = STRIKE['ranged' if slot == RANGED else kind][0]
    p['equipment'] = {'items': items}
    opts = p[C['opts_key']]['options']
    opts['classOptions'] = dict(opts.get('classOptions') or {}, **C.get('opts', {}))
    if C['ckey'] == 'ClassHunter': opts['classOptions']['ammo'] = ammo(L)
    if 'opts_fn' in C: C['opts_fn'](opts['classOptions'], L)
    p['rotation'] = C['rot']; p['consumables'] = {}; p.pop('profession1', None)
    p.update(C.get('player_fields', {}))
    base, b60 = base_attrs(C['ckey'], C['race'], L)
    allg = dict(gear)
    for slot, (_, ws, _) in wpn.items():
        for k, v in ws.items(): allg[k] = allg.get(k, 0) + v
    bon = dict(gear)                                   # weapon stats come with the item itself
    for k, v in (bonus or {}).items():
        allg[k] = allg.get(k, 0) + v; bon[k] = bon.get(k, 0) + v
    tot = {k: base[k] + allg.get(k, 0) for k in base}
    pes = PES[(L, C['cid'])]; e0 = EXP[L]
    hp_base = b60['Health'] * float(e0['PlayerHealth']) / float(EXP[60]['PlayerHealth'])
    mana = round(float(pes['BaseMana']) + 15 * tot['int']) if float(pes['BaseMana']) > 0 else 0
    cm, cs = const if const else (0.0, 0.0)
    sheet = {'attributes': [tot[k] for k in ATTR], 'base': [base[k] for k in ATTR], 'equipment': {'items': []}, 'level': L,
             'health': round(hp_base + 10 * tot['sta']), 'mana': mana,
             'meleeCrit': round(cm + 100 * tot['agi'] * float(pes['CritPerAgility']) + (bonus or {}).get('mcritP', 0), 4) if const else 0.0,
             'spellCrit': [round(cs + 100 * tot['int'] * float(pes['SpellCritPerIntellect']) + (bonus or {}).get('critP', 0), 4) if const else 0.0] * 6}
    p['characterSheet'] = sheet
    bs = [0.0] * 41; ps = [0.0] * 30
    for k, v in bon.items():
        if k in PSEUDO:
            for i in PSEUDO[k]: ps[i] += v
        elif k in STAT: bs[STAT[k]] += v
    p['bonusStats'] = {'stats': bs, 'pseudoStats': ps}
    r['simOptions'] = {'iterations': iters, 'randomSeed': '42'}
    return r

def consts(C, L, gear, wpn, talents):
    """Crit not from agility/intellect (base + talents + gear), so the sheet can carry the right crit per agility/intellect
    at this level (the engine solves crit per point from the sheet; with the sheet's crit at 0 it keeps its level 60 value)."""
    key = (C['cls'], C['spec'], L, talents, json.dumps(gear, sort_keys=True), json.dumps(wpn, sort_keys=True, default=str))
    if key not in _CONST:
        r = request(C, L, gear, wpn, talents, 10.0, iters=1)
        prep = run(r, 'prepare')['player']['stats']
        base, _ = base_attrs(C['ckey'], C['race'], L)
        A = r['raid']['parties'][0]['players'][0]['characterSheet']['attributes']
        km, ks = GO['crit_per_agi_max_level'][C['ckey']], GO['crit_per_int_max_level'][C['ckey']]
        _CONST[key] = (prep['PhysicalCritPercent'] - km * prep['Agility'], prep['SpellCritPercent'] - ks * prep['Intellect'])
    return _CONST[key]

def fight(r):
    d = run(r)['result']; it = d['iterationsDone']; dur = r['encounter']['duration']
    p = d['raidMetrics']['parties'][0]['players'][0]
    pet = sum((x.get('dps') or {}).get('avg', 0) for x in p.get('pets', []))
    res = p['resources']
    mana = sum(x.get('actualGain', 0) for x in res if x['type'] == 'ResourceTypeMana') / it
    hp = sum(x.get('actualGain', 0) for x in res if x['type'] == 'ResourceTypeHealth') / it
    dot = sum(t.get('tickDamage', 0) for a in p['actions'] for t in a.get('targets', [])) / it / dur
    return {'dps': p['dps']['avg'], 'pet': pet, 'mana': mana, 'hp': hp, 'dot': dot}

def kph(C, L, gear, wpn, talents, bonus=None, cal=None, verbose=False, strike=None, travel=10.0, wand=0.0):
    cals = cal if cal else {}
    tot = 0.0
    for gap, wt in MIX.items():
        k, c = kph1(C, L, gear, wpn, talents, bonus, cals.get(gap), verbose, strike, travel, gap, wand)
        cals[gap] = c; tot += wt * k
    return tot, cals

def kph1(C, L, gear, wpn, talents, bonus, cal, verbose, strike, travel, gap, wand=0.0):
    e = EXP[max(10, min(63, L + gap))]; mobhp = float(e['CreatureHealth'])
    const = consts(C, L, gear, wpn, talents)
    R = lambda dur, it=None: request(C, L, gear, wpn, talents, dur, bonus, it, gap, const, strike)
    if cal is None:
        dur = 20.0
        for _ in range(2):
            f = fight(R(dur)); dur = max(6.0, min(60.0, round(mobhp / max(1.0, f['dps'] + f['pet']), 1)))
    else: dur = cal['dur']
    f = fight(R(dur))
    prep = run(R(dur, 1), 'prepare')['player']
    regen = prep['mana']['regen_per_second_not_casting'] if prep.get('mana') else 0.0
    maxm = prep['mana']['max'] if prep.get('mana') else 0.0
    maxh = prep['stats']['Health']
    dS = max(1.0, f['dps'] + f['pet']); mS = max(0.0, -f['mana'] / dur); hS = max(0.0, -f['hp'] / dur)
    ps = prep['stats']
    d, fo = rate(DRINK, L) + regen, rate(FOOD, L)
    armor = prep['stats']['Armor']
    red = armor / (armor + 400.0 + 85.0 * (L + gap))
    mob = float(e['CreatureAutoAttackDps']) * 0.92 * (1 - red)
    if not C.get('pet_tanks', lambda L: False)(L) and not C.get('tank_engine', True):
        # the engine can't sim this class being hit (an aura it can't follow): the mob's swings, worked out here
        avoid = min(0.6, 0.05 + (ps.get('DodgePercent', 0) + ps.get('ParryPercent', 0)) / 100.0)
        hS = mob * (1 - avoid)
    hitters = 1 if C.get('pet_tanks', lambda L: False)(L) else 2
    Dadd = mob * hitters * 2 * mobhp / dS
    have = 0.85 * maxh
    pdeath = 0.5 * (1 + math.erf((Dadd - have) / (0.35 * Dadd * math.sqrt(2)))) if Dadd > 0 else 0.0
    if cal is None:
        cyc = mobhp / dS + travel + 15.0
        cal = {'dur': dur, 'addc': min(0.5, DEATHS_PER_HOUR * cyc / 3600.0 / pdeath) if pdeath > 1e-9 else 0.0}
    death = cal['addc'] * pdeath * DEATH_COST
    if C.get('ranged'):   # the first casts land while the mob runs at you: no swings for APPROACH seconds
        T0 = mobhp / dS; hS *= max(0.0, T0 - APPROACH) / T0
    if C.get('shadowform') and L >= 40: hS *= 0.85        # Shadowform: 15% less physical damage taken (client spell 15473)
    absorb = shield_mana = 0.0
    if C.get('pws'):                                       # Power Word: Shield before each pull
        rk = [x for x in PWS if x[0] <= L]
        if rk: absorb = rk[-1][1] + 0.1 * ps.get('SpellDamage', 0); shield_mana = rk[-1][2]
    if C.get('spirit_tap') and L >= 15:   # Forever Spirit Tap: double Spirit for 15 s after a kill (travel + first rest)
        regen *= 2.0
    crit = prep['stats']['SpellCritPercent'] / 100.0
    Wd = wand * 0.95 * (1 + 0.5 * crit)                         # wand: no mana, not helped by spell power
    dW = Wd + f['pet'] + f['dot']                                # while wanding, pet and dots keep going
    best = None
    for frac in ([0.0, 0.2, 0.4, 0.6] if wand else [0.0]):      # share of the mob's health done while wanding
        ts = (1 - frac) * mobhp / dS; tw = frac * mobhp / dW if frac else 0.0
        T = ts + tw
        Mk = max(0.0, mS * ts + shield_mana - regen * travel); Hk = max(0.0, hS * T - absorb)    # per kill
        t = max(Mk / d if d else 0.0, Hk / fo)                  # eat and drink at once
        n = min(maxm / Mk if Mk > 0 else 50.0, 0.6 * maxh / Hk if Hk > 0 else 50.0, 50.0)
        n = max(1.0, n)
        rest = t + REST_STOP / n
        k = 3600.0 / (T + travel + rest + death)
        if best is None or k > best[0]: best = (k, frac, T, Mk, Hk, rest, n)
    k, frac, T, Mk, Hk, rest, n = best
    if verbose:
        print('  L%d%+d dps %.1f pet %.1f wand %.0f%% | kill %.1fs mana/kill %.0f hp/kill %.0f rest %.1fs (%.1f kills/stop) death %.1fs (p %.2f) -> %.1f kills/h'
              % (L, gap, f['dps'], f['pet'], frac * 100, T, Mk, Hk, rest, n, death, pdeath, k))
    return k, cal
