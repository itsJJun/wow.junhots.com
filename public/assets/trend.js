/* Price movement for one item on your auction house (Blizzard's hourly data, site.js wsRaw / wsHist / wsSales).
   Used by Farm finder, Mat timing and Sell spare mats.
   WSTREND.of(raw, hist, id, tsmSpd) -> {now, listed, usual, prev, ch, pts, spd, spdSrc, supply} or null
     now     cheapest buyout per item right now (null = none listed)
     prev    yesterday's usual price (median of its hourly cheapest prices); ch = now vs prev, in % (null = not known)
     u7, vs  usual price of the last 7 days (median of the daily usual prices); vs = now vs u7, in %: the 'vs usual' number.
             Both null until 3 past days have prices (one odd day, like the first partial day, must not set 'usual')
     pts     the usual price of each day (up to 14), then now: the trend line
     spd     sold per day: our own count after 3 full days, else tsmSpd (TSM region data) when given; spdSrc 'ours' / 'tsm'
     supply  days until what is listed now would sell out at that rate
   WSTREND.chg(ch, label) -> '▲ +5%' / '▼ -1%' html;  WSTREND.spark(pts) -> small svg line;  WSTREND.days(supply) -> '4 days'
   WSTREND.speed(t) -> {k: 'fast'|'ok'|'slow', label: 'Fast'|'OK'|'Slow'} or null: how fast it sells (see SPEED below) */
(function () {
  if (window.WSTREND) return;
  function of(raw, hist, id, tsmSpd) {
    id = String(id);
    var r = raw && raw.items && raw.items[id], d = hist && hist.items && hist.items[id];
    if (!r && !d) return null;
    var today = hist ? hist.today : null, days = (d || []).filter(function (x) { return x[2]; });
    var past = days.filter(function (x) { return x[0] < today; });
    var y = past.length && past[past.length - 1][0] === today - 1 ? past[past.length - 1][2] : null;
    var now = r ? r[0] : null;
    var pts = past.slice(-13).map(function (x) { return x[2]; });
    if (now) pts.push(now); else { var t = days.filter(function (x) { return x[0] === today; })[0]; if (t) pts.push(t[2]); }
    var us = past.map(function (x) { return x[2]; }).sort(function (a, b) { return a - b; });
    var u7 = past.slice(-7).map(function (x) { return x[2]; }).sort(function (a, b) { return a - b; });
    u7 = u7.length >= 3 ? u7[u7.length >> 1] : null;
    var s = hist && window.wsSales ? wsSales(hist, id) : null, spd = null, src = null;
    if (s && s.days >= 3) { spd = s.spd; src = 'ours'; } else if (tsmSpd > 0) { spd = tsmSpd; src = 'tsm'; }
    var listed = r ? r[1] : 0;
    return {
      now: now, listed: listed, usual: us.length ? us[us.length >> 1] : null, prev: y,
      ch: now && y ? (now - y) / y * 100 : null, u7: u7, vs: now && u7 ? (now - u7) / u7 * 100 : null, pts: pts, spd: spd, spdSrc: src,
      supply: spd > 0 ? listed / spd : null
    };
  }
  function chg(ch, label) {
    if (ch === null || ch === undefined || !isFinite(ch)) return '<span class="wst-ch">–</span>';
    var r = Math.round(ch), up = r > 0, dn = r < 0;
    return '<span class="wst-ch' + (up ? ' up' : dn ? ' dn' : '') + '">' + (up ? '▲ +' : dn ? '▼ ' : '') + (Math.abs(r) > 999 ? (up ? '999+' : '-999') : r) + '%' +
      (label ? ' <small>' + label + '</small>' : '') + '</span>';
  }
  // SPEED: Fast = everything listed sells within 2 days and 5+ sell a day; Slow = takes over 7 days, or under 1 sells a day; else OK
  function speed(t) {
    if (!t || !(t.spd > 0)) return null;
    var sup = t.supply === null ? 0 : t.supply;
    var k = t.spd < 1 || sup > 7 ? 'slow' : sup <= 2 && t.spd >= 5 ? 'fast' : 'ok';
    return { k: k, label: k === 'fast' ? 'Fast' : k === 'ok' ? 'OK' : 'Slow' };
  }
  function spark(pts, w, h) {
    w = w || 64; h = h || 18;
    if (!pts || pts.length < 2) return '<span class="wst-sp none"></span>';
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), n = pts.length, pad = 2;
    var X = function (i) { return (pad + i * (w - 2 * pad) / (n - 1)).toFixed(1); };
    var Y = function (v) { return (hi === lo ? h / 2 : pad + (hi - v) / (hi - lo) * (h - 2 * pad)).toFixed(1); };
    var line = pts.map(function (v, i) { return (i ? 'L' : 'M') + X(i) + ' ' + Y(v); }).join('');
    return '<svg class="wst-sp" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + line +
      '"/><circle cx="' + X(n - 1) + '" cy="' + Y(pts[n - 1]) + '" r="2"/></svg>';
  }
  function days(x) {
    if (x === null || x === undefined) return '–';
    var n = Math.round(x);
    return x < 1 ? 'under 1 day' : n === 1 ? '1 day' : n < 999 ? n + ' days' : '999+ days';
  }
  var css = '.wst-ch{font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap;color:var(--muted)}' +
    '.wst-ch.up{color:var(--good)}.wst-ch.dn{color:var(--bad)}' +
    '.wst-sp{display:inline-block;vertical-align:middle;overflow:visible}.wst-sp path{fill:none;stroke:var(--muted);stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round}' +
    '.wst-sp circle{fill:var(--accent)}.wst-sp.none{width:64px;height:18px}.wst-ch small{font-size:11px;color:var(--muted)}' +
    '.wst-spd{font-weight:600}.wst-spd.fast{color:var(--good)}.wst-spd.slow{color:var(--bad)}';
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);
  window.WSTREND = { of: of, chg: chg, spark: spark, days: days, speed: speed };
})();
