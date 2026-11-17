// junhots-wow Worker. Pages are static files in public/ (served by Cloudflare before this code runs).
// This code only handles /api/* (see run_worker_first in wrangler.jsonc).
//
// Storage: one KV namespace, binding WOW (this Worker's own; never the junhots.com one).
//   ah:latest            the newest Auctionator.lua uploaded on /admin/ (raw bytes), metadata {at, size, name}
//   ah:day:YYYY-MM-DD    one upload per day, kept 120 days (price history for later)
//   fb:<time>-<id>       one feedback report (JSON), kept 180 days
//   rl:<kind>:<hour>:<ip hash>  rate-limit counters (expire by themselves)
// Secrets (set in the Cloudflare dashboard, never in the repo): ADMIN_PASSWORD, TURNSTILE_SECRET.
// Variable: TURNSTILE_SITEKEY (public, shown to the browser).

const MAX_AH = 8 * 1024 * 1024;
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
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname;
    try {
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
      if (p === '/api/feedback' && request.method === 'POST') return await feedback(request, env);
      if (p.startsWith('/api/admin/')) return await admin(request, env, url);
      if (p.startsWith('/api/')) return json({ error: 'not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },
};
