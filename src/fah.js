// Hourly auction prices from Forever AH (https://forever-ah.com/api/), for visitors who have no scan of their own.
//
// Forever AH reads Blizzard's Battle.net auction data for WoW Forever every hour and offers it free, with no key.
// Its terms: cache what you can, about one request a second, and credit "Forever AH" and Blizzard's Battle.net API.
// Per item it gives the cheapest buyout per unit (min_unit), units listed (quantity) and auctions (listings).
// It has no prices per random suffix ("of the Owl"): those still come from in-game scans (Gear Snapshot, Auctionator).
//
// House: Horde Auction House 113 (us). Checked 25 Nov 2026: 182 of 198 cheapest prices matched an in-game Gear Snapshot
// scan at Orgrimmar (PvP ruleset) exactly; the other Horde houses matched 1 to 11.
//
// The market table comes 200 items a page, sorted by name (~35 pages). To keep each run small (Worker CPU and
// Forever AH's one-request-a-second ask), the cron (wrangler.jsonc, every 5 minutes) fetches PER_RUN pages for one
// slot, so the whole house is refreshed about once an hour, like the source.
// KV `fah:<house>:<slot>` = text, one line per item "id,price,units,auctions", metadata {asOf, n}.
// /api/fah joins the slots; the browser (site.js) turns it into an Auctionator-style file.

export const FAH_HOUSE = 113;
const HOUSE_KEY = 5;                 // Forever AH's key for us house 113 (/v1/houses)
const API = 'https://forever-ah.com/v1/houses/' + HOUSE_KEY + '/market?sort=name&limit=200&offset=';
export const SLOTS = 14, PER_RUN = 3;  // 42 pages = 8,400 items (the house has ~7,000)
const PAGE = 200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// one page of the market table -> lines "id,price,units,auctions"; asOf = the snapshot time (seconds)
export function pageLines(j) {
  if (!j || !Array.isArray(j.rows) || !j.house || j.house.house_id !== FAH_HOUSE) throw new Error('fah: unexpected page');
  let out = '', n = 0;
  for (const r of j.rows) {
    const id = r && r.item && r.item.item_id, c = r && r.current;
    if (!Number.isInteger(id) || !c) continue;
    const p = Math.round(+c.min_unit), q = Math.round(+c.quantity) || 0, a = Math.round(+c.listings) || 0;
    if (!(p > 0)) continue;
    out += id + ',' + p + ',' + q + ',' + a + '\n'; n++;
  }
  return { out, n, asOf: Math.floor(Date.parse(j.as_of) / 1000) || 0, total: +j.total || 0 };
}

// The slot for this run comes from the clock, so no KV write is needed to remember where we are.
export async function refreshFah(env, now = Date.now()) {
  const slot = Math.floor(now / 300e3) % SLOTS;
  let out = '', n = 0, asOf = 0, total = 0;
  for (let k = 0; k < PER_RUN; k++) {
    const page = slot * PER_RUN + k;
    if (k) await sleep(1100);
    const res = await fetch(API + page * PAGE, { headers: { accept: 'application/json', 'user-agent': 'wow.junhots.com (hourly prices for visitors; one request a second)' } });
    if (!res.ok) throw new Error('fah page ' + page + ': HTTP ' + res.status);
    const r = pageLines(await res.json());
    out += r.out; n += r.n; total = r.total;
    if (r.asOf > asOf) asOf = r.asOf;
    if ((page + 1) * PAGE >= total) break;   // past the end of the table
  }
  if (!n) return 'slot ' + slot + ': past the end of the table';   // no write: the house has fewer items
  await env.WOW.put('fah:' + FAH_HOUSE + ':' + slot, out, { metadata: { asOf, n, total, at: now }, expirationTtl: 3 * 86400 });
  return 'slot ' + slot + ': ' + n + ' items of ' + total + ', snapshot ' + new Date(asOf * 1000).toISOString();
}

// All slots joined: first line "#newest snapshot,oldest snapshot,items in the house" (seconds), then the item lines (a later slot can repeat an item that moved
// pages; the browser keeps the newest).
export async function fahPrices(env) {
  const parts = await Promise.all(Array.from({ length: SLOTS }, (_, s) =>
    env.WOW.getWithMetadata('fah:' + FAH_HOUSE + ':' + s, { type: 'text', cacheTtl: 300 })));
  let asOf = 0, total = 0, body = '';
  const ok = parts.filter(x => x.value && x.metadata).sort((a, b) => a.metadata.asOf - b.metadata.asOf);   // newest last wins
  for (const x of ok) { body += x.value; if (x.metadata.asOf > asOf) asOf = x.metadata.asOf; total = Math.max(total, x.metadata.total || 0); }
  if (!ok.length) return null;
  return { asOf, oldest: ok[0].metadata.asOf, text: '#' + asOf + ',' + ok[0].metadata.asOf + ',' + total + '\n' + body };
}
