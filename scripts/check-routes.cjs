#!/usr/bin/env node
// Check the Profession leveling planner's routes, after scripts/build_site.py:
//   node scripts/check-routes.cjs
// Runs the page's own planner (ENGINE + DATA from public/profession-leveling/index.html, built-in prices) for every
// profession from several start skills, with no recipes known and with every recipe known, and fails when:
// 1. Pricier pick: a run of one recipe costs over 10% more than the cheapest recipe at each of its skills would
//    (a run may cost a little more than the cheapest at its last points: that saves a short switch, see 2).
// 2. Short detour: a run of one recipe that the recipe just before or after it could do for at most 10% more
//    (3% for runs over 5 points). Jun, 25 Nov: one point of Jungle Stew (12s 95c to buy) between Rockscale Cod and
//    Spider Sausage (3s 74c), a near tie after vendor sales.
// Exits 1 on any problem.
const fs = require('fs'), path = require('path'), vm = require('vm');

const html = fs.readFileSync(process.env.PL_PAGE || path.join(__dirname, '..', 'public', 'profession-leveling', 'index.html'), 'utf8');
const a = html.indexOf('const ENGINE = (function'), b = html.indexOf('module.exports = ENGINE;', a);
const d = html.indexOf('const DATA = '), e = html.indexOf('\n', d);
if (a < 0 || b < 0 || d < 0) { console.log('Route check: planner not found in the page'); process.exit(1); }
const ctx = {};
vm.runInNewContext(html.slice(a, b) + '0;\nthis.ENGINE = ENGINE;\n' + html.slice(d, e).replace(/^const DATA = /, 'this.DATA = '), ctx);
const { ENGINE, DATA } = ctx;

// the page's built-in prices: cheapest of auction house and vendor, else the wowtbc estimate
function price(id, sell) {
  const it = DATA.items[String(id)] || {};
  if (sell) { const x = it.lo || it.a || it.t; return x ? { c: x * 0.95, src: 'ah' } : null; }
  let p = null;
  if (it.v) p = { c: it.v, src: 'vendor' };
  if (it.a && (!p || it.a < p.c)) p = { c: it.a, src: 'ah' };
  if (!p && it.t) p = { c: it.t, src: 'est' };
  return p;
}
const perCraft = 20, TOL = 0.10, TOL_LONG = 0.03, bad = [];
let routes = 0, steps = 0;
for (const prof of Object.keys(DATA.profs)) {
  const P = DATA.profs[prof];
  for (const allKnown of [false, true]) for (const from of [1, 50, 100, 150, 200, 250]) {
    const known = new Set(allKnown ? P.recipes.filter(r => r.src === 'recipe').map(r => r.id) : []);
    const opts = { price, sell: true, de: true, deFactor: 0.6 / 0.95, patterns: true, profit: false, perCraft,
      ownedRods: new Set(['Runed Copper Rod'].concat(P.vtools || [])), known, banned: new Set(), deFull: new Set() };
    const m = ENGINE.make(DATA, prof, opts), pl = m.plan(from, 300), st = pl.res.steps;
    const unl = new Set(pl.unlocks.map(u => u.key)), name = prof + ' from ' + from + (allKnown ? ' (all known)' : '');
    routes++;
    const costAt = (x, s) => {   // expected cost of one point with x at s, or null if x can't be used there
      const r = x.r;
      if (s < r.l || s >= r.s[2]) return null;
      if (r.src === 'recipe' && r.buy && !known.has(r.id) && !unl.has('p' + r.id)) return null;
      if ((r.tools || []).some(t => !opts.ownedRods.has(t) && !unl.has('t' + t))) return null;
      const p = ENGINE.chance(r, s); if (p <= 0) return null;
      let net = x.cost - x.cred; if (net < 0) net = 0;
      return (net + perCraft) / p;
    };
    const runs = [];
    st.forEach((z, i) => { const L = runs[runs.length - 1];
      if (L && !z.none && !L.none && L.x === z.x && L.free === z.free) L.j = i; else runs.push({ x: z.x, free: z.free, none: z.none, i, j: i }); });
    // 1. no pricier pick
    runs.forEach(R => {
      if (R.none || R.free) return;
      let cost = 0, best = 0, who = '';
      for (let i = R.i; i <= R.j; i++) {
        steps++; cost += st[i].e;
        let min = Infinity; m.recs.forEach(x => { const c = costAt(x, st[i].s); if (c !== null && c < min) { min = c; if (c < st[i].e) who = x.r.n; } });
        best += Math.min(min, st[i].e);
      }
      if (cost > best * (1 + TOL) + 1) bad.push(`${name}: ${st[R.i].s}-${st[R.j].s + 1} ${R.x.r.n} costs ${Math.round(cost)}c, ${who} would be ${Math.round(best)}c`);
    });
    // 2. no short detours
    runs.forEach((R, k) => {
      if (R.none || R.free) return;
      let cost = 0; for (let i = R.i; i <= R.j; i++) cost += st[i].e;
      const tol = cost * (R.j - R.i < 5 ? TOL : TOL_LONG);
      [runs[k - 1], runs[k + 1]].forEach(N => {
        if (!N || N.none || N.free || N.x === R.x) return;
        let c = 0; for (let i = R.i; i <= R.j; i++) { const v = costAt(N.x, st[i].s); if (v === null) return; c += v; }
        if (c <= cost + tol - 1) bad.push(`${name}: ${st[R.i].s}-${st[R.j].s + 1} ${R.x.r.n} (${Math.round(cost)}c) could stay ${N.x.r.n} (${Math.round(c)}c)`);
      });
    });
  }
}
console.log(`Routes: ${routes} planned, ${steps} steps checked.`);
if (bad.length) { console.log(bad.length + ' problem(s):'); bad.slice(0, 40).forEach(x => console.log('  ' + x)); process.exit(1); }
console.log('No pricier picks or short detours.');
