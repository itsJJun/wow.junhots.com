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
      targets: [['#bagFile', '#haveInfo']] }
  ];
  var BY_INPUT = { file: 'ah', gearfile: 'snap', knownFile: 'snap', bagFile: 'tsm' };
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
      var rec = { key: k.key, name: file.name, at: Date.now(), size: data.byteLength, data: data };
      return putRec(rec).then(function () { setMeta(k.key, { name: rec.name, at: rec.at }); drawDots(); return rec; });
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
    document.querySelectorAll('[data-ws-files]').forEach(function (b) { b.title = n + ' of 3 game files loaded'; });
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
    pop.innerHTML = KINDS.map(function (k) {
      var i = m[k.key];
      return '<div class="ws-frow"><div><b>' + esc(k.label) + '</b> <code>' + esc(k.file) + '</code></div>' +
        '<span class="ws-acts2"><label class="ws-fbtn main">Load<input type="file" accept=".lua,.bak,text/plain" multiple data-ws-kind="' + k.key + '"></label>' +
        '<button type="button" class="ws-fbtn" data-wf-copy="' + k.key + '">Copy path</button></span>' +
        '<span class="ws-st' + (i ? ' ok' : '') + '">' + (i ? '✓ ' + esc(i.name) + ', ' + esc(when(i.at)) :
          (k.key === 'ah' && site ? 'Using the site\'s Horde auction scan from ' + esc(when(site.scan ? site.scan * 1000 : site.at)) + '. Load yours for your own realm and faction.' : 'Not loaded. In game: ' + esc(k.pre))) + '</span></div>';
    }).join('') +
      (matchMedia('(max-width: 899px), (pointer: coarse)').matches ? '<div class="ws-tip ws-ptip"><b>On a phone?</b> These files are on your gaming PC, so load them there. Files are kept per browser.</div>' : '') +
      '<div class="ws-tip">Load a file once and every tool on this site uses it. Files stay in this browser and are never uploaded. <a href="/setup/">How to set up</a>' +
      (Object.keys(m).length ? ' <button type="button" data-ws-forget>Forget my files</button>' : '') + '</div>';
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
        var inp = e.target.closest('[data-ws-kind]'); if (!inp) return;
        e.stopPropagation();
        var files = Array.prototype.slice.call(inp.files || []); inp.value = '';
        if (files.length) loadPicked(files, inp.dataset.wsKind);
      });
      pop.addEventListener('click', function (e) {
        if (e.target.closest('[data-ws-forget]')) {
          delAll().then(function () { ls.set('ws.files', '{}'); try { localStorage.removeItem('wf-ah'); } catch (e) {} drawDots(); drawPop(); toast('Your game files were removed from this browser.'); });
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
  if (document.readyState === 'complete') setTimeout(autoFeed, 250);
  else addEventListener('load', function () { setTimeout(autoFeed, 250); });
  addEventListener('storage', function (e) { if (e.key === 'ws.files') drawDots(); });
})();
