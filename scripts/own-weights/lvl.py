#!/usr/bin/env python3
"""Leveling stat weights from the MythicSim Forever engine: kills per hour per stat point (test run)."""
import copy, csv, json, subprocess, sys, os
ENG = os.environ['MSE_ENGINE']
BIN = ENG + '/target/release/forever-engine'
OUT = os.environ.get('OW_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'))
os.makedirs(OUT, exist_ok=True)
TMP = os.path.join(OUT, 'req.json')
W = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data') + '/'
TEMPLATE = json.load(open(ENG + '/fixtures/levels/affliction-warlock-L30.request.json'))
GO = json.load(open(ENG + '/data/go-tables.json'))
EXP = {int(r['Lvl']): r for r in csv.DictReader(open(W + 'ExpectedStat.csv')) if r['ExpansionID'] == '-2' and r['ContentSetID'] == '0'}
PES = {(int(r['Level']), int(r['ClassID'])): r for r in csv.DictReader(open(W + 'PlayerExpectedStat.csv'))}
STAT = {'str': 0, 'agi': 1, 'sta': 2, 'int': 3, 'heal': 4, 'sp': 5, 'shadow': 11, 'fire': 7, 'hitR': 12, 'critR': 13, 'spi': 16,
        'ap': 17, 'armor': 30, 'mp5': 34}
WAND = 0
LIFE_TAP = [(6, 20), (16, 65), (26, 130), (36, 210), (46, 300), (56, 420)]  # Forever client SpellEffect base
TAP_BASE = True
TANK_PETS = {'Voidwalker', 'Felguard'}
PSEUDO = {'hitP': 13, 'critP': 15, 'mhitP': 12, 'mcritP': 14}
# drinks / food (Forever client: ItemEffect -> SpellEffect, per 5 s; usable level)
# best vendor drink/food usable at each level (Forever client ItemSparse.RequiredLevel; amount per 5 s from the item's spell)
# Refreshing Spring Water, Ice Cold Milk, Melon Juice, Sweet Nectar, Moonberry Juice, Morning Glory Dew
DRINK = [(1, 42), (5, 104), (15, 174), (25, 249), (35, 332), (45, 489)]
# Tough Hunk of Bread, Freshly Baked Bread, Moist Cornbread, Mulgore Spice Bread, Soft Banana Bread, Homemade Cherry Pie
FOOD = [(1, 17), (5, 58), (15, 115), (25, 162), (35, 232), (45, 358)]
rate = lambda tab, L: max([v for lv, v in tab if lv <= L] or [tab[0][1]]) / 5.0
# Orc warlock: level 1 = classic character creation (approx.), 60 = engine's go-tables base
L1 = {'str': 23, 'agi': 17, 'sta': 23, 'int': 19, 'spi': 25}

def base_attrs(L, cls='ClassWarlock', race='RaceOrc'):
    b60 = GO['base_stats'][cls][race]; key = {'str': 'Strength', 'agi': 'Agility', 'sta': 'Stamina', 'int': 'Intellect', 'spi': 'Spirit'}
    f = ((L - 1) / 59.0) ** 1.24   # same in-game-fitted growth curve as gen.base_attrs
    return {k: round(L1[k] + (b60[key[k]] - L1[k]) * f) for k in key}, b60

ITERS = 1000
GAP = 0   # mob level minus player level for the current run
MIX = {-1: 0.25, 0: 0.5, 1: 0.25}   # typical questing pulls: mostly your level, some a level below/above (assumption)

def request(L, gear, talents, summon, rotation, dur, bonus=None, iters=None):
    iters = iters or ITERS
    r = copy.deepcopy(TEMPLATE)
    r['encounter']['duration'] = dur; r['encounter']['durationVariation'] = 0
    t = r['encounter']['targets'][0]; M = max(10, min(63, L + GAP)); e = EXP[M]
    t['level'] = M; t['name'] = 'Level %d mob' % M
    st = [0.0] * len(t['stats']); st[30] = float(e['CreatureArmor']); st[32] = float(e['CreatureHealth']); t['stats'] = st
    t['minBaseDamage'] = float(e['CreatureAutoAttackDps']) * 2.0; t['swingSpeed'] = 2.0
    if summon not in TANK_PETS:
        r['raid']['tanks'] = [{'type': 'Player', 'index': 0}]; t['tankIndex'] = 0
    p = r['raid']['parties'][0]['players'][0]
    p['level'] = L; p['race'] = 'RaceOrc'; p['talentsString'] = talents; p['equipment'] = {'items': [{} for _ in range(16)] + [{'id': WAND}] if WAND else []}
    p['warlock']['options']['classOptions'] = {'armor': 'DemonArmor', 'summon': summon}
    p['rotation'] = rotation; p['consumables'] = {}; p.pop('profession1', None)
    p['inFrontOfTarget'] = True   # the mob faces its tank (the pet): pet attacks can be parried
    base, b60 = base_attrs(L)
    allg = dict(gear)
    for k, v in (bonus or {}).items(): allg[k] = allg.get(k, 0) + v
    tot = {k: base[k] + allg.get(k, 0) for k in base}
    pes = PES[(L, 9)]; e = EXP[L]
    hp_base = b60['Health'] * float(e['PlayerHealth']) / float(EXP[60]['PlayerHealth'])
    sheet = {'attributes': [tot['str'], tot['agi'], tot['sta'], tot['int'], tot['spi']],
             'base': [base['str'], base['agi'], base['sta'], base['int'], base['spi']],
             'equipment': {'items': []}, 'level': L,
             'health': round(hp_base + 10 * tot['sta']), 'mana': round(float(pes['BaseMana']) + 15 * tot['int']),
             'meleeCrit': 2.0 + allg.get('mcritP', 0), 'spellCrit': [round(b60['SpellCritPercent'] + 100 * tot['int'] * float(pes['SpellCritPerIntellect']) + allg.get('critP', 0), 4)] * 6}
    p['characterSheet'] = sheet
    bs = [0.0] * 41
    ps = [0.0] * 30
    for k, v in allg.items():
        if k in PSEUDO: ps[PSEUDO[k]] += v
        else: bs[STAT[k]] += v
    p['bonusStats'] = {'stats': bs, 'pseudoStats': ps}
    r['simOptions'] = {'iterations': iters, 'randomSeed': '42'}
    return r

def run(r, cmd='sim'):
    json.dump(r, open(TMP, 'w'))
    out = subprocess.run([BIN, cmd, '--request', TMP], capture_output=True, text=True)
    if out.returncode: raise RuntimeError(out.stdout[-2000:] + out.stderr[-2000:])
    return json.loads(out.stdout)

def fight(r):
    d = run(r)['result']; it = d['iterationsDone']
    p = d['raidMetrics']['parties'][0]['players'][0]
    pet = sum((x.get('dps') or {}).get('avg', 0) for x in p.get('pets', []))
    mana = sum(x.get('actualGain', 0) for x in p['resources'] if x['type'] == 'ResourceTypeMana') / it
    hp = sum(x.get('actualGain', 0) for x in p['resources'] if x['type'] == 'ResourceTypeHealth') / it
    return {'dps': p['dps']['avg'], 'pet': pet, 'mana': mana, 'hp': hp}

import math
ADD_CHANCE = 0.10   # share of pulls where a second mob joins (assumption, only used without calibration)
DEATHS_PER_HOUR = 0.5  # baseline: a typical character dies about once per 2 hours of questing (assumption);
                       # the add chance is set per level so the baseline matches, then held fixed for the stat tests
DEATH_COST = 150.0 # seconds lost per death: corpse run, rez, rest (assumption)
REST_STOP = 4.0   # seconds to sit down, eat/drink, buff, stand up: once per rest stop

DOTS = {11712, 11671, 11713, 25311, 172, 980}   # warlock CoA / Corruption ranks seen (by id the engine reports)

def fight_full(r):
    d = run(r)['result']; it = d['iterationsDone']; dur = r['encounter']['duration']
    p = d['raidMetrics']['parties'][0]['players'][0]
    pet = sum((x.get('dps') or {}).get('avg', 0) for x in p.get('pets', []))
    res = p['resources']
    mana = sum(x.get('actualGain', 0) for x in res if x['type'] == 'ResourceTypeMana') / it
    hp = sum(x.get('actualGain', 0) for x in res if x['type'] == 'ResourceTypeHealth') / it
    dot = 0.0
    for a in p['actions']:
        sid = a['id'].get('spellId')
        if sid in DOTS or (a['id'].get('tag') in (1, 2) and sid is not None and sid in DOTS):
            dot += sum(t.get('damage', 0) for t in a.get('targets', [])) / it
    return {'dps': p['dps']['avg'], 'pet': pet, 'mana': mana, 'hp': hp, 'dot': dot / dur}

def kph(L, gear, talents, summon, rot, bonus=None, travel=10.0, verbose=False, dur=None, tap=1.0, wand=0.0):
    """Kills per hour averaged over the MIX of mob levels. dur: None (calibrate) or the dict this returned for the baseline."""
    global GAP
    cals = dur if isinstance(dur, dict) and 'mix' in dur else {'mix': {}}
    tot = 0.0
    for gap, wt in MIX.items():
        GAP = gap
        k, c = kph1(L, gear, talents, summon, rot, bonus, travel, verbose, cals['mix'].get(gap), tap, wand)
        cals['mix'][gap] = c; tot += wt * k
    GAP = 0
    return tot, cals

def kph1(L, gear, talents, summon, rot, bonus=None, travel=10.0, verbose=False, dur=None, tap=1.0, wand=0.0):
    e = EXP[max(10, min(63, L + GAP))]; mobhp = float(e['CreatureHealth'])
    cal = dur if isinstance(dur, dict) else None
    if cal: dur = cal['dur']
    if dur is None:
        dur = 20.0
        for _ in range(2):
            f = fight_full(request(L, gear, talents, summon, rot, dur, bonus))
            dur = max(6.0, min(60.0, round(mobhp / (f['dps'] + f['pet']), 1)))
    f = fight_full(request(L, gear, talents, summon, rot, dur, bonus))
    prep = run(request(L, gear, talents, summon, rot, dur, bonus, iters=1), 'prepare')['player']
    regen = prep['mana']['regen_per_second_not_casting']
    maxm, maxh = prep['mana']['max'], prep['stats']['Health']
    crit = prep['stats']['SpellCritPercent'] / 100.0
    W = wand * 0.95 * (1 + 0.5 * crit)                       # wand: no mana, not helped by spell power
    dS = f['dps'] + f['pet']; mS = -f['mana'] / dur; hS = -f['hp'] / dur
    dW = W + f['pet'] + f['dot']
    d, fo, c = rate(DRINK, L) + regen, rate(FOOD, L), tap
    hpr = max(0.0, 0.1034 * prep['stats']['Spirit'] + 1.293) / 2.0   # warlock health from Spirit out of combat (see gen.HP_PER_SPIRIT)
    fo += 1.5 * hpr                                            # x1.5 sitting, on top of food
    armor = prep['stats']['Armor']
    red = armor / (armor + 400.0 + 85.0 * (L + GAP))          # classic armor formula vs the mob's level
    mob = float(e['CreatureAutoAttackDps']) * 0.92 * (1 - red)   # one mob's damage per second on you
    hitters = 1 if summon in TANK_PETS else 2                  # with an add, how many mobs hit you
    Dadd = mob * hitters * 2 * mobhp / dS                      # two mobs take about twice as long
    have = 0.85 * maxh
    pdeath = 0.5 * (1 + math.erf((Dadd - have) / (0.35 * Dadd * math.sqrt(2)))) if Dadd > 0 else 0.0
    if cal is None:   # calibrate the add chance so this baseline dies DEATHS_PER_HOUR times an hour
        cyc = mobhp / dS + travel + 15.0
        addc = min(0.5, DEATHS_PER_HOUR * cyc / 3600.0 / pdeath) if pdeath > 1e-9 else 0.0
        cal = {'dur': dur, 'addc': addc}
    death = cal['addc'] * pdeath * DEATH_COST
    spirit = prep['stats']['Spirit']
    tr = [(lv, b) for lv, b in LIFE_TAP if lv <= L]
    tapb = (tr[-1][1] + (L - tr[-1][0])) if tr else 0   # Life Tap base + 1 per level above the rank (client SpellEffect PPL 1)
    best = None
    for frac in ([0.0, 0.2, 0.4, 0.6] if wand else [0.0]):   # share of the mob's health done while wanding
        ts = (1 - frac) * mobhp / dS; tw = frac * mobhp / dW if frac else 0.0
        T = ts + tw
        M = max(0.0, mS * ts - regen * travel); H = max(0.0, hS * T - hpr * travel)
        t = max(M / d, H / fo)                                # eat + drink, no tapping
        if TAP_BASE and c > 0 and M / d > (H / fo if H else 0):
            t1 = (M + c * H) / (d + c * fo)                    # tap health into mana while eating
            x = max(0.0, fo * t1 - H)                          # health tapped
            t1 += 1.5 * x / (c * (tapb + spirit))              # one 1.5 s cast per tap
            t = min(t, t1)
        per = M + c * H
        n = max(1.0, (maxm + c * 0.6 * maxh) / per) if per > 0 else 50.0
        rest = t + REST_STOP / n
        k = 3600.0 / (T + travel + rest + death)
        if best is None or k > best[0]: best = (k, frac, T, M, H, rest, n)
    k, frac, T, M, H, rest, n = best
    if verbose: print('  L%d%+d dps %.1f pet %.1f dot %.1f wand %.1f | wand share %.0f%% kill %.1fs mana/kill %.0f hp/kill %.0f rest %.1fs (%.1f kills/stop) death %.1fs (p %.2f) -> %.1f kills/h' % (L, GAP, f['dps'], f['pet'], f['dot'], W, frac * 100, T, M, H, rest, n, death, pdeath, k))
    return k, cal
