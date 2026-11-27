#!/usr/bin/env node
// Level route BUTTON check (Jun, 26 Nov: "check every little button and function no matter how long it takes").
//   node scripts/check-level-route-buttons.cjs [route filter]      SEED=n LVS=20,44 MODES=gaps,droplog W=4
// For every base route and many progress states it presses the page's buttons in random order, like a player:
// Where I am, Done, Back, ticking one line, I did everything before this + Undo, Then back to / Back to, part tabs,
// stop clicks, quest search + Show, Skip + Go back first, Dungeons off/on, Leave out / Add back a log quest, reload.
// After every press it checks:
//  - looking around (Where I am, Back to, tabs, Show, search, stops) never changes where you are or the plan
//  - Where I am always shows where you are
//  - Done always moves you on (never stuck), and Back / Undo / untick / off-on / Add back / reload put it all back
//  - the going-back plan never grows: no new stops appear that weren't shown at the start
//  - when going back is finished, you are back where you left off
//  - the order rules of check-level-route.cjs: no objective / hand-in before its pickup, no pickup before its
//    pre-quests, nothing picked up that isn't handed in later
// Exits 1 on any problem or page error.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const FILT = process.argv[2] || '';
const SEED = +(process.env.SEED || 0), LVS = (process.env.LVS || '14,22,30,38,46,54').split(',').map(Number);
const MODES = (process.env.MODES || 'gaps,droplog,skippart').split(','), W = +(process.env.W || 4), MAXA = +(process.env.MAXA || 60);
const PUB = process.env.PUB || path.join(__dirname, '..', 'public'), D = PUB + '/level-route/data/';   // PUB=<folder>: test another copy of the site (the live one, to compare)
const META = JSON.parse(fs.readFileSync(D + 'route-meta.json'));
const HOOK = `
  window.__lrT = {
    set: function (done, log, level, keep) {
      logQ = new Map(); log.forEach(function (q) { logQ.set(q, { ready: false, obj: [], title: '' }); });
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
          return { t: m.s.t, q: m.s.q, done: !!(m.s.q && (doneQ.has(m.s.q) || inLogDone(m.s) || TT[m.s.q])) || !!ticks[m.i + ':' + m.s.t] }; }); })); });
    },
    fwd: function () {
      var h = skipStop ? skipStop.rows[0].n : here;
      return [].concat.apply([], rows.filter(function (r) { return r.k === 'step' && r.n >= h; }).map(function (r) {
        return [{ i: r.i, s: r.s }].concat(r.more || []).map(function (m) {
          return { t: m.s.t, q: m.s.q, done: !!(m.s.q && (doneQ.has(m.s.q) || inLogDone(m.s) || TT[m.s.q])) || !!ticks[m.i + ':' + m.s.t] }; }); }));
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
  let nScen = 0, nDet = 0, nAct = 0, bad = [], errs = [], acts = {};
  const worker = async (list) => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.route('**/level-route/', async rt => { const r = await rt.fetch(); let s = await r.text();
      if (!s.includes('  function loadSPF(text) {')) throw new Error('hook anchor'); s = s.replace('  function loadSPF(text) {', HOOK); await rt.fulfill({ response: r, body: s }); });
    for (const id of list) {
      const R = JSON.parse(fs.readFileSync(D + 'routes/' + id + '.json'));
      const p = await ctx.newPage(); let pe = [];
      p.on('pageerror', e => { pe.push(e.message); errs.push(id + ': ' + e.message); });
      await p.addInitScript(([r, c]) => { if (!sessionStorage.getItem('init')) { localStorage.clear(); sessionStorage.setItem('init', 1); } localStorage.setItem('lr.race', r); localStorage.setItem('lr.cls', c); }, [R.race, R.cls]);
      const open = async () => { await p.goto('http://127.0.0.1:' + PORT + '/level-route/', { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__lrT && window.__lrT.qa(), null, { timeout: 60000 }); await p.waitForTimeout(300); };
      await open();
      const st = R.steps, secs = []; st.forEach((s, i) => { if (s.t === 'section') secs.push(i); });
      for (const L of LVS) for (const mode of MODES) {
        const { rnd, pickOne } = gen((id.length * 7919 + L * 31 + mode.length + SEED * 104729) % 2147483646 + 1);
        const done = new Set(), log = new Set();
        let skipFrom = -1, skipTo = -1;
        if (mode === 'skippart') { const c = secs.filter(i => st[i].lv < L - 4); if (c.length) { const k = Math.floor(rnd() * c.length); skipFrom = c[k]; skipTo = secs[secs.indexOf(c[k]) + 1] || st.length; } }
        st.forEach((s, i) => { if (s.q && s.t === 'turnin' && s.lv <= L && !(i >= skipFrom && i < skipTo) && !(mode === 'gaps' && rnd() < 0.12)) done.add(s.q); });
        st.forEach(s => { if (s.q && s.t === 'accept' && s.lv <= L && !done.has(s.q) && !(mode === 'droplog' && rnd() < 0.4) && !(mode === 'gaps' && rnd() < 0.2)) log.add(s.q); });
        [...log].forEach(q => { if (done.has(q)) log.delete(q); });
        const tag = [id, L, mode];
        const B = (what, ...x) => { if (bad.length < 5000) bad.push([...tag, what, ...x]); };
        const S = () => p.evaluate(() => window.__lrT.st());
        const ev = (f, a) => p.evaluate(f, a);
        await ev(([d, l, L]) => window.__lrT.set(d, l, L), [[...done], [...log], L]); nScen++;
        // order rules (same as check-level-route.cjs, plus ticks)
        const order = async (why) => {
          const cu = await ev(() => window.__lrT.cu()), fwd = await ev(() => window.__lrT.fwd()), tk = await ev(() => window.__lrT.ticked());
          const dbgCb = process.env.DEBUG ? await ev(() => window.__lrCb != null ? window.__lrCb + ' ' + window.__lrT.dump(+String(window.__lrCb).split(':')[1]) : '') : '';
          const have = new Set([...done, ...log, ...tk.a]), turned = new Set([...done, ...tk.t]), accd = new Map(), tins = new Set(turned);
          const chk = (x, where) => {
            if (!x.q) return;
            if (x.done) { if (x.t === 'turnin') { turned.add(x.q); tins.add(x.q); } if (x.t === 'accept') have.add(x.q); return; }
            const m = META.quests[x.q], pre = (m && m[9]) || [[], []];
            if (x.t === 'accept') {
              const miss = pre[0].filter(y => !turned.has(y)), one = pre[1].length && !pre[1].some(y => turned.has(y));
              if ((miss.length || one) && !tk.a.includes(x.q)) B(why + ' / ' + where + ': pickup before pre-quest', x.q, m && m[0]);   // you ticked its objective: you hold it
              have.add(x.q); if (!accd.has(x.q)) accd.set(x.q, where);
            } else {
              if (!have.has(x.q)) B(why + ' / ' + where + ': ' + x.t + ' before pickup', x.q, m && m[0], process.env.DEBUG ? JSON.stringify({ cb: dbgCb, cu: (cu || []).map(s => s.map(y => y.t[0] + y.q + (y.done ? 'D' : '')).join(' ')), tk: tk }) : '');
              if (x.t === 'turnin') { turned.add(x.q); tins.add(x.q); }
            }
          };
          (cu || []).forEach(s => s.forEach(x => chk(x, 'going back'))); fwd.forEach(x => chk(x, 'route ahead'));
          accd.forEach((w, q) => { if (!tins.has(q)) B(why + ' / ' + w + ': picked up, never handed in', q, META.quests[q] && META.quests[q][0]); });
        };
        const same = (a, b) => a.here === b.here && a.skip === b.skip && a.pick === b.pick && a.plan.join() === b.plan.join() && a.fwd === b.fwd;
        const sn = i => { const x = st[i]; if (typeof i === 'string') { const m = /^q(\d+):(\w+)$/.exec(i); return 'log ' + m[2] + ':' + ((META.quests[m[1]] || [])[0] || m[1]); } return x ? i + ':' + x.t + ':' + ((META.quests[x.q] || [])[0] || x.q || '') : i + ':added'; };
        const diff = (a, b) => ({ here: [a.name, b.name], pick: a.pick === b.pick ? undefined : [a.pick, b.pick], plan: a.plan.length + '>' + b.plan.length,
          lost: a.plan.filter(x => b.plan.indexOf(x) < 0).slice(0, 4).map(sn), gained: b.plan.filter(x => a.plan.indexOf(x) < 0).slice(0, 4).map(sn),
          fwd: a.fwd === b.fwd ? undefined : (() => { const x = a.fwd.split(' '), y = b.fwd.split(' '); let k = 0; while (k < x.length && x[k] === y[k]) k++; return 'from ' + k + ': ' + x.slice(k, k + 3).join(' ') + ' > ' + y.slice(k, k + 3).join(' '); })() });
        await order('start');
        let s0 = await S(); let origin = s0.skip; const plan0 = new Set(s0.plan), going = !!s0.pick; if (going) nDet++;
        let cur = s0, lastDone = null;
        const nav = async (name, f, a) => {   // looking around: nothing may change
          await ev(f, a); const n = await S(); acts[name] = (acts[name] || 0) + 1; nAct++;
          if (!same(cur, n)) B('"' + name + '" changed the route', JSON.stringify(diff(cur, n)));
          cur = n;
        };
        const roundTrip = async (name, f1, f2, a) => {   // do and undo: everything must come back
          const tk0 = process.env.RERENDER ? await ev(() => JSON.stringify([window.__lrT.tk(), localStorage.length, Object.keys(localStorage).sort().map(k => k + '=' + String(localStorage.getItem(k)).length)])) : '';
          await ev(f1, a); const mid = await S(); await order(name);
          if (typeof origin === 'number' && typeof mid.here === 'number') mid.gapO = mid.here < origin ? await ev(([x, y]) => window.__lrT.gap(x, y, 1), [mid.here, origin]) : await ev(([x, y]) => window.__lrT.gap(x, y), [origin, mid.here]);   // lines left undone between where you left off and here
          if (process.env.DEBUGMID) mid.dbg = await ev((DM) => window.__lrT.dbgHere() + ' || ' + window.__lrT.dump(DM), +process.env.DEBUGMID);
          await ev(f2, a); const n = await S(); acts[name] = (acts[name] || 0) + 1; nAct++;
          if (!same(cur, n) && process.env.RERENDER) { await ev(() => window.__lrT.rr()); const n2 = await S(); console.log('RERENDER same as before?', same(cur, n2), 'same as after?', same(n, n2), '\n', tk0, '\n', await ev(() => JSON.stringify([window.__lrT.tk(), localStorage.length, Object.keys(localStorage).sort().map(k => k + '=' + String(localStorage.getItem(k)).length)]))); }
          if (!same(cur, n)) B('"' + name + '" then undo did not put it back', JSON.stringify(diff(cur, n)), process.env.DEBUG ? JSON.stringify(await ev(() => [window.__lrCb, window.__lrMiss, window.__lrDbg, window.__lrT.dump(1700)])) : '');
          cur = n; return mid;
        };
        for (let k = 0; k < MAXA && cur.here != null; k++) {
          if (pe.length) break;
          const r = rnd();
          if (r < 0.10) await nav('Where I am', () => document.getElementById('hereBtn').click());
          else if (r < 0.16) await nav('Back to / Then back to', () => { const x = [...document.querySelectorAll('[data-go]')].filter(b => /back to/i.test(b.textContent)); if (x.length) x[x.length - 1].click(); });
          else if (r < 0.21) await nav('part tab', (t) => { const x = [...document.querySelectorAll('#tabs [data-ch]')]; if (x.length) x[Math.floor(t * x.length)].click(); }, rnd());
          else if (r < 0.25) await nav('stop click', (t) => { const x = [...document.querySelectorAll('#side [data-st]')]; if (x.length) x[Math.floor(t * x.length)].click(); }, rnd());
          else if (r < 0.28) await nav('Show (start box)', (t) => { const x = [...document.querySelectorAll('#startBody [data-go]')]; if (x.length) x[Math.floor(t * x.length)].click(); }, rnd());
          else if (r < 0.31) {
            const q = pickOne(st.filter(s => s.q && s.t === 'turnin')).q, nm = (META.quests[q] || [])[0];
            if (nm) await nav('quest search + Show', async (nm) => { const i = document.getElementById('qs'); i.value = nm; i.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 400)); const b = document.querySelector('#qres [data-go]'); if (b) b.click(); i.value = ''; i.dispatchEvent(new Event('input')); }, nm);
          }
          else if (r < 0.36 && lastDone) {   // Back right after a Done: back to the state before the Done
            await ev(() => document.getElementById('backBtn').click()); const n = await S(); acts.Back = (acts.Back || 0) + 1; nAct++;
            if (!same(lastDone, n)) B('"Back" after Done did not put it back', JSON.stringify(diff(lastDone, n)), process.env.VERBOSE ? await ev(() => window.__lrT.dbgHere() + ' TICKS ' + JSON.stringify(window.__lrT.tk())) : '');
            cur = n; lastDone = null;
          }
          else if (r < 0.41) await roundTrip('tick one line, untick it', (t) => { document.getElementById('hereBtn').click(); const x = [...document.querySelectorAll('#side .stop.here input[type=checkbox][data-r], #side input[type=checkbox][data-r]')].filter(c => !c.checked); if (x.length) { window.__lrCb = window.__lrT.rowI(+x[Math.floor(t * x.length)].dataset.r); x[Math.floor(t * x.length)].click(); } else window.__lrCb = null; },
            () => { if (window.__lrCb == null) return; const n = window.__lrT.rowN(window.__lrCb), c = n == null ? null : document.querySelector('#side input[type=checkbox][data-r="' + n + '"]'); if (c && c.checked) c.click(); else window.__lrT.untickI(window.__lrCb); }, rnd());   // a done stop folds: untick that line
          else if (r < 0.45) await roundTrip('I did everything before this + Undo', (t) => { const x = [...document.querySelectorAll('#side [data-st]')]; if (x.length) x[Math.floor(t * x.length)].click(); const sb = document.getElementById('startBtn'); if (!sb.hidden) sb.click(); },
            () => { const u = document.getElementById('undoBtn'); if (!u.hidden) u.click(); document.getElementById('hereBtn').click(); }, rnd());
          else if (r < 0.48) await roundTrip('Dungeons off, on', () => { const c = document.getElementById('dunSw'); c.checked = !c.checked; c.onchange(); }, () => { const c = document.getElementById('dunSw'); c.checked = !c.checked; c.onchange(); });
          else if (r < 0.51 && cur.pick) {
            const mid = await roundTrip('Skip, Go back first', () => { const x = document.querySelector('[data-skip]'); if (x) x.click(); }, () => { const x = document.querySelector('[data-unskip]'); if (x) x.click(); });
            if (mid.pick) B('"Skip" left a going-back part', mid.pick); else if (mid.here !== origin && mid.gapO) B('"Skip" did not go back to where you left off', mid.name, 'left off at step ' + origin + ', now ' + mid.here + (process.env.VERBOSE ? ' ' + JSON.stringify(s0.name) : '') + (mid.dbg || ''));
          }
          else if (r < 0.54) await roundTrip('Leave out / Add back a log quest', (t) => { const x = [...document.querySelectorAll('[data-logq]')]; window.__lrLq = x.length ? x[Math.floor(t * x.length)].dataset.logq : null; if (window.__lrLq) x[Math.floor(t * x.length)].click(); },
            () => { if (!window.__lrLq) return; let b = document.querySelector('[data-logq="' + window.__lrLq + '"]'); if (!b) { const t = [...document.querySelectorAll('[data-ys]')].find(x => /log/i.test(x.textContent)); if (t) t.click(); b = document.querySelector('[data-logq="' + window.__lrLq + '"]'); } if (b) b.click(); }, rnd());
          else if (r < 0.57) {   // reload the page: ticks are saved, your files are loaded again
            await open(); await ev(([d, l, L]) => window.__lrT.set(d, l, L, true), [[...done], [...log], L]);
            const n = await S(); acts.reload = (acts.reload || 0) + 1; nAct++;
            if (!same(cur, n)) B('reload changed the route', JSON.stringify(diff(cur, n)));
            cur = n; lastDone = null;
          }
          else {   // Done on where you are
            await ev(() => document.getElementById('hereBtn').click());
            if (process.env.WQ) console.log('BEFORE', k, cur.name, await ev((q) => window.__lrT.wt(q), +process.env.WQ));
            const before = await S(); const dbgB = process.env.VERBOSE ? await ev(() => window.__lrT.dbgHere()) : ''; await ev(() => document.getElementById('doneBtn').click()); const n = await S(); acts.Done = (acts.Done || 0) + 1; nAct++;
            if (process.env.WQ) console.log('AFTER ', k, n.name, await ev((q) => window.__lrT.wt(q), +process.env.WQ));
            if (process.env.DEBUG) console.log('CANDS', k, JSON.stringify(await ev(() => window.__lrDbg)));
            if (process.env.DEBUG) await ev(() => { window.__lrDbg = []; });
            if (n.here === before.here && n.name === before.name && n.here != null && !n.hereDone) B('"Done" did not move you on', before.name, process.env.VERBOSE ? dbgB + ' ==> ' + await ev(() => window.__lrT.dbgHere()) : '');
            const nw = n.plan.filter(x => !plan0.has(x)); if (nw.length) { B('going back: new stop after Done', n.name, 'after Done on ' + before.name + ': ' + nw.slice(0, 4).map(sn).join(', '), dbgB, process.env.VERBOSE ? 'NOW: ' + await ev(() => window.__lrT.dbgHere()) : ''); nw.forEach(x => plan0.add(x)); }
            if (!before.pick && n.pick) origin = n.skip;   // a new going-back list (reported above if it has new stops)
            if (before.pick && !n.pick && n.here !== origin && (n.here < origin ? await ev(([a, b]) => window.__lrT.gap(a, b, 1), [n.here, origin]) : await ev(([a, b]) => window.__lrT.gap(a, b), [origin, n.here]))) B('going back finished, but not back where you left off', n.name, 'left off at step ' + origin + ', now ' + n.here + (process.env.DEBUG ? ' ' + await ev((a) => window.__lrT.dump(a), Math.floor(Math.min(origin, n.here))) : ''));
            await order('after Done'); lastDone = before; cur = n;
          }
          if (process.env.VERBOSE) console.log(id, L, mode, k, r.toFixed(2), cur.name, cur.pick, 'plan', cur.plan.length, process.env.VERBOSE > 1 ? await ev(() => window.__lrT.cn()) : '', process.env.VERBOSE > 2 ? '\n   ' + await ev(() => window.__lrT.dbgHere()) : '');
          if (pe.length) { B('page error', pe[0]); break; }
        }
        // clean up for the next scenario: no skips, no ticks
        await ev(() => { localStorage.setItem('lr.skip', ''); localStorage.setItem('lr.logoff', ''); const c = document.getElementById('dunSw'); if (!c.checked) { c.checked = true; c.onchange(); } });
        pe = [];
      }
      await p.close(); process.stdout.write(id + ' ');
    }
    await ctx.close();
  };
  const parts = Array.from({ length: W }, (_, k) => ids.filter((_, i) => i % W === k));
  await Promise.all(parts.map(worker));
  console.log('\nroutes', ids.length, 'states', nScen, 'with going back', nDet, 'button presses', nAct, JSON.stringify(acts));
  const kinds = {}; bad.forEach(x => { const k = x[3].replace(/^.* \/ /, ''); kinds[k] = (kinds[k] || 0) + 1; });
  console.log('PROBLEMS', bad.length, JSON.stringify(kinds, null, 1));
  bad.slice(0, 30).forEach(x => console.log('  ', JSON.stringify(x)));
  console.log('PAGE ERRORS', errs.length, errs.slice(0, 5).join('\n'));
  if (process.env.OUTJ) fs.writeFileSync(process.env.OUTJ, JSON.stringify({ bad, errs }));   // for scripts/route-checks-compare.cjs
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(bad, null, 1));
  await b.close(); srv.close();
  process.exitCode = bad.length || errs.length ? 1 : 0;
})();
