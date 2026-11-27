#!/usr/bin/env python3
"""Collect the sims' brackets (out_<class>.json) into own_weights.json and, with --into gear_db.json, put them in the Gear
upgrades data (W: class -> spec -> {'b': [[up to level, {stat: weight}], ...]}) so the page scores items with our weights."""
import datetime, glob, json, os, subprocess, sys
WM = os.path.dirname(os.path.abspath(__file__))
ENG = os.environ['MSE_ENGINE']
WAND = {'MAGE', 'PRIEST', 'WARLOCK'}

def aliases(st):
    """Item stats the sims test as one stat: spell-only crit (splcritPct) is a caster's or healer's crit; ranged-only hit
    (rgdhitPct) is a ranged hunter's hit (the sims put hit on melee and ranged at once)."""
    if 'critPct' in st and 'splpwr' in st and 'atkpwr' not in st: st.setdefault('splcritPct', st['critPct'])
    if 'hitPct' in st and 'rgdatkpwr' in st: st.setdefault('rgdhitPct', st['hitPct'])
    return st


def collect():
    W = {}
    for f in sorted(glob.glob(os.path.join(os.environ.get('OW_OUT', os.path.join(WM, 'out')), 'out_*.json'))):
        for cls, specs in json.load(open(f)).items():
            for spec, v in specs.items():
                b = []
                for up, st in v['b']:
                    st = dict(st)
                    if cls in WAND and 'wandDps' in st and 'rangedDps' not in st: st['rangedDps'] = st.pop('wandDps')  # a wand is the ranged slot
                    st.pop('wandDps', None)
                    if cls == 'DRUID' and 'atkpwr' in st: st.setdefault('feratkpwr', st['atkpwr'])   # "+N Attack Power in Cat, Bear..." forms
                    aliases(st)
                    b.append([up, {k: round(x, 2) for k, x in st.items() if round(x, 2) > 0}])
                W.setdefault(cls, {})[spec] = {'b': b, 'role': v.get('role', 'damage')}
    commit = subprocess.run(['git', '-C', ENG, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    man = json.load(open(os.path.join(ENG, 'data/manifest.json')))
    meta = {'date': datetime.date.today().isoformat(), 'engine': 'MythicSim Forever engine (MIT)', 'commit': commit[:12],
            'build': man.get('client_build', ''),
            'model': 'leveling: kills per hour (damage), dungeon pulls per hour (tanks, healers)'}
    return {'meta': meta, 'W': W}

if __name__ == '__main__':
    out = collect()
    dst = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(WM, 'own_weights.json')
    json.dump(out, open(dst, 'w'), indent=1)
    print('wrote', dst, sum(len(v) for v in out['W'].values()), 'specs', out['meta'])
    if '--into' in sys.argv:
        p = sys.argv[sys.argv.index('--into') + 1]; D = json.load(open(p))
        miss = [(c, s) for c, v in D['W'].items() for s in v if s not in out['W'].get(c, {})]
        assert not miss, 'no own weights for %s' % miss
        D['W'] = {c: {s: {'b': x['b']} for s, x in v.items()} for c, v in out['W'].items()}
        D['meta']['weights'] = out['meta']
        json.dump(D, open(p, 'w'), separators=(',', ':')); print('merged into', p)
