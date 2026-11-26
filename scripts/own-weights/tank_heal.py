#!/usr/bin/env python3
"""Tank and healer leveling weights: dungeon pulls per hour.

A leveling dungeon pull (assumptions, flagged on the site): 3 elite mobs a level above you, each with ELITE_HP times
a normal mob's health and ELITE_DMG times its damage; a group of 3 damage dealers who kill a normal same-level mob in
13 s each solo; travel between pulls. The group can't out-damage the tank's threat. After a pull the healer drinks back
the mana spent healing the tank. A pull goes wrong (wipe) when a burst of hits gets past the tank's health (tanks) or
when healing can't keep up (healers); the chance is set so a typical group wipes WIPES_PER_HOUR times an hour, then
held fixed while a stat changes. Stat weight = extra pulls per hour per point, scaled so the reference stat is 1.
"""
import os
import copy, json, math, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lvl, gen, runner, classes, apls
from lvl import EXP, DRINK, FOOD, rate, run
from run_class import talents_at, smooth, LEVELS, FIRST

PULL_MOBS, ELITE_HP, ELITE_DMG, MOB_GAP = 3, 2.5, 1.5, 1
SOLO_KILL = 13.0       # seconds a typical damage dealer takes on one normal same-level mob (our damage sims: 10-16 s)
TRAVEL = 15.0          # seconds between pulls
WIPES_PER_HOUR, WIPE_COST = 0.5, 300.0   # a wipe: run back, rebuff, drink up (about 5 minutes)
REST_SHARE = 0.25     # the typical healer drinks about a quarter of the dungeon time: sets how hard elites hit at each level
HPM_DEFAULT = 2.0      # healing per mana for the tank model until the healer sims give one
SIM_DUR = 30.0

Z0, SIG = -1.5, 0.35   # a typical group loses about 7% of its bad pulls; 35% more margin is one standard step safer

def wipe_chance(x, x_ref):
    """Chance a bad pull wipes for a margin x (tank: seconds alive with no heals; healer: healing in one mana bar), with the
    typical character's margin x_ref at Z0 standard steps."""
    z = Z0 + (1.0 - x / x_ref) / SIG
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))

def mob(L): return EXP[max(10, min(63, L + MOB_GAP))]
def pull_hp(L): return PULL_MOBS * ELITE_HP * float(mob(L)['CreatureHealth'])
def group_dps(L): return 3 * float(EXP[L]['CreatureHealth']) / SOLO_KILL

def tank_request(C, L, gear, wpn, tal, bonus, const, iters=None, strike=None):
    r = gen.request(C, L, gear, wpn, tal, SIM_DUR, bonus, iters, MOB_GAP, const, strike)
    t0 = r['encounter']['targets'][0]; e = mob(L)
    t0['minBaseDamage'] = round(float(e['CreatureAutoAttackDps']) * 2.0 * ELITE_DMG, 2)
    t0['stats'][32] = float(e['CreatureHealth']) * ELITE_HP * 50     # never dies inside the fixed fight
    r['encounter']['targets'] = []
    for i in range(PULL_MOBS):
        t = copy.deepcopy(t0); t['tankIndex'] = 0; r['encounter']['targets'].append(t)
    r['raid']['tanks'] = [{'type': 'Player', 'index': 0}]
    return r

def tank_fight(r):
    d = run(r)['result']; it = d['iterationsDone']; dur = r['encounter']['duration']
    p = d['raidMetrics']['parties'][0]['players'][0]
    tps = (p.get('threat') or {}).get('avg', 0.0)
    res = p['resources']
    mana = sum(x.get('actualGain', 0) for x in res if x['type'] == 'ResourceTypeMana') / it
    dtps = (p.get('dtps') or {}).get('avg', 0.0)
    return {'dps': p['dps']['avg'], 'tps': tps, 'dtps': dtps, 'mana': -mana / dur}

def tank_pph(C, L, g, wpn, tal, bonus=None, cal=None, hpm=HPM_DEFAULT, verbose=False, strike=None):
    const = gen.consts(C, L, g, wpn, tal)
    f = tank_fight(tank_request(C, L, g, wpn, tal, bonus, const, strike=strike))
    prep = run(tank_request(C, L, g, wpn, tal, bonus, const, 1), 'prepare')['player']
    maxh = prep['stats']['Health']
    G = min(group_dps(L), f['tps']) + f['dps']          # the group holds back to the tank's threat
    T = pull_hp(L) / G
    heal_mana = f['dtps'] * T / hpm
    tank_mana = max(0.0, f['mana'] * T - (prep['mana']['regen_per_second_not_casting'] if prep.get('mana') else 0) * TRAVEL)
    rest = max(heal_mana, tank_mana) / rate(DRINK, L)
    ttd = maxh / max(1.0, f['dtps'])                     # seconds the tank lives with no heals: the margin on a bad pull
    if cal is None: cal = {'x': ttd}
    pw = wipe_chance(ttd, cal['x'])
    if 'k' not in cal: cal['k'] = WIPES_PER_HOUR * (T + rest + TRAVEL) / 3600.0 / pw
    wipe = cal['k'] * pw * WIPE_COST
    pph = 3600.0 / (T + rest + TRAVEL + wipe)
    if verbose:
        print('  L%d tank dps %.0f tps %.0f dtps %.0f hp %d | group %.0f pull %.1fs rest %.1fs wipe %.1fs (p %.2f) -> %.1f pulls/h'
              % (L, f['dps'], f['tps'], f['dtps'], maxh, G, T, rest, wipe, pw, pph))
    return pph, cal, f

def heal_request(C, L, gear, wpn, tal, bonus, const, iters=None):
    r = gen.request(C, L, gear, wpn, tal, SIM_DUR, bonus, iters, 0, const)
    r['raid'].pop('tanks', None)
    for t in r['encounter']['targets']: t.pop('tankIndex', None)
    return r

BIG_MANA = 100000.0
PCT_MAX_MANA = {408511}   # Water Shield globe: 2% of maximum mana (scaled back from the bottomless bar below)

def heal_fight(r, maxm=None):
    d = run(r)['result']; it = d['iterationsDone']; dur = r['encounter']['duration']
    p = d['raidMetrics']['parties'][0]['players'][0]
    mana = 0.0
    for x in p['resources']:
        if x['type'] != 'ResourceTypeMana': continue
        g = x.get('actualGain', 0)
        if maxm and (x.get('id') or {}).get('spellId') in PCT_MAX_MANA: g *= maxm / (maxm + BIG_MANA)
        mana += g
    mana /= it
    return {'hps': (p.get('hps') or {}).get('avg', 0.0), 'mana': max(1e-6, -mana / dur)}

def heal_pph(C, L, g, wpn, tal, dtps, bonus=None, cal=None, verbose=False, hpm_only=False):
    const = gen.consts(C, L, g, wpn, tal)
    # healing per mana from a fight with a bottomless mana bar: running dry mid-fight would mix in which spell fits the last mana
    prep = run(heal_request(C, L, g, wpn, tal, bonus, const, 1), 'prepare')['player']
    regen = prep['mana']['regen_per_second_not_casting']; maxm = prep['mana']['max']
    f = heal_fight(heal_request(C, L, g, wpn, tal, dict(bonus or {}, mana=(bonus or {}).get('mana', 0) + BIG_MANA), const), maxm)
    hpm = f['hps'] / f['mana']
    if hpm_only: return hpm, regen
    T = pull_hp(L) / group_dps(L)
    need = dtps * T                                       # healing the pull needs
    M = max(0.0, need / hpm - regen * TRAVEL)
    rest = M / (rate(DRINK, L) + regen)
    n = max(1.0, min(50.0, maxm / M if M > 0 else 50.0))
    rest += 4.0 / n                                       # sitting down to drink
    maxh = prep['stats']['Health']
    bar = maxm * hpm                                       # healing in one full mana bar: how long a bad pull can last
    x = bar * (maxh / cal['h'] if cal else 1.0) ** 0.25   # small part: living through a few hits when the pull turns on you
    if cal is None: cal = {'x': bar, 'h': maxh}
    pw = wipe_chance(x, cal['x'])
    if 'k' not in cal: cal['k'] = WIPES_PER_HOUR * (T + rest + TRAVEL) / 3600.0 / pw
    wipe = cal['k'] * pw * WIPE_COST
    pph = 3600.0 / (T + rest + TRAVEL + wipe)
    if verbose:
        print('  L%d heal hps %.0f mana/s %.1f hpm %.2f | tank dtps %.0f pull %.1fs rest %.1fs wipe %.1fs (p %.3f) -> %.1f pulls/h'
              % (L, f['hps'], f['mana'], hpm, dtps, T, rest, wipe, pw, pph))
    return pph, cal, hpm

TANK_SITE = {'mhitP': ['hitPct'], 'mcritP': ['critPct'], 'ap': ['atkpwr'], 'def': ['defrtng'], 'dodgeP': ['dodgePct'], 'parryP': ['parryPct'],
             'armor': ['armor', 'armorbonus'], 'int': ['int'], 'sp': ['splpwr', 'spldmg', 'holsplpwr'], 'blockP': ['blockPct'], 'blockv': ['block'], 'mp5': ['manargn']}
HEAL_SITE = {'heal': ['splheal', 'splpwr'], 'mp5': ['manargn'], 'critP': ['critPct']}

def tank_weights(C, L, hpm=HPM_DEFAULT):
    g = gear_at(C, L); wpn, wn = runner.weapons(C, L) or ({}, [])
    tal = talents_at(C['talents'], C['main'], L)
    k0, cal, f0 = tank_pph(C, L, g, wpn, tal, hpm=hpm, verbose=True)
    out = {}
    for s, d in C['delta'].items():
        k, _, _ = tank_pph(C, L, g, wpn, tal, bonus={s: d}, cal=cal, hpm=hpm); out[s] = (k - k0) / d
    if gen.MH in wpn and wpn[gen.MH][2] in ('1h', '2h'):     # weapon damage: tank damage and threat
        dmg = gen.STRIKE[wpn[gen.MH][2]][1]
        spd = C.get('form_speed') or next(x['w'][1] for x in runner.DB['items'] if x['i'] == wpn[gen.MH][0])
        k, _, _ = tank_pph(C, L, g, wpn, tal, cal=cal, strike={gen.MH}, hpm=hpm); out['dps'] = (k - k0) / (dmg / spd)
    ref = out[C['ref']] or 1e-9
    res = {}
    for s, v in out.items():
        for key in TANK_SITE.get(s, [s]) + (['feratkpwr'] if s == 'ap' and C['cls'] == 'DRUID' else []):
            res[key] = round(max(0.0, v / ref), 3)
    return res, {'pph': round(k0, 1), 'dtps': round(f0['dtps'], 1), 'talents': tal, 'weapons': wn}

def heal_weights(C, L, dtps):
    g = gear_at(C, L, heal=True); wpn, wn = runner.weapons(C, L) or ({}, [])
    tal = talents_at(C['talents'], C['main'], L)
    k0, cal, hpm = heal_pph(C, L, g, wpn, tal, dtps, verbose=True)
    out = {}
    for s, d in C['delta'].items():
        b = {s: d}
        k, _, _ = heal_pph(C, L, g, wpn, tal, dtps, bonus=b, cal=cal); out[s] = (k - k0) / d
    ref = out[C['ref']] or 1e-9
    res = {}
    for s, v in out.items():
        for key in HEAL_SITE.get(s, [s]): res[key] = round(max(0.0, v / ref), 3)
    return res, {'pph': round(k0, 1), 'hpm': round(hpm, 2), 'talents': tal, 'weapons': wn}

# ---- engine stat slots and item keys tanks/healers need (not used by the damage sims) ----
gen.STAT.update({'blockv': 27, 'mana': 33})
gen.PSEUDO.update({'dodgeP': [4], 'parryP': [5], 'blockP': [16]})
import kit
kit.KEYMAP.update({'defrtng': 'def', 'dodgePct': 'dodgeP', 'parryPct': 'parryP', 'blockPct': 'blockP', 'block': 'blockv', 'armorbonus': 'armor'})

def gear_at(C, L, heal=False):
    """Typical kit for the level (same picker as the damage sims). Healers: "+healing" goes to healing power; "+damage and
    healing" items give both (as in game)."""
    g, _ = kit.kit(C['cls'], C['spec'], L)
    out = {}
    for k, v in g.items():
        if k == 'heal' and not heal: continue
        k = runner.PHYS.get(k, k) if C['phys'] else k
        if k in gen.STAT or k in gen.PSEUDO: out[k] = out.get(k, 0) + v
    if heal and out.get('sp'): out['heal'] = out.get('heal', 0) + out['sp']
    return {k: (round(v * 2) / 2 if k in gen.PSEUDO else round(v)) for k, v in out.items() if round(v * 2)}

TD = {'str': 10, 'agi': 10, 'ap': 20, 'sta': 30, 'mhitP': 2, 'mcritP': 2, 'armor': 200, 'def': 10, 'dodgeP': 1, 'parryP': 1, 'blockP': 1, 'blockv': 20}
BEAR_D = {k: v for k, v in TD.items() if k not in ('parryP', 'blockP', 'blockv')}
HD = {'heal': 50, 'int': 20, 'spi': 20, 'mp5': 10, 'critP': 2, 'sta': 30}

def unmana(rot):
    """Drop "only above N% mana" conditions: the healer always uses its main heal, so a bigger mana bar doesn't change
    which spells it casts (that would mix spell choice into healing per mana)."""
    r = copy.deepcopy(rot)
    for x in r['priorityList']:
        c = x['action'].get('condition')
        if c and 'currentManaPercent' in json.dumps(c) and 'cmp' in c: x['action'].pop('condition')
    return r

def role(C, **kw):
    c = dict(C); c.update(kw); return c

def configs():
    A = classes.ALL; T = classes.tapl
    tanks = {
        ('WARRIOR', 'protection'): role(A['WARRIOR']['protection'], delta=TD, ref='ap'),
        ('PALADIN', 'protection'): role(A['PALADIN']['protection'], tmpl='protection-paladin-L27', opts_key='protectionPaladin',
                                        rot=T('protection-paladin-L27'), delta=dict(TD, int=20, sp=20, spi=20, mp5=10), ref='sp'),
        ('DRUID', 'bear'): role(A['DRUID']['bear'], delta=BEAR_D, ref='ap'),
    }
    H = dict(phys=False, delta=HD, ref='heal', wand=False, ranged=True, pws=False, tank_engine=False)
    heals = {
        ('PRIEST', 'holy'): role(A['PRIEST']['holy'], tmpl='holy-priest-L30', opts_key='healerPriest', rot=unmana(T('holy-priest-L30')), **H),
        ('PRIEST', 'discipline'): role(A['PRIEST']['discipline'], tmpl='holy-priest-L30', opts_key='healerPriest', rot=unmana(T('holy-priest-L30')), **H),
        ('PALADIN', 'holy'): role(A['PALADIN']['holy'], tmpl='holy-paladin-L30', opts_key='holyPaladin', rot=unmana(T('holy-paladin-L30')), **H),
        ('SHAMAN', 'restoration'): role(A['SHAMAN']['restoration'], tmpl='restoration-shaman-L42', opts_key='restorationShaman',
                                        rot=unmana(T('restoration-shaman-L42')), **H),
        ('DRUID', 'restoration'): role(A['DRUID']['restoration'], tmpl='restoration-druid-L30', opts_key='restorationDruid',
                                       rot=unmana(T('restoration-druid-L30')), **H),
    }
    return tanks, heals

def hpm_at(C, L):
    g = gear_at(C, L, heal=True); wpn, _ = runner.weapons(C, L) or ({}, [])
    return heal_pph(C, L, g, wpn, talents_at(C['talents'], C['main'], L), 0.0, hpm_only=True)

def run_all(only=None):
    """Healers' healing per mana -> tanks (healer mana per damage taken) -> tanks' damage taken -> healers."""
    tanks, heals = configs()
    want = lambda k: not only or ('%s:%s' % k) in only
    res = {k: ([], {}) for k in list(tanks) + list(heals) if want(k)}
    for up, L in [FIRST] + LEVELS:
        t0 = time.time()
        global ELITE_DMG
        ELITE_DMG = 1.5
        hr = [hpm_at(C, L) for C in heals.values()]
        hpm = sum(h for h, _ in hr) / len(hr); regen = sum(r for _, r in hr) / len(hr)
        base = []
        for k, C in tanks.items():
            g = gear_at(C, L); wpn, _ = runner.weapons(C, L) or ({}, [])
            base.append(tank_pph(C, L, g, wpn, talents_at(C['talents'], C['main'], L), hpm=hpm)[2]['dtps'])
        # scale elite damage so the typical healer drinks REST_SHARE of the time (elites and party damage grow with level)
        T = pull_hp(L) / group_dps(L); rest = REST_SHARE / (1 - REST_SHARE) * (T + TRAVEL)
        want_dtps = (rest * (rate(DRINK, L) + regen) + regen * TRAVEL) * hpm / T
        ELITE_DMG = 1.5 * want_dtps / (sum(base) / len(base))
        dt = []
        for k, C in tanks.items():
            if not want(k):     # only its damage taken, for the healers
                g = gear_at(C, L); wpn, _ = runner.weapons(C, L) or ({}, [])
                dt.append(tank_pph(C, L, g, wpn, talents_at(C['talents'], C['main'], L), hpm=hpm)[2]['dtps']); continue
            w, i = tank_weights(C, L, hpm); dt.append(i['dtps'])
            if want(k): res[k][0].append([up, w]); res[k][1][L] = dict(i, hpm_ref=round(hpm, 2), elite_dmg=round(ELITE_DMG, 2))
        dtps = sum(dt) / len(dt)
        for k, C in heals.items():
            if not want(k): continue
            w, i = heal_weights(C, L, dtps); res[k][0].append([up, w]); res[k][1][L] = dict(i, dtps_ref=round(dtps, 1), elite_dmg=round(ELITE_DMG, 2))
        print('L%d done %.0fs (hpm %.2f, elite dmg x%.2f, tank dtps %.0f)' % (L, time.time() - t0, hpm, ELITE_DMG, dtps), flush=True)
    return {k: ({'source': 'own-sim', 'role': 'tank' if k in tanks else 'healer', 'b': smooth(b)}, info) for k, (b, info) in res.items()}

if __name__ == '__main__':
    import os
    lvl.TMP = os.path.join(lvl.OUT, 'req_role_%d.json' % os.getpid()); lvl.ITERS = int(os.environ.get('ITERS', 3000))
    R = run_all(sys.argv[1:] or None)
    import fcntl
    lock = open(os.path.join(lvl.OUT, '.save.lock'), 'w'); fcntl.flock(lock, fcntl.LOCK_EX)   # other processes save too
    for (cls, spec), (o, info) in R.items():
        f = os.path.join(lvl.OUT, 'out_%s.json' % cls.lower()); fi = os.path.join(lvl.OUT, 'info_%s.json' % cls.lower())
        out = json.load(open(f)) if os.path.exists(f) else {cls: {}}; infos = json.load(open(fi)) if os.path.exists(fi) else {}
        out[cls][spec] = o; infos[spec] = info
        json.dump(out, open(f, 'w'), indent=1); json.dump(infos, open(fi, 'w'), indent=1, default=str)
        print(cls, spec, 'saved')
