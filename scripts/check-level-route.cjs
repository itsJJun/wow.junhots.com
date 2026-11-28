#!/usr/bin/env node
// Level route check (Jun, 25 Nov: "double triple fully check on every single route"). Never tell a player to do or
// hand in a quest they don't have, or pick up a quest before its pre-quest is handed in.
//   node scripts/check-level-route.cjs            (after scripts/build_site.py; needs Playwright + Chromium)
//   SEED=3 LVS=12,20,28 node scripts/check-level-route.cjs [route filter]
// For every base route and several progress states per level (random gaps in finished quests, quests dropped from
// the log, a whole part skipped), it loads the page, then checks in order the going-back list and the route ahead
// of where you left off: every objective / hand-in comes after its pickup (or the quest is in your log or done),
// every pickup comes after its pre-quests are handed in, every hand-in of a quest with objectives comes after an
// objective line (Jun 27 Nov: Screecher Spirits hand-in shown before its objectives), and every quest picked up is handed in later. A test hook is injected into the served copy only.
// Exits 1 on any problem or page error.
const { chromium } = require('playwright');
const fs = require('fs');
const FILT = process.argv[2] || '';
// SEED=n picks other random progress states; LVS=12,16,20 sets the levels (default 14,22,30,38,46,54)
const SEED = +(process.env.SEED || 0), LVS = (process.env.LVS || '14,22,30,38,46,54').split(',').map(Number);
const path = require('path'), http = require('http');
const PUB = process.env.PUB || path.join(__dirname, '..', 'public'), D = PUB + '/level-route/data/';   // PUB=<folder>: test another copy of the site (the live one, to compare)
const META = JSON.parse(fs.readFileSync(D + 'route-meta.json'));
const HOOK = `
  window.__lrT = {
    set: function (done, log, level) {
      logQ = new Map(); log.forEach(function (q) { logQ.set(q, { ready: false, obj: [], title: '' }); });
      snap = { name: 'T', level: level, where: null, hearth: '', cls: R.cls, done: done, n: log.length, folded: false, at: '' };
      ticks = {}; ls.set('lr.skip', ''); if (typeof pmClear === 'function') pmClear(); $('char').innerHTML = '<option>T</option>'; applyQuests();
    },
    qa: function () { return !!QA && !!R && rows.length > 0; },   // quest data and the route both loaded
    cu: function () {
      if (!pick || !skipStop) return null;
      var L = [hereStop].concat(catchNext()).filter(function (x) { return x !== skipStop; });
      return { here: hereStop.gi, skip: skipStop.gi, sts: L.map(function (st) { return { gi: st.gi, ch: st.ch.name, title: st.title,
        steps: [].concat.apply([], st.rows.map(function (r) { return r.k !== 'step' ? [] : [{ i: r.i, s: r.s }].concat(r.more || []).map(function (m) {
          return { t: m.s.t, q: m.s.q, done: !!(m.s.q && (doneQ.has(m.s.q) || inLogDone(m.s))) || !!ticks[m.i + ':' + m.s.t] }; }); })) }; }) };
    },
    // the route ahead of where you are (after a detour: from where you left off), as shown (hidden steps are not in rows)
    fwd: function () {
      var h = skipStop ? skipStop.rows[0].n : here;
      return rows.filter(function (r) { return r.k === 'step' && r.n >= h; }).map(function (r) {
        return [{ i: r.i, s: r.s }].concat(r.more || []).map(function (m) {
          return { t: m.s.t, q: m.s.q, n: r.n, done: !!(m.s.q && (doneQ.has(m.s.q) || inLogDone(m.s))) || !!ticks[m.i + ':' + m.s.t] }; }); });
    }
  };
  function loadSPF(text) {`;
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => {
  let f = path.join(PUB, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(PUB)) { r.writeHead(403); return r.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (process.env.PAGE && f === path.join(PUB, 'level-route', 'index.html')) f = process.env.PAGE;   // test a saved copy
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
let PORT;
(async () => {
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok)); PORT = srv.address().port;
  const b = await chromium.launch();
  const ids = fs.readdirSync(D + 'routes').filter(f => !/-opt\.json$|-u[0-9a-f]{8}\.json$/.test(f) && f.includes(FILT)).map(f => f.replace('.json', ''));
  let nFwd = 0, nScen = 0, nDet = 0, nStops = 0, bad = [], errs = [];
  const worker = async (list) => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.route('**/level-route/', async rt => { const r = await rt.fetch(); let s = await r.text();
      if (!s.includes('  function loadSPF(text) {')) throw new Error('hook anchor'); s = s.replace('  function loadSPF(text) {', HOOK); await rt.fulfill({ response: r, body: s }); });
    for (const id of list) {
      const R = JSON.parse(fs.readFileSync(D + 'routes/' + id + '.json'));
      const p = await ctx.newPage(); p.on('pageerror', e => errs.push(id + ': ' + e.message));
      await p.addInitScript(([r, c]) => { localStorage.clear(); localStorage.setItem('lr.race', r); localStorage.setItem('lr.cls', c); }, [R.race, R.cls]);
      await p.goto('http://127.0.0.1:' + PORT + '/level-route/', { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__lrT && window.__lrT.qa(), null, { timeout: 60000 });   // the every-quest list is loaded
      await p.waitForTimeout(300);
      const st = R.steps;
      const secs = []; st.forEach((s, i) => { if (s.t === 'section') secs.push(i); });
      for (const L of LVS) for (const mode of ['gaps', 'droplog', 'skippart']) {
        seed = (id.length * 7919 + L * 31 + mode.length + SEED * 104729) % 2147483646 + 1;
        const done = new Set(), log = new Set(), accLv = {};
        st.forEach(s => { if (s.t === 'accept' && s.q && accLv[s.q] == null) accLv[s.q] = s.lv; });
        let skipFrom = -1, skipTo = -1;
        if (mode === 'skippart') { const c = secs.filter(i => st[i].lv < L - 4); if (c.length) { const k = Math.floor(rnd() * c.length); skipFrom = c[k]; skipTo = secs[secs.indexOf(c[k]) + 1] || st.length; } }
        st.forEach((s, i) => {
          if (!s.q || s.t !== 'turnin') return;
          if (s.lv <= L && !(i >= skipFrom && i < skipTo) && !(mode === 'gaps' && rnd() < 0.12)) done.add(s.q);
        });
        st.forEach(s => { if (s.q && s.t === 'accept' && s.lv <= L && !done.has(s.q) && !(mode === 'droplog' && rnd() < 0.4) && !(mode === 'gaps' && rnd() < 0.2)) log.add(s.q); });
        // quests skipped above are neither done nor in the log: the detour must pick them up again
        [...log].forEach(q => { if (done.has(q)) log.delete(q); });
        await p.evaluate(([d, l, L]) => window.__lrT.set(d, l, L), [[...done], [...log], L]);
        const cu = await p.evaluate(() => window.__lrT.cu()), fwd = await p.evaluate(() => window.__lrT.fwd()); nScen++;
        const have = new Set([...done, ...log]), turned = new Set(done), objd = new Set(), hasDo = new Set(st.filter(s => s.t === 'do' && s.q).map(s => s.q));
        const chk = (x, where) => {
          if (x.q && x.t === 'do') objd.add(x.q);
          if (!x.q || x.done) { if (x.q && x.t === 'turnin' && x.done) turned.add(x.q); return; }
          const m = META.quests[x.q], pre = (m && m[9]) || [[], []];
          if (x.t === 'accept') {
            const miss = pre[0].filter(y => !turned.has(y)), one = pre[1].length && !pre[1].some(y => turned.has(y));
            if (miss.length || one) bad.push([id, L, mode, where + ': pickup before pre-quest', x.q, m && m[0], miss.concat(one ? pre[1] : [])]);
            have.add(x.q);
          } else {
            if (!have.has(x.q)) bad.push([id, L, mode, where + ': ' + x.t + ' before pickup', x.q, m && m[0]]);
            if (x.t === 'turnin') { if (hasDo.has(x.q) && !objd.has(x.q)) bad.push([id, L, mode, where + ': hand-in before objectives', x.q, m && m[0]]); turned.add(x.q); }
          }
        };
        if (cu) { nDet++; nStops += cu.sts.length; }
        let prevGi = -1;
        for (const s of cu ? cu.sts : []) {
          if (s.gi <= prevGi) bad.push([id, L, mode, 'order', s.gi]); prevGi = s.gi;
          s.steps.forEach(x => chk(x, 'going back'));
        }
        nFwd += fwd.length; fwd.forEach(r => r.forEach(x => chk(x, 'route ahead')));
        // every quest picked up (going back or ahead) is handed in later on the page
        const accd = new Map(), tins = new Set(turned);
        [...(cu ? cu.sts.map(s => s.steps.map(x => [x, 'going back'])).flat() : []), ...fwd.flat().map(x => [x, 'route ahead'])].forEach(([x, w]) => {
          if (!x.q) return; if (x.t === 'accept' && !x.done && !accd.has(x.q)) accd.set(x.q, w); if (x.t === 'turnin') tins.add(x.q); });
        accd.forEach((w, q) => { if (!tins.has(q)) bad.push([id, L, mode, w + ': picked up, never handed in', q, META.quests[q] && META.quests[q][0]]); });
      }
      await p.close();
      process.stdout.write(id + ' ');
    }
    await ctx.close();
  };
  const N = 4, parts = Array.from({ length: N }, (_, k) => ids.filter((_, i) => i % N === k));
  await Promise.all(parts.map(worker));
  console.log('\nroutes', ids.length, 'scenarios', nScen, 'with a going-back list', nDet, 'going-back stops checked', nStops, 'route-ahead steps checked', nFwd);
  const kinds = {}; bad.forEach(x => kinds[x[3]] = (kinds[x[3]] || 0) + 1);
  console.log('PROBLEMS', bad.length, JSON.stringify(kinds));
  const byQ = {}; bad.forEach(x => { const k = x[3] + ' | ' + x[5] + ' (' + x[4] + ')'; byQ[k] = (byQ[k] || 0) + 1; });
  Object.entries(byQ).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log(' ', v, k));
  if (process.env.SHOWBAD) bad.slice(0, +process.env.SHOWBAD).forEach(x => console.log('  BAD', JSON.stringify(x)));
    console.log('PAGE ERRORS', errs.length, errs.slice(0, 5).join('\n'));
  await b.close(); srv.close();
  if (process.env.OUTJ) fs.writeFileSync(process.env.OUTJ, JSON.stringify({ bad, errs }));   // for scripts/route-checks-compare.cjs
  process.exitCode = bad.length || errs.length ? 1 : 0;
})();
