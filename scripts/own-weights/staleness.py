"""Is the sim engine behind the game? Prints a verdict and writes GITHUB_OUTPUT checked, stale (1|0) and msg

The engine (MSE_ENGINE) is updated almost daily by its author, mostly by hand from Blizzard's patch notes and hotfixes,
so its own "client_build" label lags and can't be compared. Instead: the newest Forever game build (wago.tools, product
wowf) is compared with the engine's last commit. Stale = the game got a new build and the engine has had no commit for
STALE_DAYS days since. Stdlib only. A failed fetch never fails the job (prints and reports not stale)."""
import datetime, json, os, subprocess, sys, urllib.request

STALE_DAYS = 4
BUILDS = 'https://wago.tools/api/builds'


def utc(s):
    d = datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)


def verdict(game, game_at, engine_at, now):
    """(stale, message) from the newest game build (version, time), the engine's last commit time and now."""
    quiet = (now - engine_at).days
    if game_at > engine_at and quiet >= STALE_DAYS:
        return True, ('The game got a new build (%s, %s UTC), but the MythicSim Forever engine has had no update for '
                      '%d days (last %s UTC). Our Gear upgrades stat weights only change when the engine does, so they may '
                      'miss this patch.' % (game, game_at.strftime('%d %b %H:%M'), quiet, engine_at.strftime('%d %b %H:%M')))
    if game_at > engine_at:
        return False, 'Game build %s (%s) is newer than the last engine update (%s); a warning after %d quiet days.' % (
            game, game_at.strftime('%d %b'), engine_at.strftime('%d %b'), STALE_DAYS)
    return False, 'Engine is up to date with the game (game build %s at %s, engine updated %s).' % (
        game, game_at.strftime('%d %b'), engine_at.strftime('%d %b'))


def main():
    eng = os.environ['MSE_ENGINE']
    engine_at = utc(subprocess.check_output(['git', '-C', eng, 'log', '-1', '--format=%cI'], text=True).strip())
    try:
        req = urllib.request.Request(BUILDS, headers={'user-agent': 'wow.junhots.com own-weights job'})
        b = json.load(urllib.request.urlopen(req, timeout=30))['wowf'][0]
        game, game_at = b['version'], utc(b['created_at'].replace(' ', 'T'))
    except Exception as e:   # noqa: BLE001 - a missing build list is not a reason to fail the weights job
        print('game build check skipped:', e)
        stale, msg, checked = False, '', 0
    else:
        checked = 1
        stale, msg = verdict(game, game_at, engine_at, datetime.datetime.now(datetime.timezone.utc))
        print(msg)
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a') as f:
            f.write('checked=%d\nstale=%d\nmsg=%s\n' % (checked, stale, msg.replace('\n', ' ')))


if __name__ == '__main__':
    sys.exit(main())
