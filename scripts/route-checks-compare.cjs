#!/usr/bin/env node
// Compares a route check on this change with the same check on the live site (Jun 27 Nov: ship when the update is
// no worse than live; problems the live site already has are listed and fixed in a later PR).
//   node scripts/route-checks-compare.cjs <order|buttons|follow|play> <this.json> <live.json>
// The json files come from the check scripts with OUTJ=<file> (and PUB=<live copy>/public for the live one).
// Problems are counted by route and kind. Exits 1 when this change has more of a kind on a route than live does,
// or more page errors.
const fs = require('fs');
const [check, fNew, fLive] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const A = read(fNew), B = read(fLive);
const kind = check === 'follow' || check === 'play'
  ? (x) => x[5] ? 'going back changed' : 'route ahead changed'
  : (x) => String(x[3]).replace(/^.* \/ /, '');
const count = (bad) => { const m = {}; bad.forEach((x) => { const k = x[0] + ' | ' + kind(x); m[k] = (m[k] || 0) + 1; }); return m; };
const a = count(A.bad), b = count(B.bad), keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
let worse = 0;
console.log('route | kind: this change / live');
keys.forEach((k) => {
  const x = a[k] || 0, y = b[k] || 0, w = x > y;
  if (w) worse++;
  console.log((w ? 'WORSE ' : x < y ? 'better ' : 'same   ') + k + ': ' + x + ' / ' + y);
});
console.log('page errors: ' + A.errs.length + ' / ' + B.errs.length);
if (A.errs.length > B.errs.length) { worse++; A.errs.slice(0, 5).forEach((e) => console.log('  ' + e)); }
console.log(worse ? worse + ' worse than live: fix before merging' : 'no worse than live (problems listed above are older ones, fixed in a later PR)');
process.exit(worse ? 1 : 0);
