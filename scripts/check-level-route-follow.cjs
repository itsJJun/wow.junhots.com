#!/usr/bin/env node
// Level route FOLLOW check (Jun, 26 Nov: "every time I reload and upload it ... it tells me a different route. If I'm
// following the route and I update it while following it, it should keep it the same").
//   node scripts/check-level-route-follow.cjs [route filter]      SEED=n LVS=20,44 MODES=gaps,droplog W=4 ROUNDS=4
// For every base route and many progress states: press Done a few times like a player following the route, then
// load new game files with that progress (those quests done or in your log, the XP gained, maybe a level up).
// The route must stay the same: what is left of the going-back list and of the route ahead must not change.
// Exits 1 on any change or page error.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const FILT = process.argv[2] || '';
const SEED = +(process.env.SEED || 0), LVS = (process.env.LVS || '14,22,30,38,46,54').split(',').map(Number);
const PLAY = !!process.env.PLAY;
const MODES = (process.env.MODES || 'gaps,droplog,skippart').split(','), W = +(process.env.W || 4), ROUNDS = +(process.env.ROUNDS || 4);
const PUB = process.env.PUB || path.join(__dirname, '..', 'public'), D = PUB + '/level-route/data/';   // PUB=<folder>: test another copy of the site (the live one, to compare)
const META = JSON.parse(fs.readFileSync(D + 'route-meta.json'));
const XPL = [0,400,900,1400,2100,2800,3600,4500,5400,6500,7600,8800,10100,11400,12900,14400,16000,17700,19400,21300,23200,25200,27300,29400,31700,34000,36400,38900,41400,44300,47400,50800,54500,58600,62800,67100,71600,76100,80800,85700,90700,95800,101000,106300,111800,117500,123200,129100,135100,141200,147500,153900,160400,167100,173900,180800,187900,195000,202300,209800];
const HOOK = `
  window.__lrT = {
    set: function (done, log, level, keep, ready) {
      logQ = new Map(); log.forEach(function (q) { logQ.set(q, { ready: !!(ready && ready.indexOf(q) >= 0), obj: [], title: '' }); });
      snap = { name: 'T', level: level, where: null, hearth: '', cls: R.cls, done: done, n: log.length, folded: false, at: '' };
      if (!keep) { ticks = {}; ls.set('lr.skip', ''); ls.set('lr.logoff', ''); saveTicks(); }
      $('char').innerHTML = '<option>T</option>'; applyQuests();
    },
    // a stop's place: its first route step (a line added from your log counts as just after the step before it)
    id1: function (st) { if (!st) return null; for (var k = 0; k < st.rows.length; k++) if (st.rows[k].k === 'step') { var r = st.rows[k]; if (r.i < R.n0) return r.i; for (var n = r.n - 1; n >= 0; n--) if (rows[n].i < R.n0) return rows[n].i + 0.5; return 0.5; } return 'g' + st.gi; },
    st: function () {
      var f = window.__lrT.id1, plan = [], dn = function (r) { return isDone(r); };
      if (pick && skipStop) [hereStop].concat(catchNext()).forEach(function (x) { if (x !== skipStop) x.rows.forEach(function (r) { if (r.k === 'step' && !dn(r)) plan.push(r.i < R.n0 ? r.i : 'q' + r.s.q + ':' + r.s.t); }); });   // a line added from your log: by quest (its number changes)
      var h = pick && skipStop ? skipStop.rows[0].n : here, fwd = [];
      rows.forEach(function (r) { if (r.k === 'step' && r.n >= h && !dn(r) && fwd.length < 300) fwd.push(r.s.q + ':' + r.s.t); });
      return { here: f(hereStop), hereDone: hereStop ? stopDone(hereStop) : null, skip: f(skipStop), sel: f(sel), pick: pick ? (pick.cs || [pick.c.name]).join('|') : '',
        plan: plan, fwd: fwd.join(' '), name: hereStop ? hereStop.ch.name + ' #' + hereStop.num + ' ' + hereStop.title : 'end' };
    },
    // the going-back list and the route ahead, for the order rules (ticked steps count as done)
    cu: function () {
      if (!pick || !skipStop) return null;
      var L = [hereStop].concat(catchNext()).filter(function (x) { return x !== skipStop; });
      return L.map(function (st) { return [].concat.apply([], st.rows.map(function (r) { return r.k !== 'step' ? [] : [{ i: r.i, s: r.s }].concat(r.more || []).map(function (m) {
          return { t: m.s.t, q: m.s.q, done: !!(m.s.q && (doneQ.has(m.s.q) || inLogDone(m.s) || typeof TT !== 'undefined' && TT[m.s.q])) || !!ticks[m.i + ':' + m.s.t] }; }); })); });
    },
    fwd: function () {
      var h = skipStop ? skipStop.rows[0].n : here;
      return [].concat.apply([], rows.filter(function (r) { return r.k === 'step' && r.n >= h; }).map(function (r) {
        return [{ i: r.i, s: r.s }].concat(r.more || []).map(function (m) {
          return { t: m.s.t, q: m.s.q, done: !!(m.s.q && (doneQ.has(m.s.q) || inLogDone(m.s) || typeof TT !== 'undefined' && TT[m.s.q])) || !!ticks[m.i + ':' + m.s.t] }; }); }));
    },
    // quests whose pickup, objective or hand-in you ticked anywhere (they count as in your log / handed in)
    ticked: function () {
      var a = {}, t = {};
      rows.forEach(function (r) { if (r.k === 'step') [{ i: r.i, s: r.s }].concat(r.more || []).forEach(function (m) {
        if (m.s.q && ticks[m.i + ':' + m.s.t]) { if (m.s.t === 'accept' || m.s.t === 'do') a[m.s.q] = 1; if (m.s.t === 'turnin') t[m.s.q] = 1; } }); });
      Object.keys(ticks).forEach(function (k) { var m = /^q(\\d+):(\\w+)$/.exec(k); if (m) { if (m[2] === 'turnin') t[m[1]] = 1; } });
      return { a: Object.keys(a).map(Number), t: Object.keys(t).map(Number) };
    },
    // a line by kind and step ('step:434', 'fp:499': a flight path line shares the number of its step)
    untickI: function (key) { var r = rows.find(function (r) { return r.k + ':' + r.i === key; }); if (r) { setTick(r, false); saveTicks(); render(); } },
    dbgHere: function () { var st = hereStop; return st.ch.name + ' #' + st.num + ' done=' + stopDone(st) + ' :: ' + st.rows.map(function (r) { return r.k + (r.k === 'step' ? ' ' + [{ i: r.i, s: r.s }].concat(r.more || []).map(function (m) { return m.i + ':' + m.s.t + ':' + (M.quests[m.s.q] || [])[0] + (ticks[m.i + ':' + m.s.t] ? ' T' + ticks[m.i + ':' + m.s.t] : '') + (doneQ.has(m.s.q) ? ' D' : '') + (logQ.has(m.s.q) ? ' LOG' : '') + (m.i >= R.n0 ? ' V' : ''); }).join(' + ') : '') + ' isDone=' + isDone(r); }).join(' | ') + ' SEL=' + (sel && sel.gi) + ' HERE=' + st.gi + ' ROWS ' + rows.slice(st.rows[0].n - 1, st.rows[0].n + 5).map(function (r) { return r.n + r.k[0] + r.i + (r.k === 'travel' ? '(' + r.tr.text + ')' : ''); }).join(' ') + ' || ' + st.rows.filter(function (r) { return r.k === 'step' && r.s.q; }).map(function (r) { var q = r.s.q; return q + ' LOCK=' + LOCK[q] + ' steps=' + R.steps.map(function (s, i) { return s.q === q ? i + s.t[0] + (hidden(s) ? 'H' : '') + (LOCKS.has(s) ? 'L' : '') + (plan.skip[i] ? 'S' : '') + (rows.some(function (x) { return x.i === i || (x.more || []).some(function (m) { return m.i === i; }); }) ? 'R' : '') : null; }).filter(Boolean).join(','); }).join(' ; '); },
    rowI: function (n) { return rows[n] ? rows[n].k + ':' + rows[n].i : null; },
    rowN: function (key) { var r = rows.find(function (r) { return r.k + ':' + r.i === key; }); return r ? r.n : null; },
    qa: function () { return !!QA && !!R && rows.length > 0; },   // quest data and the route both loaded
    tk: function () { return Object.keys(ticks).filter(function (k) { return ticks[k]; }); },
    // lines you still have to do between two places (route step numbers); 0 = nothing skipped between them
    // (ro: only the route's own lines, not ones added from your log)
    gap: function (a, b, ro) { var base = -1, n = 0; rows.forEach(function (r) { var v = r.i >= R.n0, x = !v ? (base = r.i) : base + 0.5; if (x >= a && x < b && r.k === 'step' && r.s.t !== 'note' && !isDone(r) && !(ro && v)) n++; }); return n; },
    wt: function (q) { var p = lkAll[q] || q; var e = (window.__trErr || []).filter(function (x) { return x.indexOf(p + ':') === 0; }).slice(-2); window.__trErr = []; return JSON.stringify({ err: e, root: p, worth: WORTH[p], trip: WTRIP[p], lock: LOCK[q], kn: known ? known.size : 'route', here: here, hs: hereStop && hereStop.gi, skipN: skipStop && skipStop.rows[0].n, lkAll: lkAll[q], rowsQ: rows.filter(function (r) { return r.k === 'step' && stepsOf(r).some(function (s) { return s.q === q; }); }).map(function (r) { return r.n + r.s.t[0] + (isDone(r) ? 'd' : ''); }), sts: pick ? pick.sts.map(function (x) { return x.gi; }) : null, pre: (M.quests[q] || [])[9], preDone: ((M.quests[q] || [])[9] || [[], []])[1].map(function (y) { return y + ':' + doneQ.has(y) + logQ.has(y); }) }); },
    stopsN: function () { return stops.length; },
    rr: function () { render(); },
    dump: function (a) { return JSON.stringify(rows.filter(function (r) { return r.k === 'step' && r.i >= a - 8 && r.i < a + 8; }).map(function (r) { return r.n + ':' + r.i + ':' + r.s.t + ':' + r.s.q + (isDone(r) ? 'D' : ''); })) + ' hidden ' + JSON.stringify(R.steps.slice(a - 8, a + 8).map(function (s, k) { return hidden(s) ? a - 8 + k : null; }).filter(function (x) { return x != null; })) + ' here=' + here + ' hs=' + hereStop.num + ' win=' + (myLevel() ? levelWindow(myLevel()) : '') + ' skip=' + ls.get('lr.skip'); },
    cn: function () { return pick && skipStop ? [hereStop].concat(catchNext()).map(function (x) { return x.ch.name + ' #' + x.num + ' ' + x.title + (x === skipStop ? ' (back here)' : ''); }).join(' | ') : ''; },
    logList: function () { return Array.from(logQ.keys()); }
  };
  function loadSPF(text) {`;
// random presses, one generator per state (workers run side by side: a shared one would mix their sequences)
const gen = s0 => { let s = s0; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; return { rnd, pickOne: a => a[Math.floor(rnd() * a.length)] }; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => {
  let f = path.join(PUB, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(PUB)) { r.writeHead(403); return r.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (process.env.PAGE && f === path.join(PUB, 'level-route', 'index.html')) f = process.env.PAGE;   // test a saved copy
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
(async () => {
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok)); const PORT = srv.address().port;
  const b = await chromium.launch();
  const ids = fs.readdirSync(D + 'routes').filter(f => !/-opt\.json$|-u[0-9a-f]{8}\.json$/.test(f) && f.includes(FILT)).map(f => f.replace('.json', ''));
  let nScen = 0, nUp = 0, bad = [], errs = [];
  const worker = async (list) => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.route('**/level-route/', async rt => { const r = await rt.fetch(); let s = await r.text();
      if (!s.includes('  function loadSPF(text) {')) throw new Error('hook anchor'); s = s.replace('  function loadSPF(text) {', HOOK); await rt.fulfill({ response: r, body: s }); });
    for (const id of list) {
      const R = JSON.parse(fs.readFileSync(D + 'routes/' + id + '.json'));
      const xpOf = {}; R.steps.forEach(s => { if (s.t === 'turnin' && s.q) xpOf[s.q] = s.xp || 0; });
      const p = await ctx.newPage();
      p.on('pageerror', e => errs.push(id + ': ' + e.message));
      await p.addInitScript(([r, c]) => { if (!sessionStorage.getItem('init')) { localStorage.clear(); sessionStorage.setItem('init', 1); } localStorage.setItem('lr.race', r); localStorage.setItem('lr.cls', c); }, [R.race, R.cls]);
      await p.goto('http://127.0.0.1:' + PORT + '/level-route/', { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__lrT && window.__lrT.qa(), null, { timeout: 60000 }); await p.waitForTimeout(300);
      const st = R.steps, secs = []; st.forEach((s, i) => { if (s.t === 'section') secs.push(i); });
      for (const L of LVS) for (const mode of MODES) {
        const { rnd } = gen((id.length * 7919 + L * 31 + mode.length + SEED * 104729) % 2147483646 + 1);
        const done = new Set(), log = new Set();
        let skipFrom = -1, skipTo = -1;
        if (mode === 'skippart') { const c = secs.filter(i => st[i].lv < L - 4); if (c.length) { const k = Math.floor(rnd() * c.length); skipFrom = c[k]; skipTo = secs[secs.indexOf(c[k]) + 1] || st.length; } }
        st.forEach((s, i) => { if (s.q && s.t === 'turnin' && s.lv <= L && !(i >= skipFrom && i < skipTo) && !(mode === 'gaps' && rnd() < 0.12)) done.add(s.q); });
        st.forEach(s => { if (s.q && s.t === 'accept' && s.lv <= L && !done.has(s.q) && !(mode === 'droplog' && rnd() < 0.4) && !(mode === 'gaps' && rnd() < 0.2)) log.add(s.q); });
        [...log].forEach(q => { if (done.has(q)) log.delete(q); });
        const ev = (f, a) => p.evaluate(f, a);
        let lvl = L, xp = Math.floor(rnd() * XPL[L] * 0.9);
        await ev(([d, l, L]) => window.__lrT.set(d, l, L), [[...done], [...log], lvl]); nScen++;
        // what is still to do: the going-back list, then the route ahead (quest:kind, one entry per line)
        const left = async () => { const s = await ev(() => window.__lrT.st()); const f = await ev(() => window.__lrT.fwd());
          const cu = [].concat(...((await ev(() => window.__lrT.cu())) || []));
          return { cu: s.plan.length, pick: s.pick, seq: cu.concat(f).filter(x => !x.done && x.q).map(x => x.q + ':' + x.t), name: s.name }; };
        const ready = new Set();
        for (let r = 0; r < ROUNDS; r++) {
          const n = 2 + Math.floor(rnd() * 18);
          let tk;
          if (PLAY) {
            // playing without ticking anything on the page: the next lines are done in the game only
            const b0 = await left(); tk = { a: [], t: [] };
            b0.seq.slice(0, n * 2).forEach(x => { const [q, t] = x.split(':'); if (t === 'accept') tk.a.push(+q); else if (t === 'turnin') tk.t.push(+q); else if (t === 'do') ready.add(+q); });
          } else {
            for (let k = 0; k < n; k++) { await p.click('#doneBtn').catch(() => {}); }
            await p.waitForTimeout(50);
            tk = await ev(() => window.__lrT.ticked());
          }
          const before = await left();
          if (PLAY) { const dn = new Set([...tk.a.map(q => q + ':accept'), ...tk.t.map(q => q + ':turnin'), ...[...ready].map(q => q + ':do')]); before.seq = before.seq.filter(x => !dn.has(x)); }
          // the new game files: hand-ins done, pickups in your log, the XP they gave
          tk.t.forEach(q => { if (!done.has(q)) { done.add(q); xp += xpOf[q] || 0; } log.delete(q); });
          tk.a.forEach(q => { if (!done.has(q)) log.add(q); });
          while (lvl < 60 && xp >= XPL[lvl]) { xp -= XPL[lvl]; lvl++; }
          await ev(([d, l, L, rd]) => window.__lrT.set(d, l, L, true, rd), [[...done], [...log], lvl, [...ready]]); nUp++;
          const after = await left();
          // the same lines, in the same order (only the first 80 matter: what you'd do next). A quest that opens
          // because of what you just did may slot in; lines dropped or swapped are changes.
          const A = before.seq.slice(0, 80), B2 = after.seq.slice(0, 80), Bf = after.seq;
          const nth = (L, x, n) => { for (let i = 0, c = 0; i < L.length; i++) if (L[i] === x && c++ === n) return i; return -1; };   // the same line can come twice (two spots)
          const pos = A.map((x, i) => nth(Bf, x, A.slice(0, i).filter(y => y === x).length)), dropped = A.filter((x, i) => pos[i] < 0);
          let k = 0; while (k < A.length && (pos[k] < 0 ? false : k === 0 || pos[k] > Math.max(...pos.slice(0, k)))) k++;
          if (k < A.length) {
            const gone = dropped.slice(0, 6), added = B2.filter(x => A.indexOf(x) < 0).slice(0, 6);
            bad.push([id, L, mode, 'round ' + (r + 1) + ' lv ' + lvl, (pos[k] < 0 ? 'dropped at line ' : 'moved at line ') + k + ' (' + A[k] + ')',
              before.pick !== after.pick ? 'going back: "' + before.pick + '" -> "' + after.pick + '"' : '', 'gone ' + gone.join(' '), 'new ' + added.join(' '), before.name + ' -> ' + after.name]);
            if (process.env.DUMP) console.log('\n' + id + ' ' + L + ' ' + mode + '\n  before ' + A.join(' ') + '\n  after  ' + B2.join(' ') + '\n  played ' + JSON.stringify(tk));
            break;
          }
        }
      }
      await p.close();
      process.stdout.write(id + ' ');
    }
    await ctx.close();
  };
  const per = Math.ceil(ids.length / W); await Promise.all(Array.from({ length: W }, (_, k) => worker(ids.slice(k * per, (k + 1) * per))));
  console.log('\nroutes ' + ids.length + ' states ' + nScen + ' uploads ' + nUp);
  const kinds = {}; bad.forEach(x => { const k = x[5] ? 'going back changed' : 'route ahead changed'; kinds[k] = (kinds[k] || 0) + 1; });
  console.log('CHANGED ' + bad.length + ' ' + JSON.stringify(kinds));
  bad.slice(0, +(process.env.SHOW || 40)).forEach(x => console.log('  ' + x.filter(Boolean).join(' | ')));
  console.log('PAGE ERRORS ' + errs.length + ' ' + errs.slice(0, 5).join(' / '));
  if (process.env.OUTJ) fs.writeFileSync(process.env.OUTJ, JSON.stringify({ bad, errs }));   // for scripts/route-checks-compare.cjs
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(bad));
  await b.close(); srv.close(); process.exit(bad.length || errs.length ? 1 : 0);
})();
