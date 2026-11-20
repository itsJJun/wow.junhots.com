// junhots-wow Worker. Pages are static files in public/ (served by Cloudflare before this code runs).
// This code handles /api/* and the census pages (see run_worker_first in wrangler.jsonc), plus the census cron.
//
// Storage: one KV namespace, binding WOW (this Worker's own; never the junhots.com one).
//   ah:latest            the newest Auctionator.lua uploaded on /admin/ (raw bytes), metadata {at, size, name}
//   ah:day:YYYY-MM-DD    one upload per day, kept 120 days (price history for later)
//   sfx:latest           auction prices per random suffix ("Darkmist Wizard Hat of Shadow Wrath"), JSON
//                        {at, full, items: {name: {p, n, t}}}, merged from the Gear Snapshot files uploaded on /admin/
//   fb:<time>-<id>       one feedback report (JSON), kept 180 days; /api/fb/new counts the ones after a time
//   rl:<kind>:<hour>:<ip hash>  rate-limit counters (expire by themselves)
//   census, census:try   the daily level census from classicplus.io (src/census.js)
// Secrets (set in the Cloudflare dashboard, never in the repo): ADMIN_PASSWORD, TURNSTILE_SECRET.
// Variable: TURNSTILE_SITEKEY (public, shown to the browser).

import { CENSUS_PAGES, censusPage, refreshCensus } from './census.js';

const MAX_AH = 8 * 1024 * 1024;
const MAX_SFX = 2 * 1024 * 1024;
const SFX_KEEP_DAYS = 30;

// Merge newly uploaded suffix prices into the stored ones. A full scan replaces everything older than it;
// otherwise the newer entry per name wins. Entries older than SFX_KEEP_DAYS are dropped.
function mergeSfx(old, add) {
  const items = {}, cut = Date.now() / 1000 - SFX_KEEP_DAYS * 86400;
  const full = Math.max(+old.full || 0, +add.full || 0) || null;
  for (const [k, e] of Object.entries(old.items || {})) if (e.t > cut && !(add.full && e.t < add.full)) items[k] = e;
  for (const [k, e] of Object.entries(add.items || {})) {
    if (typeof k !== 'string' || k.length > 120 || !k.includes(' of ')) continue;
    const v = { p: Math.round(+e.p) || 0, n: Math.round(+e.n) || 0, t: Math.round(+e.t) || 0 };
    if (v.p <= 0 || v.t <= cut) continue;
    if (!items[k] || v.t >= items[k].t) items[k] = v;
  }
  return { at: Date.now(), full, items };
}
const FB_PER_HOUR = 5;
const ADMIN_FAILS_PER_HOUR = 10;

const json = (data, status = 200, headers = {}) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });

async function rlKey(request, kind) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(kind + '|' + ip));
  const h = [...new Uint8Array(buf).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
  return 'rl:' + kind + ':' + Math.floor(Date.now() / 3600e3) + ':' + h;
}
// Hits per IP this hour. KV is eventually consistent, so this is a soft limit (Turnstile is the hard one).
async function hits(env, key) { return +(await env.WOW.get(key)) || 0; }
async function hit(env, key, n) { await env.WOW.put(key, String(n + 1), { expirationTtl: 3700 }); }

async function isAdmin(request, env) {
  const want = env.ADMIN_PASSWORD;
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!want || !got) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(want)), crypto.subtle.digest('SHA-256', enc.encode(got))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function admin(request, env, url) {
  const fk = await rlKey(request, 'adminfail'), fails = await hits(env, fk);
  if (fails >= ADMIN_FAILS_PER_HOUR) return json({ error: 'Too many wrong passwords. Try again in an hour.' }, 429);
  if (!(await isAdmin(request, env))) {
    if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD is not set on the Worker yet.' }, 503);
    await hit(env, fk, fails);
    return json({ error: 'Wrong password.' }, 401);
  }
  const p = url.pathname;
  if (p === '/api/admin/check') return json({ ok: true });
  // upload a new Auctionator.lua: the raw file is the request body
  if (p === '/api/admin/ah' && request.method === 'POST') {
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_AH) return json({ error: 'The file must be under 8 MB.' }, 400);
    const head = new TextDecoder().decode(buf.slice(0, 4096));
    if (!/AUCTIONATOR_/.test(head)) return json({ error: 'That is not an Auctionator.lua file.' }, 400);
    const meta = { at: Date.now(), scan: +request.headers.get('x-scan') || 0, size: buf.byteLength, name: (request.headers.get('x-file-name') || 'Auctionator.lua').slice(0, 80) };
    const day = new Date(meta.at).toISOString().slice(0, 10);
    await Promise.all([
      env.WOW.put('ah:latest', buf, { metadata: meta }),
      env.WOW.put('ah:day:' + day, buf, { metadata: meta, expirationTtl: 120 * 86400 }),
    ]);
    return json({ ok: true, ...meta });
  }
  // suffix prices from a Gear Snapshot file, read in the browser: {items: {name: {p, n, t}}, full}
  if (p === '/api/admin/sfx' && request.method === 'POST') {
    const text = await request.text();
    if (!text || text.length > MAX_SFX) return json({ error: 'Suffix prices must be under 2 MB.' }, 400);
    let add; try { add = JSON.parse(text); } catch (e) { return json({ error: 'Bad suffix prices.' }, 400); }
    if (!add || typeof add.items !== 'object') return json({ error: 'Bad suffix prices.' }, 400);
    const merged = mergeSfx((await env.WOW.get('sfx:latest', 'json')) || {}, add);
    await env.WOW.put('sfx:latest', JSON.stringify(merged));
    return json({ ok: true, at: merged.at, count: Object.keys(merged.items).length, full: merged.full });
  }
  if (p === '/api/admin/feedback' && request.method === 'GET') {
    const list = await env.WOW.list({ prefix: 'fb:', limit: 200 });
    const items = await Promise.all(list.keys.map(async k => ({ key: k.name, ...(await env.WOW.get(k.name, 'json')) })));
    items.sort((a, b) => (b.at || 0) - (a.at || 0));
    return json({ items });
  }
  if (p.startsWith('/api/admin/feedback/') && request.method === 'DELETE') {
    const key = decodeURIComponent(p.slice('/api/admin/feedback/'.length));
    if (!key.startsWith('fb:')) return json({ error: 'Bad key.' }, 400);
    await env.WOW.delete(key);
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

async function feedback(request, env) {
  if (!env.TURNSTILE_SECRET) return json({ error: 'Feedback is not set up yet.' }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const text = String(body.text || '').trim().slice(0, 2000);
  if (text.length < 5) return json({ error: 'Please say a bit more about what is wrong.' }, 400);
  const rk = await rlKey(request, 'fb'), n = await hits(env, rk);
  if (n >= FB_PER_HOUR) return json({ error: 'Thanks! You have sent a few already. Please try again in an hour.' }, 429);
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(body.token || ''));
  const ip = request.headers.get('cf-connecting-ip'); if (ip) form.append('remoteip', ip);
  const tv = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then(r => r.json()).catch(() => ({}));
  if (!tv.success) return json({ error: 'The robot check did not pass. Please try again.' }, 403);
  await hit(env, rk, n);
  const at = Date.now();
  const item = {
    at, text,
    kind: String(body.kind || 'wrong').slice(0, 20),
    page: String(body.page || '').slice(0, 200),
    contact: String(body.contact || '').trim().slice(0, 120),
    ua: (request.headers.get('user-agent') || '').slice(0, 160),
    country: (request.cf && request.cf.country) || '',
  };
  await env.WOW.put('fb:' + String(at).padStart(14, '0') + '-' + crypto.randomUUID().slice(0, 8), JSON.stringify(item), { expirationTtl: 180 * 86400 });
  return json({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    try {
      if (CENSUS_PAGES.includes(p)) return await censusPage(request, env, ctx);
      // which census day the pages use now
      if (p === '/api/census' && request.method === 'GET') {
        const c = await env.WOW.get('census', 'json');
        return json(c ? { snapshot: c.snapshot, fetched: c.fetched } : { none: true }, 200, { 'cache-control': 'public, max-age=300' });
      }
      if (p === '/api/health') return json({ ok: true });
      if (p === '/api/config') return json({ turnstile: env.TURNSTILE_SITEKEY || '' }, 200, { 'cache-control': 'public, max-age=300' });
      // the newest Auctionator scan uploaded on /admin/; pages use it when the visitor has not loaded their own
      if (p === '/api/ah/meta' && request.method === 'GET') {
        const r = await env.WOW.getWithMetadata('ah:latest', 'stream');
        if (r.value) await r.value.cancel();
        return json(r.metadata || { none: true }, 200, { 'cache-control': 'public, max-age=300' });
      }
      if (p === '/api/ah' && request.method === 'GET') {
        const r = await env.WOW.getWithMetadata('ah:latest', 'arrayBuffer');
        if (!r.value) return json({ error: 'No scan yet.' }, 404);
        return new Response(r.value, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300', etag: '"' + r.metadata.at + '"' } });
      }
      // suffix prices shared by the site owner's uploads; Gear upgrades merges them with the visitor's own
      if (p === '/api/sfx' && request.method === 'GET') {
        const v = await env.WOW.get('sfx:latest', 'text');
        return new Response(v || '{"items":{}}', { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
      }
      if (p === '/api/feedback' && request.method === 'POST') return await feedback(request, env);
      // how many reports came in after ?since= (ms): only a count, for the owner's reminder bar (site.js ownerNudge)
      if (p === '/api/fb/new' && request.method === 'GET') {
        const since = 'fb:' + String(Math.max(0, Math.floor(+url.searchParams.get('since') || 0))).padStart(14, '0');
        const list = await env.WOW.list({ prefix: 'fb:', limit: 1000 });
        return json({ n: list.keys.filter(k => k.name > since).length }, 200, { 'cache-control': 'private, max-age=60' });
      }
      if (p.startsWith('/api/admin/')) return await admin(request, env, url);
      if (p.startsWith('/api/')) return json({ error: 'not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      if (CENSUS_PAGES.includes(p)) return env.ASSETS.fetch(request);   // census trouble never breaks the page
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },
  // cron (wrangler.jsonc triggers): keep the level census fresh
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshCensus(env));
  },
};
