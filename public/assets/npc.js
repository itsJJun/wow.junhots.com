/* NPC hover cards, shared by every page.
   Any element with data-npc="<NPC id or exact name>" (optional data-npc-note="extra words", tabindex="0") gets a card on hover (tap on phones, focus with the keyboard):
   Blizzard's picture of the NPC, title, town and zone, the NPC's faction when it matters, and the zone map with a marker.
   Data: /data/npcs.json (scripts/npc_data.py: QuestieDB spots, AzerothCore model ids, game town outlines), loaded on first use.
   WSNPC.fac() = the player's faction ('A' / 'H') when the site knows their race, else null.
   Items (25 Nov): data-item="<item id or exact name>" gets the item's card: icon, name, slot, Forever's own stats and where it
   comes from (/data/items.json, scripts/item_data.py, from Gear upgrades' item data). data-card-pass lets a mouse click through
   (the element also does something on click, like opening a route stop). */
(function () {
  if (window.WSNPC) return;
  var ALLIANCE = [1, 3, 4, 7, 11, 22, 25, 29, 30, 32, 34, 37];   // same list as site.js
  var LR_RACE = { Human: 'A', Dwarf: 'A', NightElf: 'A', Gnome: 'A', Orc: 'H', Undead: 'H', Tauren: 'H', Troll: 'H' };
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function fac() {
    var c = {}; try { c = JSON.parse(ls('wf-char') || '{}') || {}; } catch (e) {}
    if (+c.race) return ALLIANCE.indexOf(+c.race) >= 0 ? 'A' : 'H';
    return LR_RACE[ls('lr.race')] || null;
  }
  var data = null, loading = null, MINI = null, MAPS = '/level-route/data/maps/';
  var items = null, iLoading = null;
  function loadItems() {
    if (!iLoading) iLoading = fetch('/data/items.json').then(function (r) { return r.json(); }).then(function (d) { items = d; return d; })
      .catch(function () { iLoading = null; return null; });
    return iLoading;
  }
  // ---- the card's map: continent, whole zone, then closer (Jun 25 Nov: zoom in for the exact spot, zoom out to see
  // where the zone is). Zone art + the game's minimap tiles close up are the Level route's (maps/<map>.webp, maps/t/).
  // Continent bounds from the game (UiMapAssignment): x = north, y = west.
  var CONT = { 0: [1415, 'Eastern Kingdoms', -16000, 7466.6, -19199.9, 16000], 1: [1414, 'Kalimdor', -11733.3, 12799.9, -19733.2, 17066.6] };
  var ZOOMS = [0, 1, 2, 4, 8], AR = 2 / 3, TS = 533.3333333;
  var zoomI = Math.max(0, Math.min(4, +(ls('ws.npcz') || 1)));
  // zone percent (0-100) -> world [x, y]; world -> continent pixels (1002 x 668)
  function toWorld(b, u, v) { return [b[3] - v / 100 * (b[3] - b[1]), b[4] - u / 100 * (b[4] - b[2])]; }
  function toCont(c, w) { return [1002 * (c[5] - w[1]) / (c[5] - c[4]), 668 * (c[3] - w[0]) / (c[3] - c[2])]; }
  var f2 = function (v) { return v.toFixed(2); };
  function mapInner(um, zname, u, v, zi) {
    var b = MINI && MINI.um[um], c = b && CONT[b[0]], lv = ZOOMS[zi], h = '', vb, mx, my;
    if (lv === 0 && c) {   // continent: the zone outlined, everything else dimmed
      var p0 = toCont(c, toWorld(b, 0, 0)), p1 = toCont(c, toWorld(b, 100, 100)), pm = toCont(c, toWorld(b, u, v));
      var cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2, w = Math.min(1002, Math.max(600, (p1[0] - p0[0]) * 4)), hh = w * AR;
      var x0 = Math.min(Math.max(0, cx - w / 2), 1002 - w), y0 = Math.min(Math.max(0, cy - hh / 2), 668 - hh);
      vb = [x0, y0, w, hh]; mx = pm[0]; my = pm[1];
      var r = [p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]].map(f2), k = w / 360;
      h = '<image href="' + MAPS + c[0] + '.webp" x="0" y="0" width="1002" height="668"/>' +
        '<path class="wz-dim" d="M0 0H1002V668H0Z M' + r[0] + ' ' + r[1] + 'h' + r[2] + 'v' + r[3] + 'h-' + r[2] + 'Z"/>' +
        '<rect class="wz-box" x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" rx="' + f2(3 * k) + '"/>' +
        '<text class="wz-lab" x="' + f2(cx) + '" y="' + f2(Math.max(y0 + 16 * k, p0[1] - 6 * k)) + '" style="font-size:' + f2(13 * k) + 'px;stroke-width:' + f2(3.5 * k) + 'px">' + esc(zname) + '</text>';
    } else {
      var W = 100 / lv, H = W * AR;
      vb = [Math.min(Math.max(0, u - W / 2), 100 - W), Math.min(Math.max(0, v * AR - H / 2), 100 * AR - H), W, H]; mx = u; my = v * AR;
      h = '<image href="/assets/npc/map/' + um + '.webp" x="0" y="0" width="100" height="' + f2(100 * AR) + '" preserveAspectRatio="none"/>';
      if (lv > 1) h += '<image href="' + MAPS + um + '.webp" x="0" y="0" width="100" height="' + f2(100 * AR) + '" preserveAspectRatio="none"/>';
      if (lv >= 4 && b && MINI.t[b[0]]) {   // close up: the game's minimap tiles (533 yards each) under the zone map's names
        var m = b[0], X0 = b[1], Y0 = b[2], X1 = b[3], Y1 = b[4], tw = TS / (Y1 - Y0) * 100, th = TS / (X1 - X0) * 100 * AR;
        var wy = function (sx) { return Y1 - sx / 100 * (Y1 - Y0); }, wx = function (sy) { return X1 - sy / (100 * AR) * (X1 - X0); };
        var c0 = Math.floor(32 - wy(vb[0]) / TS), c1 = Math.floor(32 - wy(vb[0] + vb[2]) / TS), r0 = Math.floor(32 - wx(vb[1]) / TS), r1 = Math.floor(32 - wx(vb[1] + vb[3]) / TS);
        var g = '';
        for (var rr = r0; rr <= r1; rr++) for (var cc = c0; cc <= c1; cc++) {
          if (!MINI.t[m].has(rr + '_' + cc)) continue;
          g += '<image href="' + MAPS + 't/' + m + '_' + rr + '_' + cc + '.webp" x="' + f2((Y1 - (32 - cc) * TS) / (Y1 - Y0) * 100) + '" y="' + f2((X1 - (32 - rr) * TS) / (X1 - X0) * 100 * AR) +
            '" width="' + f2(tw + 0.02) + '" height="' + f2(th + 0.02) + '" preserveAspectRatio="none"/>';
        }
        h += '<g opacity="0.85">' + g + '</g>';
      }
    }
    var cap = lv === 0 && c ? '<span class="l">' + esc(zname) + ' is in ' + c[1] + '</span>' : '<span>Map spot ' + Math.round(u) + ', ' + Math.round(v) + '</span>';
    return '<svg viewBox="' + vb.map(f2).join(' ') + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + h + '</svg>' +
      '<i style="left:' + f2((mx - vb[0]) / vb[2] * 100) + '%;top:' + f2((my - vb[1]) / vb[3] * 100) + '%"></i>' + cap +
      '<div class="ws-npc-zb"><button type="button" data-nz="-1" title="Zoom out' + (zi === 1 ? ': see where the zone is' : '') + '" aria-label="Zoom out"' + (zi <= (c ? 0 : 1) ? ' disabled' : '') + '>−</button>' +
      '<button type="button" data-nz="1" title="Zoom in" aria-label="Zoom in"' + (zi >= 4 ? ' disabled' : '') + '>+</button></div>';
  }
  function zoomMap(mapEl, d) {
    var a = mapEl.dataset, b = MINI && MINI.um[a.um], lo = b && CONT[b[0]] ? 0 : 1, zi = Math.max(lo, Math.min(4, zoomI + d));
    if (zi === zoomI && d) return;
    zoomI = zi; try { localStorage.setItem('ws.npcz', zi); } catch (e) {}
    mapEl.innerHTML = mapInner(+a.um, a.zn, +a.u, +a.v, Math.max(lo, zi));
  }
  function load() {
    if (!loading) loading = Promise.all(['/data/npcs.json', MAPS + 'mini.json'].map(function (u) { return fetch(u).then(function (r) { return r.json(); }); }))
      .then(function (a) { data = a[0]; MINI = a[1]; for (var m in MINI.t) MINI.t[m] = new Set(MINI.t[m]); return data; })
      .catch(function () { loading = null; return null; });
    return loading;
  }
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var FAC = { A: 'Alliance', H: 'Horde' };

  var css = document.createElement('style');
  css.textContent =
    '[data-npc]{cursor:pointer;text-decoration:underline dotted color-mix(in srgb,var(--accent,#d9a441) 70%,transparent);text-underline-offset:3px;text-decoration-thickness:1.5px}' +
    '[data-npc]:hover,[data-npc].ws-npc-on{color:var(--accent,#d9a441)}' +
    '[data-item]{cursor:pointer;text-decoration:underline dotted color-mix(in srgb,currentColor 55%,transparent);text-underline-offset:3px;text-decoration-thickness:1.5px}' +
    '[data-item]:hover,[data-item].ws-npc-on{text-decoration-style:solid}' +
    /* item card = the in-game tooltip look (dark box, name in quality colour, slot left / type right, white base stats, green Equip lines), Forever's own data */
    '.ws-npc.ws-it{width:300px;background:#080a16;color:#fff;border:1px solid #8a8a8a;border-radius:5px;box-shadow:0 0 0 1px #000,0 8px 24px rgba(0,0,0,.5);font:13px/1.38 Inter,system-ui,sans-serif}' +
    '.ws-it-tt{display:flex;gap:9px;padding:8px 10px 8px}' +
    '.ws-it-ic{flex:0 0 36px;height:36px;border-radius:4px;border:1px solid #000;box-shadow:0 0 0 1px #6b6b6b}' +
    '.ws-it-b{flex:1;min-width:0;display:flex;flex-direction:column}' +
    '.ws-it-b b{font-size:14.5px;line-height:1.3;font-weight:600}' +
    '.ws-it-b .r{display:flex;justify-content:space-between;gap:8px;white-space:nowrap}' +
    '.ws-it-b .g{color:#1eff00}.ws-it-b .y{color:#ffd100}.ws-it-b .m{color:#a49e95;font-size:12px;margin-top:3px}' +
    '.ws-it-src{padding:6px 10px 8px;border-top:1px solid #3a3a46;display:flex;flex-direction:column;gap:2px;font-size:12.5px}' +
    '.ws-it-src div{display:flex;gap:6px}.ws-it-src em{font-style:normal;color:#ffd100;flex:0 0 54px}.ws-it-src .ws-npc-dim{color:#a49e95}' +
    '.ws-q0{color:#9d9d9d}.ws-q1{color:#e8e6e3}.ws-q2{color:#3fd44f}.ws-q3{color:#3d8ef0}.ws-q4{color:#b55af0}.ws-q5{color:#ff8000}' +
    '.ws-npc{position:fixed;z-index:9999;width:360px;max-width:calc(100vw - 16px);background:var(--panel,#1c1b19);color:var(--ink,#eee);border:1px solid var(--line,#3a3733);' +
    'border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.35);font:13px/1.4 Inter,system-ui,sans-serif;overflow:hidden;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;pointer-events:auto}' +
    '.ws-npc.in{opacity:1;transform:none}' +
    '.ws-npc-top{display:flex;gap:10px;padding:10px 12px}' +
    '.ws-npc-pic{flex:0 0 76px;height:96px;border-radius:7px;overflow:hidden;background:#141413;position:relative}' +
    '.ws-npc-pic img{position:absolute;width:190px;height:190px;left:-57px;top:-26px;max-width:none}' +
    '.ws-npc-txt{display:flex;flex-direction:column;gap:2px;min-width:0}' +
    '.ws-npc-txt b{font-size:14px;line-height:1.25}' +
    '.ws-npc-sub,.ws-npc-dim{color:var(--muted,#a49e95)}' +
    '.ws-npc-fac{align-self:flex-start;margin-top:3px;font-size:11.5px;padding:0 6px;border-radius:4px;border:1px solid var(--line,#3a3733)}' +
    '.ws-npc-fac.H{color:#e0614f}.ws-npc-fac.A{color:#5b9bf0}.ws-npc-fac.bad{background:color-mix(in srgb,var(--bad,#e0614f) 14%,transparent)}' +
    '.ws-npc-map{position:relative;border-top:1px solid var(--line,#3a3733);aspect-ratio:3/2;background:#141413;overflow:hidden;touch-action:none}' +
    '.ws-npc-map svg{display:block;width:100%;height:100%}' +
    '.ws-npc-map .wz-dim{fill:rgba(10,9,8,.55);fill-rule:evenodd}' +
    '.ws-npc-map .wz-box{fill:none;stroke:var(--accent,#d9a441);stroke-width:3;vector-effect:non-scaling-stroke}' +
    '.ws-npc-map .wz-lab{fill:#fff;font:700 13px Inter,system-ui,sans-serif;paint-order:stroke;stroke:#141413;stroke-width:3.5px;stroke-linejoin:round;text-anchor:middle}' +
    '.ws-npc-zb{position:absolute;right:6px;top:6px;display:flex;gap:4px}' +
    '.ws-npc-zb button{font:700 16px/1 Inter,system-ui,sans-serif;width:30px;height:28px;padding:0;border-radius:7px;border:1px solid rgba(0,0,0,.4);background:rgba(24,21,17,.88);color:#f3ead9;cursor:pointer}' +
    '.ws-npc-zb button:hover:not(:disabled){background:rgba(24,21,17,1);color:var(--accent,#d9a441)}' +
    '.ws-npc-zb button:disabled{opacity:.35;cursor:default}' +
    '.ws-npc-map i{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--accent,#d9a441);border:2px solid #141413;box-shadow:0 0 0 2px var(--accent,#d9a441)}' +
    '.ws-npc-map i:after{content:"";position:absolute;inset:-9px;border-radius:50%;border:2px solid var(--accent,#d9a441);animation:wsNpcPing 1.6s ease-out infinite}' +
    '@keyframes wsNpcPing{from{opacity:.9;transform:scale(.35)}to{opacity:0;transform:scale(1)}}' +
    '@media (prefers-reduced-motion:reduce){.ws-npc-map i:after{animation:none;opacity:0}}' +
    '.ws-npc-map span{position:absolute;right:6px;bottom:5px;font-size:12px;padding:1px 7px;border-radius:4px;background:rgba(20,20,19,.82);color:#eee}' +
    '.ws-npc-map span.l{right:auto;left:6px}' +
    '.ws-npc-note{padding:8px 12px;border-top:1px solid var(--line,#3a3733);color:var(--muted,#a49e95)}' +
    '@media (max-width:520px){.ws-npc{left:8px!important;right:8px;bottom:8px;top:auto!important;width:auto}}';
  document.head.appendChild(css);

  function findNpc(key) {
    if (!data) return null;
    var id = /^\d+$/.test(key) ? key : data.k[key];
    var n = id && data.n[id];
    return n ? { id: id, name: n[0], sub: n[1], fac: n[2], spots: n[3], disp: n[4] } : null;
  }
  function place(s) {
    var z = data.z[s[0]] || ['', 0], t = s[3] && data.t[s[3]];
    return (t ? t + ', ' : '') + z[0];
  }
  function cardHtml(key, label, note) {
    if (!data) return '<div class="ws-npc-top"><div class="ws-npc-txt"><b>' + esc(label) + '</b><span class="ws-npc-dim">Loading…</span></div></div>';
    var n = findNpc(key);
    if (!n) return '<div class="ws-npc-top"><div class="ws-npc-txt"><b>' + esc(label) + '</b><span class="ws-npc-dim">No map spot for this NPC yet.</span></div></div>';
    var me = fac(), s = n.spots[0], z = data.z[s[0]] || ['', 0];
    var tag = '';
    if (FAC[n.fac] && (!me || me !== n.fac)) tag = '<span class="ws-npc-fac ' + n.fac + (me ? ' bad' : '') + '">' + FAC[n.fac] + ' only</span>';
    var h = '<div class="ws-npc-top">' +
      (n.disp ? '<div class="ws-npc-pic"><img alt="" src="https://render.worldofwarcraft.com/us/npcs/zoom/creature-display-' + n.disp + '.jpg" onerror="this.parentNode.remove()"></div>' : '') +
      '<div class="ws-npc-txt"><b>' + esc(n.name) + '</b>' + (n.sub ? '<span class="ws-npc-sub">&lt;' + esc(n.sub) + '&gt;</span>' : '') +
      '<span>' + esc(place(s)) + '</span>' + (note ? '<span class="ws-npc-dim">' + esc(note) + '</span>' : '') + tag + '</div></div>';
    if (z[1] && s[1] >= 0) {
      var lo = MINI && MINI.um[z[1]] && CONT[MINI.um[z[1]][0]] ? 0 : 1;
      h += '<div class="ws-npc-map" role="img" aria-label="Map of ' + esc(z[0]) + '" data-um="' + z[1] + '" data-zn="' + esc(z[0]) + '" data-u="' + s[1] + '" data-v="' + s[2] + '">' + mapInner(z[1], z[0], s[1], s[2], Math.max(lo, zoomI)) + '</div>';
    }
    else if (s[1] < 0) h += '<div class="ws-npc-note">Inside the ' + esc(z[0]) + ' dungeon.' + (z[2] ? ' <a href="/dungeons/#' + z[2] + '">Dungeon map</a>' : '') + '</div>';
    else h += '<div class="ws-npc-note">No map for this place yet.</div>';
    if (n.spots.length > 1) h += '<div class="ws-npc-note">Also in ' + n.spots.slice(1).map(function (x) { return esc(place(x)); }).join(' and ') + '.</div>';
    return h;
  }

  // ---- item card
  function findItem(key) {
    if (!items) return null;
    var id = /^\d+$/.test(key) ? key : items.k[key];
    var x = id && items.i[id];
    return x ? { id: id, n: x[0], q: x[1], ic: x[2], slot: x[3], typ: x[4], rl: x[5], st: x[6], w: x[7], src: x[8], rnd: x[9] } : null;
  }
  var BASE = /^(-?\d|\+\d).*\b(Stamina|Intellect|Spirit|Strength|Agility|Armor|Resistance)$/;
  function itemHtml(key, label, note) {
    var miss = function (t) { return '<div class="ws-it-tt"><div class="ws-it-b"><b>' + esc(label) + '</b><span class="m">' + t + '</span></div></div>'; };
    if (!items) return miss('Loading…');
    var it = findItem(key);
    if (!it) return miss('No details for this item here yet.' + (/^\d+$/.test(key) ? ' <a href="https://www.wowhead.com/forever/item=' + key + '" target="_blank" rel="noopener" style="color:#ffd100">See it on Wowhead</a>' : ''));
    var me = fac(), w = it.w ? it.w.split('|') : null, L = [];
    L.push('<b class="ws-q' + it.q + '">' + esc(it.n) + '</b>');
    if (it.slot || it.typ) L.push('<div class="r"><span>' + esc(it.slot || '') + '</span><span>' + esc(it.typ || '') + '</span></div>');
    if (w) L.push('<div class="r"><span>' + esc(w[0]) + ' damage per second</span><span>Speed ' + esc(Number(w[1]).toFixed(2)) + '</span></div>');
    var eq = [];
    it.st.forEach(function (x) { if (BASE.test(x) && !/Bonus Armor/.test(x)) L.push('<span>' + esc(x) + '</span>'); else eq.push(x); });
    if (it.rnd) L.push('<span class="g">&lt;Random bonus: "of the …"&gt;</span>');
    if (it.rl > 1) L.push('<span>Requires Level ' + it.rl + '</span>');
    eq.forEach(function (x) { L.push('<span class="g">Equip: ' + esc(x) + '</span>'); });
    if (note) L.push('<span class="m">' + esc(note) + '</span>');
    var h = '<div class="ws-it-tt">' + (it.ic ? '<img class="ws-it-ic" alt="" src="https://wow.zamimg.com/images/wow/icons/medium/' + esc(it.ic) + '.jpg" onerror="this.style.visibility=\'hidden\'">' : '') +
      '<div class="ws-it-b">' + L.join('') + '</div></div>';
    // where it comes from: your faction's quest only, when the site knows your faction
    var src = it.src.filter(function (x) { return x[0] !== 'q' || !me || !x[3] || x[3] === (me === 'A' ? 1 : 2); });
    var rows = src.slice(0, 4).map(function (x) {
      if (x[0] === 'q') return '<div><em>Quest</em><span>' + esc(x[1]) + (x[2] ? ' · <span class="ws-npc-dim">' + esc(x[2]) + '</span>' : '') + '</span></div>';
      if (x[0] === 'd') return '<div><em>Drop</em><span>' + esc(x[1]) + (x[2] ? ' · <span class="ws-npc-dim">' + esc(x[2]) + '</span>' : '') + (x[3] ? ' · ' + Math.max(1, Math.round(x[3])) + '%' : '') + '</span></div>';
      if (x[0] === 'c') return '<div><em>Crafted</em><span>' + esc(x[1]) + (x[2] ? ' ' + x[2] : '') + '</span></div>';
      return '<div><em>Buy</em><span>Auction house</span></div>';
    });
    if (src.length > 4) rows.push('<div><em></em><span class="ws-npc-dim">and ' + (src.length - 4) + ' more</span></div>');
    if (rows.length) h += '<div class="ws-it-src">' + rows.join('') + '</div>';
    return h;
  }

  var card = null, cur = null, hideT = 0, showT = 0;
  function position(el) {
    if (innerWidth <= 520) return;
    var r = el.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    var x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    var y = r.bottom + 6;
    if (y + h > innerHeight - 8 && r.top - h - 6 > 8) y = r.top - h - 6;
    card.style.left = x + 'px'; card.style.top = Math.max(8, y) + 'px';
  }
  function show(el) {
    clearTimeout(hideT);
    if (cur === el && card) return;
    hide(true);
    cur = el; el.classList.add('ws-npc-on');
    card = document.createElement('div');
    card.className = 'ws-npc'; card.setAttribute('role', 'tooltip');
    card.addEventListener('pointerenter', function () { clearTimeout(hideT); });
    card.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hideSoon(); });
    card.addEventListener('click', function (e) { var b = e.target.closest('[data-nz]'); if (b && !b.disabled) zoomMap(b.closest('.ws-npc-map'), +b.dataset.nz); });
    var wheelAt = 0;
    card.addEventListener('wheel', function (e) {
      var m = e.target.closest('.ws-npc-map'); if (!m) return;
      e.preventDefault(); if (Date.now() - wheelAt < 220 || !e.deltaY) return; wheelAt = Date.now();
      zoomMap(m, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    var isItem = el.hasAttribute('data-item'), key = el.getAttribute(isItem ? 'data-item' : 'data-npc'), label = el.textContent.trim() || key;
    var note = el.getAttribute(isItem ? 'data-item-note' : 'data-npc-note'), html = isItem ? itemHtml : cardHtml;
    if (isItem) card.classList.add('ws-it');
    card.innerHTML = html(key, label, note);
    document.body.appendChild(card);
    position(el);
    requestAnimationFrame(function () { if (card) card.classList.add('in'); });
    if (isItem ? !items : !data) (isItem ? loadItems() : load()).then(function () { if (cur === el && card) { card.innerHTML = html(key, label, note); position(el); } });
  }
  function hide() {
    clearTimeout(showT); clearTimeout(hideT);
    if (cur) cur.classList.remove('ws-npc-on');
    if (card) card.remove();
    card = null; cur = null;
  }
  function hideSoon() { clearTimeout(hideT); hideT = setTimeout(hide, 180); }
  var target = function (e) { return e.target.closest ? e.target.closest('[data-npc], [data-item]') : null; };
  document.addEventListener('pointerover', function (e) {
    var el = target(e); if (!el || e.pointerType === 'touch') return;
    if (el.hasAttribute('data-item')) loadItems(); else load();
    clearTimeout(hideT); clearTimeout(showT);
    showT = setTimeout(function () { show(el); }, cur ? 0 : 90);
  });
  document.addEventListener('pointerout', function (e) {
    var el = target(e); if (!el || e.pointerType === 'touch' || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    clearTimeout(showT); hideSoon();
  });
  var lastPtr = 'mouse';
  var downAt = 0;
  document.addEventListener('pointerdown', function (e) { lastPtr = e.pointerType; downAt = Date.now(); }, true);
  document.addEventListener('click', function (e) {
    var el = target(e);
    // a tap opens or closes the card; a mouse click keeps it open (hover already opened it)
    if (el && lastPtr !== 'touch' && el.hasAttribute('data-card-pass')) return;
    if (el) { e.preventDefault(); e.stopPropagation(); if (cur === el && lastPtr === 'touch') hide(); else show(el); return; }
    if (card && !card.contains(e.target)) hide();
  }, true);
  document.addEventListener('focusin', function (e) { var el = target(e); if (el && Date.now() - downAt > 600) show(el); });   // keyboard only: a tap is handled by click
  document.addEventListener('focusout', function (e) { if (target(e) && !(card && e.relatedTarget && card.contains(e.relatedTarget))) hideSoon(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  addEventListener('scroll', function () { if (card && innerWidth > 520) hide(); }, { passive: true });
  window.WSNPC = { fac: fac, load: load, items: loadItems };
})();
