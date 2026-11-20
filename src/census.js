// Level census (who is levelling where), kept fresh without rebuilding the site.
//
// Source: classicplus.io public JSON (no key; the data behind realmsforever.com's level chart). It updates once a day
// (around 17:00 UTC). The cron in wrangler.jsonc checks it every 3 hours; a page view also starts a check when the
// stored day is over a day behind (at most one try an hour), so it heals itself if cron runs fail.
//
// KV key `census`: {snapshot, fetched, horde[60], trend[days][60], trendDays[days]}
//   horde = Horde characters on PvP realms per level (index = level - 1), trend = both factions per day (no faction split).
//   Same numbers as level-census/fetch.py in the WoW Forever project.
//
// The census pages (CENSUS_PAGES) carry the census from build time inside `const MKT_DATA = {"snapshot":...,"horde":[...],
// "trend":[...],"trendDays":[...],` (level-census/build.py writes these keys first, in this order). When the stored census is
// newer, the Worker swaps that part of the page for the fresh numbers as the page streams out. Nothing else on the page
// changes, and if the pattern is not found the page is served as it is.

const API = 'https://classicplus.io/api/';
export const CENSUS_PAGES = ['/mat-timing/', '/sell-spare-mats/', '/profession-leveling/', '/tailoring-finder/'];
const RETRY_MS = 3600e3, STALE_MS = 26 * 3600e3;
const DAY = /^\d{4}-\d\d-\d\d$/;
const enc = new TextEncoder(), dec = new TextDecoder();

async function get(path) {
  const r = await fetch(API + path, { headers: { accept: 'application/json', 'user-agent': 'wow.junhots.com level census (a few checks a day)' } });
  if (!r.ok) throw new Error('classicplus.io ' + path + ': HTTP ' + r.status);
  return r.json();
}

const counts = a => Array.isArray(a) && a.length === 60 && a.every(x => Number.isInteger(x) && x >= 0);

// classicplus.io JSON -> our census, or throws if anything looks off (nothing bad is ever stored)
export function makeCensus(meta, lv) {
  const pvp = lv && lv.datasets && lv.datasets.pvp;
  if (!pvp || !DAY.test(lv.snapshotDate) || !Array.isArray(meta.combos) || !Array.isArray(meta.races)) throw new Error('census: unexpected shape');
  const horde = new Array(60).fill(0);
  meta.combos.forEach((cb, i) => {
    const race = meta.races[cb.race], row = pvp.counts[i] || [];
    if (race && race.faction === 'Horde') for (let l = 0; l < 60; l++) horde[l] += +row[l] || 0;
  });
  const days = pvp.trend.days, trend = pvp.trend.classLevels.map(cl => {
    const a = new Array(60).fill(0);
    for (const c of cl) for (let l = 0; l < 60; l++) a[l] += +c[l] || 0;
    return a;
  });
  if (!counts(horde) || horde.reduce((a, b) => a + b, 0) < 1000) throw new Error('census: too few characters');
  if (!Array.isArray(days) || days.length !== trend.length || !days.every(d => DAY.test(d)) || !trend.every(counts)) throw new Error('census: bad trend');
  return { snapshot: lv.snapshotDate, fetched: new Date().toISOString(), horde, trend, trendDays: days };
}

// Fetch from classicplus.io and store when it has a newer day. Returns the census now in KV.
export async function refreshCensus(env) {
  await env.WOW.put('census:try', String(Date.now()), { expirationTtl: 7200 });
  const old = await env.WOW.get('census', 'json');
  const lv = await get('census/levels');
  if (old && old.snapshot >= lv.snapshotDate) return old;
  const c = makeCensus(await get('census'), lv);
  await env.WOW.put('census', JSON.stringify(c));
  console.log('census', c.snapshot, c.horde.reduce((a, b) => a + b, 0));
  return c;
}

export async function storedCensus(env, ctx) {
  const c = await env.WOW.get('census', { type: 'json', cacheTtl: 300 });
  if (!c || Date.now() - Date.parse(c.snapshot + 'T17:00:00Z') > STALE_MS) {
    const t = +(await env.WOW.get('census:try', { cacheTtl: 60 })) || 0;
    if (Date.now() - t > RETRY_MS) ctx.waitUntil(refreshCensus(env).catch(e => console.error(e)));
  }
  return c;
}

// ---- splice the stored census into a page
function find(buf, pat, from) {
  const n = buf.length - pat.length, p0 = pat[0];
  outer: for (let i = from; i <= n; i++) {
    if (buf[i] !== p0) continue;
    for (let k = 1; k < pat.length; k++) if (buf[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}
const START = enc.encode('const MKT_DATA = {"snapshot":"'), END = enc.encode('"trendDays":[');
const OLD = /^const MKT_DATA = \{"snapshot":"(\d{4}-\d\d-\d\d)","horde":\[[\d,]*\],"trend":\[[\d,[\]]*\],"trendDays":\[[^\]]*\],$/;
const MAX_SCAN = 1 << 20;

// Returns the page body with the census swapped in (a stream), or null to serve it unchanged.
async function splice(body, c) {
  const reader = body.getReader(), parts = [];
  let buf = new Uint8Array(0), done = false;
  while (buf.length < MAX_SCAN) {
    const r = await reader.read();
    if (r.done) { done = true; break; }
    const nb = new Uint8Array(buf.length + r.value.length); nb.set(buf); nb.set(r.value, buf.length); buf = nb;
    const i = find(buf, START, 0); if (i < 0) continue;
    const e = find(buf, END, i); if (e < 0) continue;
    const j = buf.indexOf(0x5d, e + END.length); if (j < 0 || buf[j + 1] !== 0x2c) continue;   // "]," ends trendDays
    const m = OLD.exec(dec.decode(buf.subarray(i, j + 2)));
    if (!m || m[1] >= c.snapshot) break;   // not the expected shape, or the page is already as new
    const fresh = enc.encode('const MKT_DATA = ' + JSON.stringify({ snapshot: c.snapshot, horde: c.horde, trend: c.trend, trendDays: c.trendDays }).slice(0, -1) + ',');
    parts.push(buf.subarray(0, i), fresh, buf.subarray(j + 2));
    return new ReadableStream({
      async pull(ctl) {
        if (parts.length) return ctl.enqueue(parts.shift());
        const r = await reader.read();
        if (r.done) ctl.close(); else ctl.enqueue(r.value);
      },
      cancel(why) { return reader.cancel(why); },
    });
  }
  // no swap: hand back what was read plus the rest
  return { unchanged: true, stream: new ReadableStream({
    start(ctl) { if (buf.length) ctl.enqueue(buf); if (done) ctl.close(); },
    async pull(ctl) { const r = await reader.read(); if (r.done) ctl.close(); else ctl.enqueue(r.value); },
    cancel(why) { return reader.cancel(why); },
  }) };
}

// A census page: the static file with today's census in it. The ETag includes the census day, so browsers
// revalidate cheaply and still get the new numbers the day they change.
export async function censusPage(request, env, ctx) {
  const c = await storedCensus(env, ctx).catch(() => null);
  if (!c || request.method !== 'GET') return env.ASSETS.fetch(request);
  const h = new Headers(request.headers); h.delete('if-none-match'); h.delete('if-modified-since');
  const res = await env.ASSETS.fetch(new Request(request, { headers: h }));
  if (res.status !== 200 || !/text\/html/.test(res.headers.get('content-type') || '')) return res;
  const tag = 'W/"' + (res.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '') + '-c' + c.snapshot + '"';
  const out = new Headers(res.headers); out.set('etag', tag); out.delete('content-length'); out.delete('last-modified');
  if ((request.headers.get('if-none-match') || '').split(',').some(t => t.trim() === tag)) {
    await res.body.cancel();
    return new Response(null, { status: 304, headers: out });
  }
  const b = await splice(res.body, c);
  return new Response(b.unchanged ? b.stream : b, { status: 200, headers: out });
}
