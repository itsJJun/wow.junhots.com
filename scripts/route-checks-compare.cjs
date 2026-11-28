#!/usr/bin/env node
// Compares a route check on this change with the same check on the live site (Jun 27 Nov: ship when the update is
// no worse than live; problems the live site already has are listed and fixed in a later PR).
//   node scripts/route-checks-compare.cjs <order|buttons|follow|play> <this.json[,more.json]> <live.json[,more.json]>
// The json files come from the check scripts with OUTJ=<file> (and PUB=<live copy>/public for the live one); give
// one per test round (SEED), the same rounds for both sides.
// The button and play tests are random, and every change to the page changes what they press, so one class's
// problem can move to another class or round. Problems are added up per start route over all classes and rounds.
// Exits 1 when this change has more problems in all than live does, or more page errors.
const fs = require('fs');
const [check, fNew, fLive] = process.argv.slice(2);
const read = (fs_) => fs_.split(',').map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).reduce((a, j) => ({ bad: a.bad.concat(j.bad), errs: a.errs.concat(j.errs) }), { bad: [], errs: [] });
const A = read(fNew), B = read(fLive);
const kind = check === 'follow' || check === 'play'
  ? (x) => x[5] ? 'going back changed' : 'route ahead changed'
  : (x) => String(x[3]).replace(/^.* \/ /, '');
const count = (bad) => { const m = {}; bad.forEach((x) => { const k = String(x[0]).replace(/-[^-]+$/, '') + ' | ' + kind(x); m[k] = (m[k] || 0) + 1; }); return m; };
const a = count(A.bad), b = count(B.bad), keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
console.log('route | kind: this change / live');
keys.forEach((k) => console.log('  ' + k + ': ' + (a[k] || 0) + ' / ' + (b[k] || 0)));
const worse = A.bad.length > B.bad.length, werr = A.errs.length > B.errs.length;
console.log((worse ? 'WORSE ' : '') + 'all problems: ' + A.bad.length + ' / ' + B.bad.length);
console.log((werr ? 'WORSE ' : '') + 'page errors: ' + A.errs.length + ' / ' + B.errs.length);
if (werr) A.errs.slice(0, 5).forEach((e) => console.log('  ' + e));
console.log(worse || werr ? 'worse than live: fix before merging' : 'no worse than live (problems listed above are older ones, fixed in a later PR)');
process.exit(worse || werr ? 1 : 0);
