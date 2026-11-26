import os
import json, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_class import run
import lvl
lvl.TMP = os.path.join(lvl.OUT, "req_lock_%d.json" % os.getpid())
base = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'apl_lock3.json')))
destro = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'apl_destro.json')))
def pet(L): return 'Imp' if L < 10 else 'Voidwalker' if L < 20 else 'Succubus'
SPECS = {
  'affliction': {'talents': '05520320135201351--0550005003', 'main': 0},
  'demonology': {'talents': '02-0025003231020301351-0550005003', 'main': 1},
  'destruction': {'talents': '2522-0050203001-155030510310005', 'main': 2, 'rot': destro},
}
out = {}; infos = {}
for spec, c in SPECS.items():
    t0 = time.time()
    cfg = dict({'rot': base}, **c); cfg.update(cls='WARLOCK', spec=spec, pet=pet, wand=True)
    out[spec], infos[spec] = run(cfg)
    print(spec, 'done %.0fs' % (time.time() - t0), flush=True)
json.dump({'WARLOCK': out}, open(os.path.join(lvl.OUT, 'out_warlock.json'), 'w'), indent=1)
json.dump(infos, open(os.path.join(lvl.OUT, 'info_warlock.json'), 'w'), indent=1, default=str)
