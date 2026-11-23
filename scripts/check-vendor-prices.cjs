#!/usr/bin/env node
// Check every vendor sell price the site shows, after scripts/build_site.py:
//   node scripts/check-vendor-prices.cjs
// 1. Data: vendor prices inside Profession leveling and Vendor flips must match the game
//    (scripts/vendor-prices.json, read from TradeSkillMaster's item cache by scripts/vendor_ref.py).
// 2. Words: every "sell to vendor ... each" on Profession leveling (all professions) must show ONE item's price.
//    A craft can make several items (Anti-Venom makes 3), so a per-craft number there is wrong.
// Exits 1 on any mismatch. Needs Playwright with Chromium.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const PUB = path.join(__dirname, '..', 'public');
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor-prices.json'), 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split(/[?#]/)[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(PUB, path.normalize(p));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// "1g 2s 3c" (or its HTML text) -> copper
const copper = t => { let c = 0; for (const [, n, u] of t.matchAll(/(\d[\d,]*)\s*([gsc])\b/g)) c += +n.replace(/,/g, '') * { g: 10000, s: 100, c: 1 }[u]; return c; };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('page error:', e.message));
  await page.route(/\/api\//, r => r.fulfill({ status: 404, body: '' }));   // no live AH scan needed
  const bad = [], seen = { data: 0, words: 0 }, profsSeen = new Set();
  const vsRef = (where, id, name, v) => {
    if (REF[id] === undefined || v === undefined || v === null) return;
    seen.data++;
    if (+v !== REF[id]) bad.push(`${where}: ${name} (${id}) says ${v}c, the game pays ${REF[id]}c`);
  };

  // Profession leveling
  await page.goto(base + '/profession-leveling/', { waitUntil: 'load' });
  const D = await page.evaluate(() => ({ items: DATA.items, profs: Object.fromEntries(Object.entries(DATA.profs).map(([k, p]) => [k, p.recipes.map(r => ({ it: r.it, n: r.n, sell: r.sell }))])) }));
  for (const [id, e] of Object.entries(D.items)) vsRef('Profession leveling items', id, e.n, e.vs);
  for (const [k, rs] of Object.entries(D.profs)) for (const r of rs) vsRef('Profession leveling ' + k, String(r.it), r.n, r.sell);
  for (const k of Object.keys(D.profs)) {
    await page.goto(base + '/profession-leveling/#' + k, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });   // a hash-only change doesn't reload the page
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    const shown = await page.$$eval('[data-vs-item]', els => els.map(e => [e.dataset.vsItem, e.textContent]));
    for (const [id, txt] of shown) {
      const want = REF[id] !== undefined ? REF[id] : (D.items[id] || {}).vs;
      if (want === undefined) continue;
      seen.words++; profsSeen.add(k);
      const got = copper(txt.replace(/^[^\d]*/, ''));
      if (Math.abs(got - want) > (want >= 100000 ? 99 : 0)) bad.push(`Profession leveling #${k}: "${txt.trim()}" for ${(D.items[id] || {}).n || id} (${id}), one sells for ${want}c`);
    }
  }

  // Vendor flips: items = { id: [name, vendor sell, quality, icon] }
  await page.goto(base + '/vendor-flips/', { waitUntil: 'load' });
  const F = await page.evaluate(() => DATA.items);
  for (const [id, e] of Object.entries(F)) vsRef('Vendor flips', id, e[0], e[1]);

  await browser.close(); server.close();
  console.log(`Vendor prices: ${seen.data} checked against the game, ${seen.words} shown on Profession leveling (${[...profsSeen].join(', ')}).`);
  if (!seen.words) bad.push('No "sell to vendor" prices found on Profession leveling: the check can no longer see them.');
  if (bad.length) { console.log(bad.length + ' wrong:\n  ' + bad.slice(0, 40).join('\n  ')); process.exit(1); }
  console.log('All match.');
})().catch(e => { console.error(e); process.exit(1); });
