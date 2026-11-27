"""TEMPORARY probe (removed before the PR): saves a few hourly snapshots of US house 113 and compares ways of counting sales.
Prints counts per rule for common items next to TSM's region sold per day. Never prints keys."""
import csv, gzip, io, os, pickle, sys, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import blizzard_prices as B

H, N = 113, int(os.environ.get('PROBE_SNAPS', '4'))
tok = B.token()
def snap():
    a, t1 = B.get(tok, 'us', '/data/wow/ruleset/1/auctions/%d' % H)
    c, t2 = B.get(tok, 'us', '/data/wow/ruleset/1/auctions/%d/commodities' % H)
    print('commodities', len(c.get('auctions') or []), 'auctions', len(a.get('auctions') or []), flush=True)
    return max(t1, t2), B.listings(a.get('auctions') or [], c.get('auctions') or [])
os.makedirs('probe-out', exist_ok=True)
snaps = []
t, cur = snap(); snaps.append((t, cur)); print('snap', t, len(cur), flush=True)
start = time.time()
while len(snaps) < N and time.time() - start < 5.2 * 3600:
    time.sleep(120)
    try: t, cur = snap()
    except Exception as e: print('fetch failed', str(e)[:100]); continue
    if t > snaps[-1][0]:
        snaps.append((t, cur)); print('snap', t, len(cur), flush=True)
        open('probe-out/snaps.pkl.gz', 'wb').write(gzip.compress(pickle.dumps([(t, {k: v[:4] for k, v in c.items()}) for t, c in snaps], 4), 3))
print('done', len(snaps), 'snapshots', flush=True)
