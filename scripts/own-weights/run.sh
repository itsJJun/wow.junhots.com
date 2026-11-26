#!/usr/bin/env bash
# All leveling stat weights, then the Gear upgrades data with them (see README.md). Needs MSE_ENGINE = a built
# MythicSim Forever engine with engine.patch applied. About 15 minutes on 4 cores.
set -euo pipefail
cd "$(dirname "$0")"
export OW_OUT="${OW_OUT:-$PWD/out}" ; mkdir -p "$OW_OUT"; rm -f "$OW_OUT"/out_*.json "$OW_OUT"/info_*.json
export OW_GEAR_DB="$OW_OUT/gear_db.json"
python3 extract_db.py "$OW_GEAR_DB"
# damage specs: kills per hour (4 processes)
pids=()
python3 run_all.py WARRIOR ROGUE HUNTER > "$OW_OUT/log1.txt" 2>&1 & pids+=($!)
python3 run_all.py MAGE PRIEST SHAMAN > "$OW_OUT/log2.txt" 2>&1 & pids+=($!)
python3 run_all.py PALADIN DRUID > "$OW_OUT/log3.txt" 2>&1 & pids+=($!)
python3 warlock.py > "$OW_OUT/log4.txt" 2>&1 & pids+=($!)
for p in "${pids[@]}"; do wait "$p" || { tail -n 30 "$OW_OUT"/log*.txt; exit 1; }; done
# tanks and healers: dungeon pulls per hour
pids=()
python3 tank_heal.py WARRIOR:protection PALADIN:protection DRUID:bear > "$OW_OUT/log5.txt" 2>&1 & pids+=($!)
ITERS=8000 python3 tank_heal.py PRIEST:holy PRIEST:discipline PALADIN:holy > "$OW_OUT/log6.txt" 2>&1 & pids+=($!)
ITERS=8000 python3 tank_heal.py SHAMAN:restoration DRUID:restoration > "$OW_OUT/log7.txt" 2>&1 & pids+=($!)
for p in "${pids[@]}"; do wait "$p" || { tail -n 30 "$OW_OUT"/log*.txt; exit 1; }; done
python3 own_weights.py --out own_weights.json
python3 apply.py
