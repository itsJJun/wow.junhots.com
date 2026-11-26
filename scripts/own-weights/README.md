# Own leveling stat weights

Gear upgrades scores items with stat weights from these sims, not an addon's. Engine: [MythicSim Forever engine](https://github.com/sage3648/mythicsim-forever-engine) (MIT), built with `engine.patch` (lets bonus hit/crit/dodge/parry % through).

- **Damage specs** (`gen.py`, `runner.py`, `classes.py`, `apls.py`; Warlock: `lvl.py`, `warlock.py`): kills per hour while questing. Kill time from the engine, then eating/drinking, travel (10 s), rest stops and deaths (calibrated to 0.5 deaths an hour). Mob level mix: 25% one below, 50% same, 25% one above.
- **Tanks and healers** (`tank_heal.py`): dungeon pulls per hour. 3 elites a level above; group damage capped by tank threat; healer drinks back the tank's damage; elite damage per level set so a typical healer drinks 25% of the time; 0.5 wipes an hour (5 min each), wipe chance from the tank's time to die / the healer's mana bar.
- Weight = extra kills (pulls) per hour from one more point, scaled so the main stat is 1. Brackets as Forever Leveling BiS, smoothed 1-2-1.
- Typical gear per level (`kit.py`): 3rd best quest/dungeon item per slot, picked with `selector_weights.json` (Forever Leveling BiS v1.3.0, MIT), frozen so the sims don't feed on their own output.
- Game data: `data/ExpectedStat.csv`, `data/PlayerExpectedStat.csv` (Forever client db2 via wago.tools); talents layout `layouts.json` (engine).

Run: `MSE_ENGINE=/path/to/engine ./run.sh` (about 15 minutes on 4 cores) -> `own_weights.json` + new `public/data/gear-<hash>.bin`. `build_site.py` also applies `own_weights.json` when it builds the page. Daily: `.github/workflows/own-weights.yml` re-runs when the engine changes and opens a PR.
