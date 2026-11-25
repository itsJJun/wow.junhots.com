// Hourly auction data from Blizzard's Battle.net API, built by the GitHub job scripts/blizzard_prices.py.
// The job posts one bundle per region and kind: a 900-byte JSON line {v, region, k, asOf, h: {house: [start, end, ...]}}
// then gzip sections. KV: bliz:<k>:<region> (k = p prices, h history), metadata = that JSON line.
// Pages ask for one house (/api/bliz?h=us-113, /api/blizh?h=us-113, /api/blizfp?r=us): the Worker only slices bytes
// and sends the gzip section as is, so it stays far under the free plan's CPU limit.

const REGIONS = ['us', 'eu'];
const KINDS = ['p', 'h'];
const MAX = 24 * 1024 * 1024;
const HEAD = 900;

export async function storeBundle(request, env, url) {
  const r = url.searchParams.get('r'), k = url.searchParams.get('k');
  if (!REGIONS.includes(r) || !KINDS.includes(k)) return { status: 400, body: { error: 'Bad region or kind.' } };
  const buf = await request.arrayBuffer();
  if (buf.byteLength <= HEAD || buf.byteLength > MAX) return { status: 400, body: { error: 'Bad size.' } };
  let head;
  try { head = JSON.parse(new TextDecoder().decode(buf.slice(0, HEAD)).trim()); } catch (e) { return { status: 400, body: { error: 'Bad header.' } }; }
  if (head.v !== 1 || head.region !== r || head.k !== k || !(head.asOf > 0) || !head.h || typeof head.h !== 'object') return { status: 400, body: { error: 'Bad header.' } };
  for (const v of Object.values(head.h)) if (!Array.isArray(v) || !(v[0] >= HEAD) || !(v[1] > v[0]) || v[1] > buf.byteLength) return { status: 400, body: { error: 'Bad offsets.' } };
  const key = 'bliz:' + k + ':' + r, old = await env.WOW.getWithMetadata(key, 'stream');
  if (old.value) await old.value.cancel();
  if (old.metadata && old.metadata.asOf >= head.asOf) return { status: 200, body: { ok: true, unchanged: true, asOf: old.metadata.asOf } };
  head.at = Date.now();
  await env.WOW.put(key, buf, { metadata: head, expirationTtl: 3 * 86400 });
  return { status: 200, body: { ok: true, region: r, k, asOf: head.asOf, sections: Object.keys(head.h).length } };
}

// -> Response with one gzip section, or null
export async function section(env, k, r, sec) {
  if (!REGIONS.includes(r) || !KINDS.includes(k)) return null;
  const got = await env.WOW.getWithMetadata('bliz:' + k + ':' + r, { type: 'arrayBuffer', cacheTtl: 300 });
  const at = got.metadata && got.metadata.h && got.metadata.h[sec];
  if (!got.value || !at) return null;
  return new Response(got.value.slice(at[0], at[1]), {
    encodeBody: 'manual',
    headers: { 'content-type': 'text/plain; charset=utf-8', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=300',
               'x-as-of': String(got.metadata.asOf) },
  });
}

// the houses with listings per region: {us: {asOf, h: {"113": [items, "H"]}}, ...}
export async function houses(env) {
  const out = {};
  for (const r of REGIONS) {
    const got = await env.WOW.getWithMetadata('bliz:p:' + r, 'stream');
    if (got.value) await got.value.cancel();
    if (!got.metadata) continue;
    const h = {};
    for (const [k, v] of Object.entries(got.metadata.h || {})) if (k !== 'fp') h[k] = v.slice(2);
    out[r] = { asOf: got.metadata.asOf, h };
  }
  return out;
}

// "us-113" -> ["us", "113"]
export function parseHouse(s) {
  const m = /^(us|eu)-(\d{3})$/.exec(s || '');
  return m ? [m[1], m[2]] : null;
}
