/* wow.junhots.com: "Game files" menu shared by every page.
   A WoW file loaded once (from this menu or from a tool's own Load button) is kept in this browser (IndexedDB)
   and handed to every tool page that reads it when you open that page (see "always" below).
   Nothing is uploaded: files never leave the visitor's browser. */
(function () {
  'use strict';
  var KINDS = [
    // always: hand it over on every visit (the tools keep prices and bags only until the page closes);
    // GearSnapshot only once per new file, since Gear upgrades saves your gear and you may have edited it since
    { key: 'ah', label: 'AH prices', file: 'Auctionator.lua', match: /auctionator/i, pre: 'Auctionator full scan at the auction house, then /reload', always: true,
      targets: [['#file', '#msg']] },
    { key: 'snap', label: 'Gear & recipes', file: 'GearSnapshot.lua', match: /gearsnapshot/i, pre: 'open your profession windows, then /reload',
      targets: [['#gearfile', '#gearmsg'], ['#knownFile', '.kn-msg']] },
    { key: 'tsm', label: 'Bags & bank', file: 'TradeSkillMaster.lua', match: /tradeskillmaster/i, pre: 'open your bank, then /reload', always: true,
      targets: [['#bagFile', '#haveInfo']] },
    // Level 1-60 route: quests done (Questie, account-wide) and known flights (Shortest Path Forever, per character)
    { key: 'quests', label: 'Quests done', file: 'Questie.lua', match: /^questie\.lua/i, pre: '/reload', always: true, noCopy: true,
      targets: [['#questieFile', '#msg']] },
    { key: 'flights', label: 'Known flights', file: 'ShortestPathForever.lua', match: /^shortestpathforever\.lua/i, pre: 'open a flight map, then /reload', always: true, noCopy: true,
      targets: [['#spfFile', '#msg']] }
  ];
  var BY_INPUT = { file: 'ah', gearfile: 'snap', knownFile: 'snap', bagFile: 'tsm', questieFile: 'quests', spfFile: 'flights' };
  var PAGE = location.pathname;
  var feeding = false;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // ---- tiny IndexedDB store: one record per kind {key, name, at, text} ----
  var dbp;
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('ws-files', 1);  // store 'files': {key, name, at, size, data: ArrayBuffer}
      r.onupgradeneeded = function () { r.result.createObjectStore('files', { keyPath: 'key' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction('files', mode), s = t.objectStore('files'), out = fn(s);
        t.oncomplete = function () { res(out && out.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var getRec = function (k) { return tx('readonly', function (s) { return s.get(k); }); };
  var putRec = function (rec) { return tx('readwrite', function (s) { s.put(rec); }); };
  var delAll = function () { return tx('readwrite', function (s) { s.clear(); }); };
  // a small summary in localStorage so the header can draw without opening the database
  function meta() { try { return JSON.parse(ls.get('ws.files') || '{}'); } catch (e) { return {}; } }
  function setMeta(k, v) { var m = meta(); if (v) m[k] = v; else delete m[k]; ls.set('ws.files', JSON.stringify(m)); }

  var kindOf = function (name, fallback) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].match.test(name)) return KINDS[i];
    return fallback ? KINDS.filter(function (k) { return k.key === fallback; })[0] : null;
  };
  var fedKey = function (k) { return 'ws.fed.' + PAGE + '.' + k; };

  function save(file, fallback) {
    var k = kindOf(file.name, fallback);
    if (!k) return Promise.resolve(null);
    // raw bytes, not text: Auctionator.lua holds binary (CBOR) strings that a text round-trip would break
    return file.arrayBuffer().then(function (data) {
      var rec = { key: k.key, name: file.name, at: Date.now(), mod: file.lastModified || 0, size: data.byteLength, data: data };
      return putRec(rec).then(function () { setMeta(k.key, { name: rec.name, at: rec.at, mod: rec.mod, size: rec.size }); drawDots(); return rec; });
    });
  }

  // ---- hand a stored file to this page's own loader ----
  function targetsHere(k) { return k.targets.filter(function (t) { return $(t[0]); }); }
  function feed(k, rec) {
    var ts = targetsHere(k);
    if (!ts.length) return false;
    ts.forEach(function (t) {
      var input = $(t[0]), dt = new DataTransfer();
      dt.items.add(new File([rec.data], rec.name, { type: 'text/plain', lastModified: rec.at }));
      input.files = dt.files;
      feeding = true;
      try { input.dispatchEvent(new Event('change', { bubbles: true })); } finally { feeding = false; }
    });
    ls.set(fedKey(k.key), String(rec.at));
    return true;
  }

  // ---- WoW folder, linked once (17 Nov). Chrome/Edge: the folder handle is kept in IndexedDB, so later visits
  // re-read the newest save files by themselves (or after one click when the browser asks again).
  // Other browsers: pick the WTF folder each time (input webkitdirectory). Only the three save files are read. ----
  var FSA = typeof window.showDirectoryPicker === 'function';
  var NAMES = { 'auctionator.lua': 'ah', 'tradeskillmaster.lua': 'tsm', 'gearsnapshot.lua': 'snap', 'questie.lua': 'quests', 'shortestpathforever.lua': 'flights' };
  var SKIP = /^(interface|data|cache|logs|errors|screenshots|fonts|utils|_retail_|_classic_|_classic_era_|_ptr_|_beta_)$/i;
  var dirRec = null;
  function getDir() { return dirRec ? Promise.resolve(dirRec) : getRec('dir').then(function (r) { dirRec = r || null; return dirRec; }, function () { return null; }); }
  // Auctionator and TSM keep their data account-wide (Account/<id>/SavedVariables). Each character also gets a tiny
  // Auctionator.lua (Account/<id>/<realm>/<char>/SavedVariables, 38 bytes, written a moment later): never let it win.
  var ACCT = { ah: 1, tsm: 1, quests: 1 };
  function better(k, file, isChar, old) {
    if (!old) return true;
    if (ACCT[k] && old.isChar !== isChar) return !isChar;
    return file.lastModified > old.file.lastModified;
  }
  // folders below "Account" before SavedVariables: 1 = account-wide, 3 = one character, -1 = unknown
  function charPath(parts) {
    var a = -1, sv = -1;
    parts.forEach(function (n, i) { if (/^account$/i.test(n)) a = i; if (/^savedvariables$/i.test(n)) sv = i; });
    return a >= 0 && sv - a - 1 === 3;
  }
  function pickBest(found) {
    var best = {};
    found.forEach(function (x) { if (better(x.k, x.file, x.isChar, best[x.k])) best[x.k] = x; });
    Object.keys(best).forEach(function (k) { best[k] = best[k].file; });
    return best;
  }
  // newest copy of each save file under a folder: works from _forever_, WTF, Account, an account or a SavedVariables folder
  function scanDir(dir) {
    var found = [];
    function walk(d, depth, path) {
      var subs = [], files = [], inSV = /^savedvariables$/i.test(d.name);
      return (async function () { for await (const e of d.values()) (e.kind === 'directory' ? subs : files).push(e); })().then(function () {
        var jobs = [];
        if (inSV) files.forEach(function (f) {
          var k = NAMES[f.name.toLowerCase()];
          if (k) jobs.push(f.getFile().then(function (file) { found.push({ k: k, file: file, isChar: charPath(path) }); }));
        });
        if (depth < 6) {
          var only = subs.filter(function (x) { return /^(wtf|account)$/i.test(x.name); });
          (only.length ? only : subs).forEach(function (x) {
            if (!SKIP.test(x.name)) jobs.push(walk(x, depth + 1, path.concat(x.name)));
          });
        }
        return Promise.all(jobs);
      });
    }
    return walk(dir, 0, [dir.name]).then(function () { return pickBest(found); });
  }
  function takeFiles(best, quiet) {
    var m = meta(), got = [], jobs = [];
    KINDS.forEach(function (k) {
      var f = best[k.key]; if (!f) return;
      if (quiet && m[k.key] && f.lastModified === m[k.key].mod && f.size === m[k.key].size) return;   // same file as last time
      jobs.push(save(f, k.key).then(function (rec) { if (rec) { got.push(k.label); if (!quiet) feed(k, rec); } }));
    });
    return Promise.all(jobs).then(function () { return got; });
  }
  // quiet: page load (no prompts); otherwise a click, which may ask the browser for permission
  function syncFolder(quiet) {
    if (!FSA) return Promise.resolve(null);
    return getDir().then(function (r) {
      if (!r || !r.handle) return null;
      var h = r.handle;
      return h.queryPermission({ mode: 'read' }).then(function (st) {
        if (st === 'granted') return st;
        return quiet ? st : h.requestPermission({ mode: 'read' });
      }).then(function (st) {
        r.ok = st === 'granted';
        if (quiet && st === 'prompt') askBar();
        if (!r.ok) return null;
        return scanDir(h).then(function (best) { return takeFiles(best, quiet); });
      });
    }).catch(function () { return null; });
  }
  function linkFolder() {
    window.showDirectoryPicker({ id: 'wow', mode: 'read', startIn: 'desktop' }).then(function (h) {
      return scanDir(h).then(function (best) {
        if (!Object.keys(best).length) { toast('No WoW save files in “' + esc(h.name) + '”. Pick <b>_forever_</b> or the <b>WTF</b> folder in it.', true); return; }
        dirRec = { key: 'dir', handle: h, name: h.name, ok: true };
        return putRec(dirRec).then(function () { ls.set('ws.dir', h.name); return takeFiles(best, false); })
          .then(function (got) { toast('✓ Linked “' + esc(h.name) + '”: ' + esc(got.join(', ')) + '.'); drawPop(); });
      });
    }, function () {});
  }
  // Chrome asks again once every tab of the site was closed (a reload keeps the old OK). Asking needs a click,
  // so offer one: Chrome's answer then has "Allow on every visit", and after that files load by themselves.
  function askBar() {
    if ($('.ws-ask') || sessionStorage.getItem('ws.ask')) return;
    var bar = document.createElement('div');
    bar.className = 'ws-nudge ws-ask'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<a href="#">Load new game files</a><button type="button" aria-label="Not now" title="Not now">×</button>';
    bar.querySelector('a').onclick = function (e) { e.preventDefault(); bar.remove(); refreshFolder(); };
    bar.querySelector('button').onclick = function () { try { sessionStorage.setItem('ws.ask', '1'); } catch (e) {} bar.remove(); };
    document.body.appendChild(bar);
  }
  function unlinkFolder() { dirRec = null; ls.set('ws.dir', ''); return tx('readwrite', function (s) { s.delete('dir'); }).then(drawPop); }
  function refreshFolder() {
    syncFolder(false).then(function (got) {
      var b = $('.ws-ask'); if (b) b.remove();
      if (got === null) toast('Could not open your WoW folder. Pick it again.', true);
      else toast(got.length ? '✓ Refreshed: ' + esc(got.join(', ')) + '.' : 'No newer files. In game, type /reload first.');
      drawPop();
    });
  }
  // other browsers: a whole folder picked with <input webkitdirectory>
  function pickedFolder(list) {
    var found = [];
    Array.prototype.forEach.call(list, function (f) {
      var k = NAMES[f.name.toLowerCase()], parts = (f.webkitRelativePath || '').split('/');
      if (k && /savedvariables/i.test(f.webkitRelativePath || '')) found.push({ k: k, file: f, isChar: charPath(parts.slice(0, -1)) });
    });
    var best = pickBest(found);
    if (!Object.keys(best).length) { toast('No WoW save files there. Pick the <b>WTF</b> folder inside _forever_.', true); return; }
    takeFiles(best, false).then(function (got) { toast('✓ Loaded: ' + esc(got.join(', ')) + '.'); drawPop(); });
  }
  window.wsFiles = { sync: function () { return syncFolder(false); }, get: getRec, linked: function () { return !!ls.get('ws.dir'); } };
  // the newest Horde auction scan uploaded on /admin/: used when the visitor has not loaded their own Auctionator.lua
  var SITE_SCAN = 'Auctionator (Horde site scan).lua';
  function siteScan() {
    if (!window.fetch) return Promise.resolve(null);
    return fetch('/api/ah/meta').then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (!m || !m.at) { ls.set('ws.site', ''); return null; }
      var built = +(($('meta[name="ws-prices"]') || {}).content || 0);
      if (m.scan && built && m.scan < built) { ls.set('ws.site', ''); return null; }   // the pages' own prices are newer
      ls.set('ws.site', JSON.stringify(m)); drawDots();
      return fetch('/api/ah').then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .then(function (buf) { return buf && { key: 'ah', name: SITE_SCAN, at: m.at, data: buf }; });
    }).catch(function () { return null; });
  }
  function autoFeed() {
    var m = meta();
    KINDS.forEach(function (k) {
      var info = m[k.key];
      if (!info && k.key === 'ah' && targetsHere(k).length) { siteScan().then(function (rec) { if (rec && !meta().ah) feed(k, rec); }); return; }
      if (!info || !targetsHere(k).length) return;
      if (!k.always && +ls.get(fedKey(k.key)) >= info.at) return;   // this page already has this file
      getRec(k.key).then(function (rec) { if (rec) feed(k, rec); });
    });
  }

  // a file picked in a tool's own Load button is kept for the other pages too
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (feeding || !el || el.type !== 'file' || !BY_INPUT[el.id] || !el.files) return;
    Array.prototype.forEach.call(el.files, function (f) {
      save(f, BY_INPUT[el.id]).then(function (rec) { if (rec) ls.set(fedKey(rec.key), String(rec.at)); });
    });
  }, true);

  // ---- header: dots + menu ----
  function siteMeta() { try { return JSON.parse(ls.get('ws.site') || 'null'); } catch (e) { return null; } }
  var short = function (ms) { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  function drawDots() {
    var m = meta(), n = KINDS.filter(function (k) { return m[k.key]; }).length;
    document.querySelectorAll('.ws-dots').forEach(function (d) {
      d.innerHTML = KINDS.map(function (k) { return '<i class="' + (m[k.key] ? 'on' : '') + '"></i>'; }).join('');
    });
    document.querySelectorAll('[data-ws-files]').forEach(function (b) { b.title = n + ' of ' + KINDS.length + ' game files loaded'; });
    if (document.readyState !== 'loading') { factionNote(); startHere(); }   // both depend on which files are loaded
    // side panel: one line per file, like the Hub
    document.querySelectorAll('.ws-fstat').forEach(function (el) {
      el.innerHTML = KINDS.map(function (k) {
        var i = m[k.key], st = k.key === 'ah' && !i ? siteMeta() : null;
        return '<div class="' + (i ? 'ok' : st ? 'site' : '') + '" title="' + esc(st ? 'Horde auction scan the site uses until you load your own ' + k.file : k.file) + '"><i></i>' + esc(k.label) + '<em>' +
          (i ? esc(short(i.at)) : st ? 'site, ' + esc(short(st.scan ? st.scan * 1000 : st.at)) : 'not loaded') + '</em></div>';
      }).join('');
    });
  }
  var when = function (ms) { return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  function drawPop() {
    var pop = $('#wsPop'), m = meta(), site = siteMeta();
    var dname = ls.get('ws.dir');
    var stat = KINDS.map(function (k) {
      var i = m[k.key];
      return '<span class="ws-st' + (i ? ' ok' : '') + '">' + (i ? '✓ ' + esc(k.label) + ', ' + esc(when(i.at)) : '– ' + esc(k.label) + ': in game, ' + esc(k.pre)) + '</span>';
    }).join('');
    var top = FSA ? (dname
        ? '<div class="ws-fold"><b>WoW folder linked</b> <code>' + esc(dname) + '</code><div class="ws-fstats">' + stat + '</div>' +
          '<button type="button" class="ws-fbtn main ws-big" data-ws-refresh>↻ Refresh</button> <span class="ws-hint">after /reload in game</span></div>'
        : '<div class="ws-fold"><b>Link your WoW folder once</b><p>Pick the <code>_forever_</code> folder (or <code>WTF</code> in it). The site finds your files itself.</p>' +
          '<button type="button" class="ws-fbtn main ws-big" data-ws-link>Pick WoW folder</button>' +
          // Chrome refuses folders inside Program Files ("contains system files"): the plain folder upload still works there
          '<p class="ws-alt">Chrome says “system files”? <label>Pick the WTF folder<input type="file" webkitdirectory data-ws-dir></label> instead.</p></div>')
      : '<div class="ws-fold"><b>Load your WoW files</b><p>Pick the <code>WTF</code> folder inside <code>_forever_</code>. Do it again after /reload in game.</p>' +
        '<label class="ws-fbtn main ws-big">Pick WTF folder<input type="file" webkitdirectory data-ws-dir></label>' + (Object.keys(m).length ? '<div class="ws-fstats">' + stat + '</div>' : '') + '</div>';
    pop.innerHTML = top + '<details class="ws-single"' + (FSA && !dname && Object.keys(m).length ? ' open' : '') + '><summary>Single files</summary>' + KINDS.map(function (k) {
      var i = m[k.key];
      return '<div class="ws-frow"><div><b>' + esc(k.label) + '</b> <code>' + esc(k.file) + '</code></div>' +
        '<span class="ws-acts2"><label class="ws-fbtn main">Load<input type="file" accept=".lua,.bak,text/plain" multiple data-ws-kind="' + k.key + '"></label>' +
        (k.noCopy ? '' : '<button type="button" class="ws-fbtn" data-wf-copy="' + k.key + '">Copy path</button>') + '</span>' +
        '<span class="ws-st' + (i ? ' ok' : '') + '">' + (i ? '✓ ' + esc(i.name) + ', ' + esc(when(i.at)) :
          (k.key === 'ah' && site ? 'Using the site\'s Horde auction scan from ' + esc(when(site.scan ? site.scan * 1000 : site.at)) + '. Load yours for your own realm and faction.' : 'Not loaded. In game: ' + esc(k.pre))) + '</span></div>';
    }).join('') +
      (matchMedia('(max-width: 899px), (pointer: coarse)').matches ? '<div class="ws-tip ws-ptip"><b>On a phone?</b> These files are on your gaming PC, so load them there. Files are kept per browser.</div>' : '') +
      '</details><div class="ws-tip">Files stay in this browser. <a href="/setup/">Help</a>' +
      (dname && FSA ? ' · <button type="button" data-ws-unlink>Unlink folder</button>' : '') +
      (Object.keys(m).length ? ' · <button type="button" data-ws-forget>Forget my files</button>' : '') + '</div>';
  }
  var toastT;
  function toast(msg, err) {
    var t = $('#wsToast');
    if (!t) { t = document.createElement('div'); t.id = 'wsToast'; t.className = 'ws-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'ws-toast' + (err ? ' err' : ''); t.innerHTML = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 6000);
  }
  function loadPicked(files, fallback) {
    var done = [];
    return Array.prototype.reduce.call(files, function (p, f) {
      return p.then(function () {
        return save(f, fallback).then(function (rec) {
          if (!rec) { done.push('✗ ' + esc(f.name) + ': not a file this site reads'); return; }
          var k = kindOf(rec.name, rec.key), used = feed(k, rec);
          done.push('✓ ' + esc(k.label) + ' from ' + esc(rec.name) + (used ? ', used on this page' : ', saved for the tools that use it'));
        });
      });
    }, Promise.resolve()).then(function () {
      toast(done.join('<br>'), done.some(function (s) { return s[0] === '✗'; }));
      drawPop();
    });
  }

  function init() {
    drawDots();
    ownerNudge();
    addEventListener('storage', function (e) { if (e.key === 'wf-char' || e.key === 'ws.files') { factionNote(); startHere(); } });
    // phones: the tabs scroll sideways, so bring the current one into view
    document.querySelectorAll('.ws-tabs [aria-current], .ws-sub [aria-current]').forEach(function (a) {
      var box = a.parentElement, x = a.offsetLeft - (box.clientWidth - a.offsetWidth) / 2;
      if (box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, x);
    });
    // side panel: full or icons only (remembered; the <head> script applies it before the page is drawn)
    var min = $('.ws-min');
    if (min) min.addEventListener('click', function () {
      var on = document.documentElement.classList.toggle('ws-mini');
      ls.set('ws.side', on ? 'mini' : 'full');
      min.title = min.ariaLabel = on ? 'Make the menu bigger' : 'Make the menu smaller';
    });
    var cur = $('.ws-snav [aria-current]');
    if (cur) { var sn = cur.parentElement; if (cur.offsetTop + cur.offsetHeight > sn.clientHeight) sn.scrollTop = cur.offsetTop - sn.clientHeight / 2; }
    var pop = $('#wsPop'), btns = document.querySelectorAll('[data-ws-files]');
    if (btns.length && pop) {
      var from = null;
      var place = function () {
        var r = from.getBoundingClientRect();
        if (from.closest('.ws-side')) { pop.style.left = (r.right + 10) + 'px'; pop.style.right = 'auto'; pop.style.top = 'auto'; pop.style.bottom = Math.max(8, innerHeight - r.bottom) + 'px'; }
        else { pop.style.left = 'auto'; pop.style.right = '12px'; pop.style.bottom = 'auto'; pop.style.top = (r.bottom + 8) + 'px'; }
      };
      var open = function (v, b) {
        if (v) { from = b || from || btns[0]; drawPop(); place(); }
        pop.hidden = !v;
        btns.forEach(function (x) { x.setAttribute('aria-expanded', String(v && x === from)); });
      };
      btns.forEach(function (b) { b.addEventListener('click', function () { open(pop.hidden || from !== b, b); }); });
      // "Load your game files" on the home page
      document.addEventListener('click', function (e) {
        var a = e.target.closest('[data-ws-open-files]'); if (!a) return;
        e.preventDefault();
        var vis = Array.prototype.filter.call(btns, function (x) { return x.offsetParent; })[0] || btns[0];
        open(true, vis);
      });
      document.addEventListener('click', function (e) {
        if (!pop.hidden && !e.target.closest('#wsPop') && !e.target.closest('[data-ws-files]') && !e.target.closest('[data-ws-open-files]') && !e.target.closest('#wf-path')) open(false);
      });
      addEventListener('keydown', function (e) { if (e.key === 'Escape') open(false); });
      addEventListener('resize', function () { if (!pop.hidden) place(); });
      pop.addEventListener('change', function (e) {
        var dirIn = e.target.closest('[data-ws-dir]');
        if (dirIn) { e.stopPropagation(); var l = Array.prototype.slice.call(dirIn.files || []); dirIn.value = ''; if (l.length) pickedFolder(l); return; }
        var inp = e.target.closest('[data-ws-kind]'); if (!inp) return;
        e.stopPropagation();
        var files = Array.prototype.slice.call(inp.files || []); inp.value = '';
        if (files.length) loadPicked(files, inp.dataset.wsKind);
      });
      pop.addEventListener('click', function (e) {
        if (e.target.closest('[data-ws-link]')) { linkFolder(); return; }
        if (e.target.closest('[data-ws-refresh]')) { refreshFolder(); return; }
        if (e.target.closest('[data-ws-unlink]')) { unlinkFolder(); return; }
        if (e.target.closest('[data-ws-forget]')) {
          delAll().then(function () { dirRec = null; ls.set('ws.dir', ''); ls.set('ws.files', '{}'); try { localStorage.removeItem('wf-ah'); } catch (e) {} drawDots(); drawPop(); toast('Your game files were removed from this browser.'); });
        }
      });
    }
    // Sell spare mats reads results the Profession leveling planner works out: keep them fresh in the background.
    var need = document.documentElement.dataset.wsNeeds;
    if (need && window.top === window) {
      var f = document.createElement('iframe');
      f.src = need; f.hidden = true; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.loading = 'eager';
      setTimeout(function () { document.body.appendChild(f); }, 400);
    }
  }
  // ---- Alliance players: the site's prices (and census) are Horde's. Race comes from My character / Gear Snapshot ----
  var ALLIANCE = [1, 3, 4, 7, 11, 22, 25, 29, 30, 32, 34, 37];
  function myChar() { try { return JSON.parse(ls.get('wf-char') || '{}') || {}; } catch (e) { return {}; } }
  function factionNote() {
    var old = $('.ws-fnote'); if (old) old.remove();
    if (ALLIANCE.indexOf(+myChar().race) < 0 || meta().ah) return;   // Horde, or their own scan is loaded
    if (!targetsHere(KINDS[0]).length && !/^\/sell-spare-mats\//.test(PAGE)) return;   // no auction prices on this page
    var lead = $('.wf-lead') || $('.wf-head') || $('h1'); if (!lead) return;
    var p = document.createElement('p');
    p.className = 'ws-fnote';
    p.innerHTML = 'These are <b>Horde</b> auction prices. <a href="#" data-ws-open-files>Load your own scan</a> for Alliance prices.';
    lead.insertAdjacentElement('afterend', p);
  }

  // ---- Home: "New here? Start with these" becomes your 3 next steps once the site knows your class and level ----
  var CLASSES = [['WARRIOR', 'Warrior'], ['PALADIN', 'Paladin'], ['HUNTER', 'Hunter'], ['ROGUE', 'Rogue'], ['PRIEST', 'Priest'],
    ['SHAMAN', 'Shaman'], ['MAGE', 'Mage'], ['WARLOCK', 'Warlock'], ['DRUID', 'Druid']];
  var gold = function (c) { c = Math.round(c || 0); var g = Math.floor(c / 10000), s2 = Math.floor(c / 100) % 100; return g ? g + 'g' + (s2 ? ' ' + s2 + 's' : '') : s2 + 's'; };
  function startHere() {
    var sec = $('.ws-start'); if (!sec) return;
    var c = myChar(), cls = (CLASSES.filter(function (x) { return x[0] === c.cls; })[0] || [])[1], lvl = +c.level || 0;
    var pick = $('.ws-pick', sec), cards = sec.querySelectorAll('.ws-steps .ws-card');
    if (!cls || !lvl) {   // ask once: class + level (saved to My character, which every tool reads)
      pick.hidden = false;
      pick.innerHTML = '<label>Your class <select data-c><option value="">Pick</option>' + CLASSES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === c.cls ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') +
        '</select></label><label>Level <input data-l type="number" min="1" max="60" inputmode="numeric" value="' + (lvl || '') + '"></label><button type="button" class="ws-fbtn main" data-go>Show my steps</button>';
      pick.querySelector('[data-go]').onclick = function () {
        var nc = pick.querySelector('[data-c]').value, nl = Math.max(1, Math.min(60, +pick.querySelector('[data-l]').value || 0));
        if (!nc || !nl) { pick.querySelector(nc ? '[data-l]' : '[data-c]').focus(); return; }
        if (window.WFCHAR) WFCHAR.set({ cls: nc, level: nl }); else { c.cls = nc; c.level = nl; ls.set('wf-char', JSON.stringify(c)); }
        startHere();
      };
      return;
    }
    pick.hidden = true;
    var steps = [['/gear-upgrades/', 'Gear for your level ' + lvl + ' ' + cls, 'Upgrades you can wear now, and where to get them']];
    if (!Object.keys(meta()).length && !ls.get('ws.dir')) steps.push(['/setup/', 'Set up once', 'Load your game files: your own gear, bags and prices']);
    var known = {}; try { known = (JSON.parse(ls.get('wf-known') || '{}') || {}).profs || {}; } catch (e) {}
    var prof = Object.keys(known).filter(function (k) { return !/first aid|cooking|fishing/i.test(k) && known[k].rank < known[k].max; })[0];
    steps.push(prof ? ['/profession-leveling/', 'Level ' + prof + ' from ' + known[prof].rank, 'Cheapest way, step by step'] : ['/profession-leveling/', 'Level your professions', 'Cheapest way, step by step']);
    var sm = {}; try { sm = JSON.parse(ls.get('wf-sell-mats') || '{}') || {}; } catch (e) {}
    var rows = (sm.hasHave && sm.rows) || [], tot = rows.reduce(function (a, r) { return a + (r.tot || 0); }, 0);
    steps.push(rows.length && tot >= 100 ? ['/sell-spare-mats/', 'Sell ' + rows.length + ' spare material' + (rows.length > 1 ? 's' : ''), 'About ' + gold(tot) + ' you no longer need'] :
      ['/vendor-flips/', 'Make some gold', 'Buy cheap on the auction house, sell to a vendor for more']);
    $('h2', sec).innerHTML = 'Your next steps <button type="button" class="ws-chg" title="Change class or level">' + esc(cls) + ' ' + lvl + '</button>';
    $('.ws-chg', sec).onclick = function () { var x = myChar(); delete x.level; ls.set('wf-char', JSON.stringify(x)); startHere(); $('[data-l]', sec).value = lvl; };
    steps.slice(0, 3).forEach(function (st, i) { var a = cards[i]; if (!a) return; a.href = st[0]; a.innerHTML = '<b>' + esc(st[1]) + '</b><span>' + esc(st[2]) + '</span>'; });
  }

  // ---- the site owner's reminder (browsers that logged in on /admin/ once): old site prices, new reports ----
  function ownerNudge() {
    if (!ls.get('ws.owner') || /^\/admin/.test(PAGE) || ls.get('ws.nudge') === new Date().toDateString()) return;
    var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    Promise.all([get('/api/ah/meta'), get('/api/fb/new?since=' + (+ls.get('ws.fbseen') || 0))]).then(function (r) {
      var m = r[0], f = r[1], bits = [], t = m && (m.scan ? m.scan * 1000 : m.at);
      var days = t ? Math.floor((Date.now() - t) / 864e5) : 0;
      if (m && m.none) bits.push('No prices uploaded');
      else if (days >= 2) bits.push('Prices ' + days + ' days old');
      if (f && f.n) bits.push(f.n + ' new report' + (f.n > 1 ? 's' : ''));
      if (!bits.length) return;
      var bar = document.createElement('div');
      bar.className = 'ws-nudge'; bar.setAttribute('role', 'status');
      bar.innerHTML = '<a href="/admin/">' + esc(bits.join(' · ')) + '</a><button type="button" aria-label="Hide for today" title="Hide for today">×</button>';
      bar.querySelector('button').onclick = function () { ls.set('ws.nudge', new Date().toDateString()); bar.remove(); };
      document.body.appendChild(bar);
    });
  }
  // ---- "Report a problem": a small form, checked by Cloudflare Turnstile, sent to /api/feedback ----
  var fb, tsId = null, tsReady = null;
  function turnstile(key) {
    if (!tsReady) tsReady = new Promise(function (res, rej) {
      window.wsTsLoad = res;
      var sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=wsTsLoad'; sc.async = true;
      sc.onerror = function () { tsReady = null; rej(new Error('blocked')); };
      document.head.appendChild(sc);
    });
    return tsReady.then(function () {
      var box = $('.ws-ts', fb);
      if (tsId === null) tsId = window.turnstile.render(box, { sitekey: key, theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', size: 'flexible' });
      else window.turnstile.reset(tsId);
    });
  }
  function openFeedback() {
    if (!fb) {
      fb = document.createElement('dialog'); fb.className = 'ws-dlg'; fb.setAttribute('aria-labelledby', 'wsFbH');
      fb.innerHTML = '<form><h2 id="wsFbH">Report a problem</h2>' +
        '<p class="ws-dsub">A wrong price, a wrong item, something that does not work? Say what you saw and it gets fixed.</p>' +
        '<label><div>What is wrong?</div><textarea name="text" rows="5" maxlength="2000" required minlength="5"></textarea></label>' +
        '<label><div>How to reach you <span>(optional)</span></div><input name="contact" maxlength="120" autocomplete="off" placeholder="Discord name or email, if you want an answer"></label>' +
        '<div class="ws-ts"></div><p class="ws-dmsg" role="status"></p>' +
        '<div class="ws-dacts"><button type="button" data-close>Cancel</button><button type="submit" class="main">Send</button></div></form>';
      document.body.appendChild(fb);
      $('[data-close]', fb).onclick = function () { fb.close(); };
      fb.addEventListener('click', function (e) { if (e.target === fb) fb.close(); });
      $('form', fb).addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, msg = $('.ws-dmsg', fb), btn = $('.main', fb);
        var token = window.turnstile && tsId !== null ? window.turnstile.getResponse(tsId) : '';
        if (!token) { msg.textContent = 'Please wait for the robot check to finish.'; return; }
        btn.disabled = true; msg.textContent = 'Sending…';
        fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: f.text.value, contact: f.contact.value, page: location.pathname + location.search, token: token }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (r) {
            btn.disabled = false;
            if (!r.ok) { msg.textContent = r.j.error || 'That did not work. Please try again.'; turnstile(fb.dataset.key).catch(function () {}); return; }
            f.reset(); msg.textContent = ''; fb.close(); toast('Thanks! Your report was sent.');
          }, function () { btn.disabled = false; msg.textContent = 'Could not reach the site. Check your connection and try again.'; });
      });
    }
    $('.ws-dmsg', fb).textContent = '';
    fb.showModal();
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      if (!c.turnstile) { $('.ws-dmsg', fb).textContent = 'Reports are not switched on yet. Sorry!'; return; }
      fb.dataset.key = c.turnstile;
      return turnstile(c.turnstile);
    }).catch(function () { $('.ws-dmsg', fb).textContent = 'The robot check could not load. Try again in a moment.'; });
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-ws-feedback]')) { e.preventDefault(); openFeedback(); }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // after the tool has set itself up
  var start = function () { setTimeout(function () { syncFolder(true).then(autoFeed, autoFeed); }, 250); };
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
  addEventListener('storage', function (e) { if (e.key === 'ws.files') drawDots(); });
})();
