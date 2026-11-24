/* NPC hover cards, shared by every page.
   Any element with data-npc="<NPC id or exact name>" (optional data-npc-note="extra words", tabindex="0") gets a card on hover (tap on phones, focus with the keyboard):
   Blizzard's picture of the NPC, title, town and zone, the NPC's faction when it matters, and the zone map with a marker.
   Data: /data/npcs.json (scripts/npc_data.py: QuestieDB spots, AzerothCore model ids, game town outlines), loaded on first use.
   WSNPC.fac() = the player's faction ('A' / 'H') when the site knows their race, else null. */
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
  var data = null, loading = null;
  function load() {
    if (!loading) loading = fetch('/data/npcs.json').then(function (r) { return r.json(); }).then(function (d) { data = d; return d; })
      .catch(function () { loading = null; return null; });
    return loading;
  }
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var FAC = { A: 'Alliance', H: 'Horde' };

  var css = document.createElement('style');
  css.textContent =
    '[data-npc]{cursor:pointer;text-decoration:underline dotted color-mix(in srgb,var(--accent,#d9a441) 70%,transparent);text-underline-offset:3px;text-decoration-thickness:1.5px}' +
    '[data-npc]:hover,[data-npc].ws-npc-on{color:var(--accent,#d9a441)}' +
    '.ws-npc{position:fixed;z-index:9999;width:300px;max-width:calc(100vw - 16px);background:var(--panel,#1c1b19);color:var(--ink,#eee);border:1px solid var(--line,#3a3733);' +
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
    '.ws-npc-map{position:relative;border-top:1px solid var(--line,#3a3733);aspect-ratio:3/2;background:#141413}' +
    '.ws-npc-map img{display:block;width:100%;height:100%}' +
    '.ws-npc-map i{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--accent,#d9a441);border:2px solid #141413;box-shadow:0 0 0 2px var(--accent,#d9a441)}' +
    '.ws-npc-map i:after{content:"";position:absolute;inset:-9px;border-radius:50%;border:2px solid var(--accent,#d9a441);animation:wsNpcPing 1.6s ease-out infinite}' +
    '@keyframes wsNpcPing{from{opacity:.9;transform:scale(.35)}to{opacity:0;transform:scale(1)}}' +
    '@media (prefers-reduced-motion:reduce){.ws-npc-map i:after{animation:none;opacity:0}}' +
    '.ws-npc-map span{position:absolute;right:6px;bottom:5px;font-size:11.5px;padding:1px 6px;border-radius:4px;background:rgba(20,20,19,.78);color:#eee}' +
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
    if (z[1] && s[1] >= 0) h += '<div class="ws-npc-map"><img alt="Map of ' + esc(z[0]) + '" src="/assets/npc/map/' + z[1] + '.webp"><i style="left:' + s[1] + '%;top:' + s[2] + '%"></i>' +
      '<span>Map spot ' + Math.round(s[1]) + ', ' + Math.round(s[2]) + '</span></div>';
    else if (s[1] < 0) h += '<div class="ws-npc-note">Inside the ' + esc(z[0]) + ' dungeon.' + (z[2] ? ' <a href="/dungeons/#' + z[2] + '">Dungeon map</a>' : '') + '</div>';
    else h += '<div class="ws-npc-note">No map for this place yet.</div>';
    if (n.spots.length > 1) h += '<div class="ws-npc-note">Also in ' + n.spots.slice(1).map(function (x) { return esc(place(x)); }).join(' and ') + '.</div>';
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
    var key = el.getAttribute('data-npc'), label = el.textContent.trim() || key, note = el.getAttribute('data-npc-note');
    card.innerHTML = cardHtml(key, label, note);
    document.body.appendChild(card);
    position(el);
    requestAnimationFrame(function () { if (card) card.classList.add('in'); });
    if (!data) load().then(function () { if (cur === el && card) { card.innerHTML = cardHtml(key, label, note); position(el); } });
  }
  function hide() {
    clearTimeout(showT); clearTimeout(hideT);
    if (cur) cur.classList.remove('ws-npc-on');
    if (card) card.remove();
    card = null; cur = null;
  }
  function hideSoon() { clearTimeout(hideT); hideT = setTimeout(hide, 180); }
  var target = function (e) { return e.target.closest ? e.target.closest('[data-npc]') : null; };
  document.addEventListener('pointerover', function (e) {
    var el = target(e); if (!el || e.pointerType === 'touch') return;
    load(); clearTimeout(hideT); clearTimeout(showT);
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
    if (el) { e.preventDefault(); e.stopPropagation(); if (cur === el && lastPtr === 'touch') hide(); else show(el); return; }
    if (card && !card.contains(e.target)) hide();
  }, true);
  document.addEventListener('focusin', function (e) { var el = target(e); if (el && Date.now() - downAt > 600) show(el); });   // keyboard only: a tap is handled by click
  document.addEventListener('focusout', function (e) { if (target(e)) hideSoon(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  addEventListener('scroll', function () { if (card && innerWidth > 520) hide(); }, { passive: true });
  window.WSNPC = { fac: fac, load: load };
})();
