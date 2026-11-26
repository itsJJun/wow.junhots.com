#!/usr/bin/env python3
"""Write the Gear upgrades item data the page reads (public/data/gear-<hash>.bin) as JSON, for kit.py (OW_GEAR_DB)."""
import gzip, os, sys
from apply import PAGE, SRC, REPO
m = SRC.search(open(PAGE, encoding='utf-8').read())
open(sys.argv[1], 'wb').write(gzip.decompress(open(os.path.join(REPO, 'public/data', m.group(2)), 'rb').read()))
