/* WFChar3D: the Gear page's 3D character, drawn from Forever's own game files (export_site.py builds the data).
   var c = WFChar3D.mount(canvas, '/assets/char/');
   c.set({ race: 2, sex: 0, gear: [{ item: 8348 }, { item: 812, slot: 'main' }, ...] })   // wear these (slot 'off' for off-hand)
   Body by race and sex, the game's idle animation, armor painted on the body, helm/shoulders/weapons/shield on their
   attachment points (weapons put away like the game's character panel). Drag to turn. No WebGL2 -> mount returns null. */
(function () {
  'use strict';
  function key(tr, t, n, out, def) {
    var i;
    if (!tr) { for (i = 0; i < n; i++) out[i] = def[i]; return out; }
    var ts = tr[0], vs = tr[1], k = ts.length - 1;
    if (k === 0 || t <= ts[0]) { for (i = 0; i < n; i++) out[i] = vs[i]; return out; }
    if (t >= ts[k]) { for (i = 0; i < n; i++) out[i] = vs[k * n + i]; return out; }
    var a = 0, b = k; while (b - a > 1) { var mid = (a + b) >> 1; if (ts[mid] <= t) a = mid; else b = mid; }
    var f = (t - ts[a]) / ((ts[b] - ts[a]) || 1), sg = 1;
    if (n === 4) { var d = 0; for (i = 0; i < 4; i++) d += vs[a * 4 + i] * vs[b * 4 + i]; if (d < 0) sg = -1; }
    for (i = 0; i < n; i++) out[i] = vs[a * n + i] * (1 - f) + sg * vs[b * n + i] * f;
    if (n === 4) { var l = Math.hypot(out[0], out[1], out[2], out[3]) || 1; for (i = 0; i < 4; i++) out[i] /= l; }
    return out;
  }
  var I3 = [0, 0, 0], I4 = [0, 0, 0, 1], S1 = [1, 1, 1], tq = [0, 0, 0, 0], tt = [0, 0, 0], ts3 = [0, 0, 0], L = new Array(12);
  function pose(bones, t, G) {   // every bone at time t (ms) -> G, 12 floats each (3x3 by columns, then translation)
    for (var b = 0; b < bones.length; b++) {
      var B = bones[b], q = key(B.r, t, 4, tq, I4), tr = key(B.t, t, 3, tt, I3), sc = key(B.s, t, 3, ts3, S1);
      var x = q[0], y = q[1], z = q[2], w = q[3], v = B.v, i, c;
      L[0] = (1 - 2 * (y * y + z * z)) * sc[0]; L[1] = 2 * (x * y + z * w) * sc[0]; L[2] = 2 * (x * z - y * w) * sc[0];
      L[3] = 2 * (x * y - z * w) * sc[1]; L[4] = (1 - 2 * (x * x + z * z)) * sc[1]; L[5] = 2 * (y * z + x * w) * sc[1];
      L[6] = 2 * (x * z + y * w) * sc[2]; L[7] = 2 * (y * z - x * w) * sc[2]; L[8] = (1 - 2 * (x * x + y * y)) * sc[2];
      for (i = 0; i < 3; i++) L[9 + i] = v[i] + tr[i] - (L[i] * v[0] + L[3 + i] * v[1] + L[6 + i] * v[2]);
      var o = b * 12, p = B.p;
      if (p < 0) { for (i = 0; i < 12; i++) G[o + i] = L[i]; continue; }
      var P = p * 12;
      for (c = 0; c < 4; c++) for (i = 0; i < 3; i++)
        G[o + c * 3 + i] = G[P + i] * L[c * 3] + G[P + 3 + i] * L[c * 3 + 1] + G[P + 6 + i] * L[c * 3 + 2] + (c === 3 ? G[P + 9 + i] : 0);
    }
  }
  function skin(G, S) {
    var P0 = S.P0, N0 = S.N0, BI = S.BI, BW = S.BW, P = S.P, N = S.N;
    for (var v = 0, nv = P0.length / 3; v < nv; v++) {
      var px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, x = P0[v * 3], y = P0[v * 3 + 1], z = P0[v * 3 + 2], a = N0[v * 3], b = N0[v * 3 + 1], c = N0[v * 3 + 2];
      for (var k = 0; k < 4; k++) {
        var w = BW[v * 4 + k]; if (!w) continue; w /= 255; var o = BI[v * 4 + k] * 12;
        px += w * (G[o] * x + G[o + 3] * y + G[o + 6] * z + G[o + 9]); py += w * (G[o + 1] * x + G[o + 4] * y + G[o + 7] * z + G[o + 10]); pz += w * (G[o + 2] * x + G[o + 5] * y + G[o + 8] * z + G[o + 11]);
        nx += w * (G[o] * a + G[o + 3] * b + G[o + 6] * c); ny += w * (G[o + 1] * a + G[o + 4] * b + G[o + 7] * c); nz += w * (G[o + 2] * a + G[o + 5] * b + G[o + 8] * c);
      }
      P[v * 3] = px; P[v * 3 + 1] = py; P[v * 3 + 2] = pz; N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
    }
  }
  var VS = '#version 300 es\nin vec3 p; in vec3 n; in vec2 uv; uniform mat4 mvp; uniform mat3 nm; uniform mat4 bm; out vec3 vn; out vec2 vuv;\n' +
    'void main(){ vec4 w = bm * vec4(p, 1.0); vec3 m = mat3(bm) * n; gl_Position = mvp * vec4(w.y, w.z, w.x, 1.0); vn = nm * vec3(m.y, m.z, m.x); vuv = uv; }';
  var FS = '#version 300 es\nprecision mediump float; in vec3 vn; in vec2 vuv; uniform sampler2D tex; uniform float cut; uniform float add; out vec4 o;\n' +
    'void main(){ vec4 c = texture(tex, vuv); if (c.a < cut) discard; if (add > 0.5) { o = c; return; } vec3 N = normalize(vn);\n' +
    ' float d = max(dot(N, normalize(vec3(0.35, 0.55, 0.75))), 0.0); float r = max(dot(N, normalize(vec3(-0.6, 0.2, -0.5))), 0.0);\n' +
    ' vec3 l = vec3(0.42) + vec3(0.78) * d + vec3(0.25, 0.27, 0.35) * r; o = vec4(c.rgb * l, cut > 0.0 ? 1.0 : c.a); }';
  var ID4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // armor is painted in this order (later covers earlier): shirt, legs, boots, chest, robe, wrists, gloves, belt, tabard
  var PAINT = [4, 7, 8, 5, 20, 9, 10, 6, 19];
  // weapons put away: SheatheType -> [main hand, off hand] attachment point
  var SHEATH = { 1: [26, 27], 2: [30, 31], 3: [32, 33], 4: [28, 28], 7: [32, 33] };
  function sh(gl, t, s) { var x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(x); return x; }
  function persp(f, a, n, fa) { var t = 1 / Math.tan(f / 2); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0]; }
  function mul(a, b) { var o = new Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
  var cache = {};
  function get(url, kind) { return cache[url] || (cache[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return kind === 'json' ? r.json() : r.arrayBuffer(); })); }
  // packed mesh (export_site.py mesh()): int16 positions in box q, int8 normals, int16 uv / 4096, u16 indices; returns the end offset too
  function mesh(buf, off, nv, ni, q) {
    var al = function (x) { return (x + 3) & ~3; }, ps = new Int16Array(buf, off, nv * 3), o2 = off + al(nv * 6), ns = new Int8Array(buf, o2, nv * 3), o3 = o2 + al(nv * 3);
    var us = new Int16Array(buf, o3, nv * 2), o4 = o3 + nv * 4, I = new Uint16Array(buf, o4, ni), P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), T = new Float32Array(nv * 2);
    for (var i = 0; i < nv * 3; i++) { var k = i % 3; P[i] = q[k] + (ps[i] + 32768) * q[3 + k]; N[i] = ns[i] / 127; }
    for (i = 0; i < nv * 2; i++) T[i] = us[i] / 4096;
    return { P: P, N: N, T: T, I: I, end: o4 + al(ni * 2) };
  }
  // m/ packs: u32 json length, json, then binary parts at meta.b[i] = [offset, length] after the json
  function unpack(buf) {
    var n = new DataView(buf).getUint32(0, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))), at = 4 + n;
    meta.part = function (i) { var s = meta.b[i]; return buf.slice(at + s[0], at + s[0] + s[1]); };
    return meta;
  }
  function pack(url) { return cache['p' + url] || (cache['p' + url] = get(url).then(unpack)); }
  function bitmap(ab) { return createImageBitmap(new Blob([ab], { type: 'image/webp' })); }
  function image(url) { return cache['i' + url] || (cache['i' + url] = fetch(url).then(function (r) { return r.blob(); }).then(function (b) { return createImageBitmap(b); })); }

  function mount(cv, base) {
    var gl = cv.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return null;
    var pr = gl.createProgram(); gl.attachShader(pr, sh(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    var U = {}; ['mvp', 'nm', 'bm', 'tex', 'cut', 'add'].forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });
    var loc = { p: gl.getAttribLocation(pr, 'p'), n: gl.getAttribLocation(pr, 'n'), uv: gl.getAttribLocation(pr, 'uv') };
    var st = { yaw: 0.25, dead: false, t0: performance.now(), want: null, busy: false, dirty: true },
      body = null, look = null, gtex = new Map(), idx = null, comp = document.createElement('canvas');
    function texture(src) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); return t;
    }
    function vao(P, N, T, I, dyn) {
      var M = { vao: gl.createVertexArray(), buf: {} }; gl.bindVertexArray(M.vao);
      [[P, 'p', 3], [N, 'n', 3], [T, 'uv', 2]].forEach(function (a) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a[0], dyn && a[1] !== 'uv' ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); gl.enableVertexAttribArray(loc[a[1]]); gl.vertexAttribPointer(loc[a[1]], a[2], gl.FLOAT, false, 0, 0); M.buf[a[1]] = b; });
      var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
      gl.bindVertexArray(null); M.it = I instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT; M.isz = I instanceof Uint16Array ? 2 : 4; return M;
    }
    function loadBody(rs) {
      var url = base + 'b/' + rs;
      return Promise.all([get(url + '.json', 'json'), get(url + '.bin')]).then(function (res) {
        var meta = res[0], buf = res[1], nv = meta.nv;
        var ms = mesh(buf, 0, nv, meta.ni, meta.q), P = ms.P, N = ms.N, T = ms.T, I = ms.I;
        var bw = new Uint8Array(buf, ms.end, nv * 8), S = { BI: new Uint8Array(nv * 4), BW: new Uint8Array(nv * 4), P0: P, N0: N, P: new Float32Array(nv * 3), N: new Float32Array(nv * 3), G: new Float32Array(meta.bones.length * 12) };
        for (var v = 0; v < nv; v++) for (var k = 0; k < 4; k++) { S.BI[v * 4 + k] = bw[v * 8 + k]; S.BW[v * 4 + k] = bw[v * 8 + 4 + k]; }
        var B = { rs: rs, meta: meta, S: S, M: vao(P, N, T, I, true), tex: {}, img: {}, idx: I };
        B.ids = new Set(meta.draws.map(function (d) { return d.geoset; }));
        return Promise.all(Object.keys(meta.tex).map(function (k) {
          return meta.tex[k] ? image(base + meta.tex[k]).then(function (im) { B.img[k] = im; B.tex[k] = texture(im); }) : null;
        })).then(function () { return B; });
      });
    }
    function loadModel(fid) {
      return cache['m' + fid] || (cache['m' + fid] = pack(base + 'm/' + fid + '.bin').then(function (meta) {
        var ms = mesh(meta.part(0), 0, meta.nv, meta.ni, meta.q), M = vao(ms.P, ms.N, ms.T, ms.I, false);
        M.draws = meta.draws; M.fixed = {};
        return Promise.all(meta.draws.map(function (d) {
          if (d.tex === 'i' || M.fixed[d.tex]) return null;
          M.fixed[d.tex] = true;
          return bitmap(meta.part(d.tex)).then(function (im) { M.fixed[d.tex] = texture(im); });
        })).then(function () { return M; });
      }));
    }
    function itemTex(fid) { if (!gtex.has(fid)) gtex.set(fid, image(base + 't/' + fid + '.webp').then(texture, function () { return null; })); return gtex.get(fid); }
    // what the character wears -> geosets on, painted body texture, cloak texture, models on attachment points
    function dress(B, want) {
      var sx = want.sex, rs = B.rs;
      return (idx || (idx = get(base + 'items.json', 'json'))).then(function (index) {
        return Promise.all((want.gear || []).map(function (g) {
          var e = index[g.item]; if (e === undefined) return null;
          var did = Array.isArray(e) ? e[0] : e, sheath = Array.isArray(e) ? e[1] : 0;
          return get(base + 'd/' + (did % 64) + '.json', 'json').then(function (sh) { var dm = sh[did]; return dm ? { g: g, dm: dm, sheath: sheath } : null; }, function () { return null; });
        }));
      }).then(function (worn) {
        worn = worn.filter(Boolean).sort(function (a, b) { return PAINT.indexOf(a.dm.inv) - PAINT.indexOf(b.dm.inv); });
        var meta = B.meta, on = new Set(meta.on), hide = new Set(), cape = null, jobs = [], parts = [];
        function group(g) { on.forEach(function (id) { if (Math.floor(id / 100) === g && (g || id)) on.delete(id); }); }
        worn.forEach(function (w) {
          var dm = w.dm, geo = dm.geo || {};
          Object.keys(geo).forEach(function (g) {
            g = +g; var want = g * 100 + geo[g]; group(g);
            if (B.ids.has(want)) on.add(want); else if (g === 15 && B.ids.has(1502)) on.add(1502);
          });
          if (dm.hide && dm.hide[rs]) dm.hide[rs].forEach(function (g) { hide.add(g); });
          if (dm.cape && (dm.cape[sx] || dm.cape[0])) cape = itemTex(dm.cape[sx] || dm.cape[0]);
          (dm.m || []).forEach(function (m, k) {
            var fid = typeof m.f === 'object' ? m.f[rs] : m.f, at = null;
            if (!fid) return;
            if (dm.inv === 1) at = 11;
            else if (dm.inv === 3) at = k ? 5 : 6;
            else if (SHEATH[w.sheath]) at = SHEATH[w.sheath][w.g.slot === 'off' || dm.inv === 22 || dm.inv === 23 || (dm.inv === 15 || dm.inv === 26) ? 1 : 0];
            if (at === null || !meta.att[at]) return;
            var ti = m.t[sx] || m.t[0];
            jobs.push(Promise.all([loadModel(fid), ti ? itemTex(ti) : null]).then(function (r) { parts.push({ M: r[0], tex: r[1], at: at }); }, function () { }));
          });
        });
        hide.forEach(function (g) { group(g); });
        if (cape === null) group(15);
        // body texture: the bare skin, then each armor piece's section pictures (game order)
        var bi = B.img.t1, secs = meta.secs, paint = [];
        worn.forEach(function (w) { (w.dm.sec || []).forEach(function (s) { var f = s[1 + sx] || s[2 - sx]; if (secs[s[0]] && f) paint.push([s[0], image(base + 't/' + f + '.webp').catch(function () { return null; })]); }); });
        return Promise.all([Promise.all(paint.map(function (p) { return p[1]; })), cape, Promise.all(jobs)]).then(function (r) {
          var t1 = null;
          if (bi) {
            comp.width = bi.width; comp.height = bi.height; var x = comp.getContext('2d'); x.clearRect(0, 0, comp.width, comp.height); x.drawImage(bi, 0, 0);
            r[0].forEach(function (im, i) { var s = secs[paint[i][0]]; if (im) x.drawImage(im, s[0], s[1], s[2], s[3]); });
            t1 = texture(comp);
          }
          return { on: on, t1: t1, t2: r[1], parts: parts };
        });
      });
    }
    function sameWant(a, b) { return a && b && JSON.stringify(a) === JSON.stringify(b); }
    function pump() {
      if (st.busy || !st.want || sameWant(st.want, st.have)) return;
      var want = st.want; st.busy = true;
      var rs = want.race + '-' + want.sex;
      (body && body.rs === rs ? Promise.resolve(body) : loadBody(rs)).then(function (B) {
        return dress(B, want).then(function (lk) {
          if (look && look.t1 && look.t1 !== lk.t1) gl.deleteTexture(look.t1);
          body = B; look = lk; st.have = want;
        });
      }).catch(function (e) { if (window.console) console.warn('3D character:', e); st.have = want; })
        .then(function () { st.busy = false; if (cv.onready) cv.onready(); pump(); });
    }
    var drag = null;
    cv.addEventListener('pointerdown', function (e) { drag = e.clientX; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', function (e) { if (drag !== null) { st.yaw += (e.clientX - drag) * 0.012; drag = e.clientX; } });
    cv.addEventListener('pointerup', function () { drag = null; });
    cv.addEventListener('pointercancel', function () { drag = null; });
    function draw(M, draws, texOf, pass) {
      gl.bindVertexArray(M.vao);
      draws.forEach(function (d) {
        var t = texOf(d), bl = d.blend >= 2;
        if (!t || bl !== pass) return;
        gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1f(U.cut, d.blend === 1 ? 0.5 : 0.0); gl.uniform1f(U.add, d.blend >= 3 ? 1 : 0);
        if (bl) gl.blendFunc(gl.SRC_ALPHA, d.blend >= 3 ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.drawElements(gl.TRIANGLES, d.count, M.it, d.start * M.isz);
      });
    }
    function frame(now) {
      if (st.dead) return;
      requestAnimationFrame(frame);
      var w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h || !body || !look || st.off) return;
      var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      var dpr = Math.min(2, devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      var meta = body.meta, S = body.S, G = S.G;
      if (!still || st.dirty) {
        pose(meta.bones, still ? 0 : (st.at !== undefined ? st.at : (now - st.t0) % meta.anim), G); skin(G, S); st.dirty = false;
        gl.bindBuffer(gl.ARRAY_BUFFER, body.M.buf.p); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.P); gl.bindBuffer(gl.ARRAY_BUFFER, body.M.buf.n); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.N);
      }
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // camera: whole body in view, a little room above the head (helms) and under the feet
      if (!body.pbox) {   // the box of the standing pose (the stored box is the arms-out bind pose)
        var bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9], on0 = new Set(meta.on);
        meta.draws.forEach(function (d) { if (!on0.has(d.geoset)) return; for (var i = d.start; i < d.start + d.count; i++) { var v = body.idx[i] * 3; for (var k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], S.P[v + k]); bb[3 + k] = Math.max(bb[3 + k], S.P[v + k]); } } });
        body.pbox = bb;
      }
      var b = body.pbox, hgt = (b[5] - b[2]) * 1.26, cz = b[2] + (b[5] - b[2]) * 0.53, fov = 0.5, a = w / h;
      var dist = Math.max(hgt / 2 / Math.tan(fov / 2), (b[4] - b[1]) * 0.75 / a / Math.tan(fov / 2)) * 1.02;
      var c = Math.cos(st.yaw), s = Math.sin(st.yaw);
      gl.useProgram(pr); gl.enable(gl.DEPTH_TEST); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U.tex, 0);
      gl.uniformMatrix4fv(U.mvp, false, mul(persp(fov, a, 0.1, 100), [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, -cz, -dist, 1]));
      gl.uniformMatrix3fv(U.nm, false, [c, 0, -s, 0, 1, 0, s, 0, c]);
      var on = look.on, bt = function (d) { if (!on.has(d.geoset)) return null; return d.tex === 't1' ? (look.t1 || body.tex.t1) : d.tex === 't2' ? look.t2 : body.tex[d.tex]; };
      [false, true].forEach(function (pass) {
        if (pass) { gl.enable(gl.BLEND); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); }
        gl.uniformMatrix4fv(U.bm, false, ID4); draw(body.M, meta.draws, bt, pass);
        look.parts.forEach(function (p) {
          var A = meta.att[p.at], o = A[0] * 12, m = ID4.slice();
          for (var i = 0; i < 3; i++) { m[i] = G[o + i]; m[4 + i] = G[o + 3 + i]; m[8 + i] = G[o + 6 + i]; m[12 + i] = G[o + i] * A[1] + G[o + 3 + i] * A[2] + G[o + 6 + i] * A[3] + G[o + 9 + i]; }
          gl.uniformMatrix4fv(U.bm, false, m);
          draw(p.M, p.M.draws, function (d) { return d.tex === 'i' ? p.tex : p.M.fixed[d.tex]; }, pass);
        });
      });
      gl.depthMask(true);
    }
    // nothing to draw while the panel is scrolled out of view (saves battery)
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { st.off = !es[es.length - 1].isIntersecting; }).observe(cv);
    requestAnimationFrame(frame);
    return {
      set: function (want) { st.want = JSON.parse(JSON.stringify(want)); st.dirty = true; pump(); },
      setYaw: function (y) { st.yaw = y; }, setTime: function (ms) { st.at = ms; st.dirty = true; },
      ready: function () { return !!(look && !st.busy); },
      destroy: function () { st.dead = true; }
    };
  }
  window.WFChar3D = { mount: mount };
})();
