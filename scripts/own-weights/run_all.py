import os, sys, json, time, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lvl, os
lvl.TMP = os.path.join(lvl.OUT, 'req_%d.json' % os.getpid())
import runner, classes
# tanks and healers: tank_heal.py (dungeon pulls per hour)
ROLE = {('WARRIOR', 'protection'), ('PALADIN', 'protection'), ('PALADIN', 'holy'), ('DRUID', 'bear'), ('DRUID', 'restoration'),
        ('PRIEST', 'holy'), ('PRIEST', 'discipline'), ('SHAMAN', 'restoration')}
failed = []
args = sys.argv[1:]
only = [a.split(':')[1] for a in args if ':' in a]
which = [a.split(':')[0] for a in args] or list(classes.ALL)
for cls in which:
    out, infos = {}, {}
    try: out = json.load(open(os.path.join(lvl.OUT, 'out_%s.json' % cls.lower())))[cls]; infos = json.load(open(os.path.join(lvl.OUT, 'info_%s.json' % cls.lower())))
    except Exception: pass
    for spec, C in classes.ALL[cls].items():
        if only and spec not in only: continue
        if (cls, spec) in ROLE: continue
        t0 = time.time()
        try:
            out[spec], infos[spec] = runner.run(C)
        except Exception as e:
            print(cls, spec, 'FAILED', str(e)[-400:], flush=True); traceback.print_exc(); failed.append((cls, spec)); continue
        print(cls, spec, 'done %.0fs' % (time.time() - t0), flush=True)
        json.dump({cls: out}, open(os.path.join(lvl.OUT, 'out_%s.json' % cls.lower()), 'w'), indent=1)
        json.dump(infos, open(os.path.join(lvl.OUT, 'info_%s.json' % cls.lower()), 'w'), indent=1, default=str)
sys.exit(1 if failed else 0)
