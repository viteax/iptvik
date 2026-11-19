// Пиксельная «топографическая карта» графа за заголовком страницы.
//
// Вершины графа – холмы: высота местности – сумма гауссовых бугров, по одному на
// вершину. Линии уровня ищутся попиксельно: пиксель лежит на линии, если его уровень
// отличается от соседа справа или снизу. Ребра – бледные пунктиры.
//
// Каждые несколько секунд из случайной вершины запускается алгоритм Дейкстры, и
// волна расходится по дереву кратчайших путей: импульс бежит по ребру, вершина при
// его приходе «вспыхивает» и холм под ней растет, потом медленно оседает.
// Клик по шапке запускает волну из ближайшей к курсору вершины. Курсор расталкивает
// вершины, они возвращаются на место на пружинах.
(function () {
  "use strict";

  var host = document.querySelector(".hero, .page-header");
  if (!host) return;

  var canvas = document.createElement("canvas");
  canvas.className = "topo";
  canvas.setAttribute("aria-hidden", "true");
  host.insertBefore(canvas, host.firstChild);
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var PIXEL = 3;          // CSS px на пиксель карты
  var LEVELS = 5;         // линий уровня на единицу высоты
  var INDEX_EVERY = 4;    // каждая N-я линия ярче
  var SIGMA = 6;          // радиус холма, px карты
  var GAP = 22;           // примерное расстояние между вершинами
  var K = 3;              // ребер к ближайшим соседям
  var SPEED = 60;         // скорость волны, px карты в секунду
  var REST = 0.3;         // высота холма спокойной вершины
  var SPIKE = 1.6;        // добавка к высоте при вспышке
  var DECAY = 1.1;        // скорость оседания вспышки, 1/с
  var REACH = 22;         // радиус толчка курсора
  var WAVE_EVERY = 3.2;   // секунд между автоматическими волнами

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 0, H = 0, img = null, field = null, kernel = null, KR = 0;
  var nodes = [], edges = [], adj = [];
  var waves = [];
  var pointer = { x: -999, y: -999, active: false };
  var last = 0, nextWave = 0.6, running = false, visible = true, raf = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function buildKernel() {
    KR = Math.ceil(SIGMA * 3);
    var size = KR * 2 + 1;
    kernel = new Float32Array(size * size);
    for (var dy = -KR; dy <= KR; dy++)
      for (var dx = -KR; dx <= KR; dx++)
        kernel[(dy + KR) * size + dx + KR] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
  }

  function resize() {
    var r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.ceil(r.width / PIXEL));
    var h = Math.max(1, Math.ceil(r.height / PIXEL));
    if (w === W && h === H) return;
    W = w; H = h;
    canvas.width = W; canvas.height = H;
    img = ctx.createImageData(W, H);
    field = new Float32Array(W * H);
    buildGraph();
  }

  function buildGraph() {
    nodes = []; edges = []; adj = []; waves = [];
    // Вершины – по сетке с дрожанием, гуще справа (слева текст).
    for (var y = GAP * 0.6; y < H + GAP * 0.5; y += GAP * 0.87) {
      for (var x = GAP * 0.5; x < W + GAP * 0.5; x += GAP) {
        var keep = 0.35 + 0.65 * (x / W);
        if (Math.random() > keep) continue;
        var hx = x + rand(-GAP * 0.35, GAP * 0.35);
        var hy = y + rand(-GAP * 0.3, GAP * 0.3);
        nodes.push({ hx: hx, hy: hy, x: hx, y: hy, vx: 0, vy: 0, act: 0, phase: rand(0, 6.28) });
      }
    }
    for (var i = 0; i < nodes.length; i++) adj.push([]);
    var seen = {};
    for (i = 0; i < nodes.length; i++) {
      var near = [];
      for (var j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        var dx = nodes[i].hx - nodes[j].hx, dy = nodes[i].hy - nodes[j].hy;
        near.push([dx * dx + dy * dy, j]);
      }
      near.sort(function (a, b) { return a[0] - b[0]; });
      for (var k = 0; k < Math.min(K, near.length); k++) {
        var a = Math.min(i, near[k][1]), b = Math.max(i, near[k][1]);
        if (seen[a + ":" + b]) continue;
        seen[a + ":" + b] = 1;
        var wgt = Math.sqrt(near[k][0]) * rand(0.8, 1.4); // вес ребра – длина с шумом
        edges.push({ a: a, b: b, w: wgt });
        adj[a].push([b, wgt]); adj[b].push([a, wgt]);
      }
    }
  }

  // Дейкстра на двоичной куче: расстояния и родители дерева кратчайших путей.
  function dijkstra(src) {
    var n = nodes.length, dist = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1);
    var heap = [[0, src]];
    dist[src] = 0;
    function push(it) {
      heap.push(it);
      var c = heap.length - 1;
      while (c > 0) {
        var p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        var t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p;
      }
    }
    function pop() {
      var top = heap[0], end = heap.pop();
      if (heap.length) {
        heap[0] = end;
        var c = 0;
        for (;;) {
          var l = c * 2 + 1, r = l + 1, m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          var t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m;
        }
      }
      return top;
    }
    while (heap.length) {
      var cur = pop(), d = cur[0], u = cur[1];
      if (d > dist[u]) continue;
      for (var i = 0; i < adj[u].length; i++) {
        var v = adj[u][i][0], nd = d + adj[u][i][1];
        if (nd < dist[v]) { dist[v] = nd; parent[v] = u; push([nd, v]); }
      }
    }
    return { dist: dist, parent: parent, t: 0, fired: new Uint8Array(n), max: 0 };
  }

  function launch(src) {
    if (!nodes.length) return;
    var wv = dijkstra(src);
    for (var i = 0; i < wv.dist.length; i++) if (wv.dist[i] < Infinity && wv.dist[i] > wv.max) wv.max = wv.dist[i];
    waves.push(wv);
    if (waves.length > 3) waves.shift();
  }

  function nearest(x, y) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var dx = nodes[i].x - x, dy = nodes[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function step(dt, time) {
    // Волны
    nextWave -= dt;
    if (nextWave <= 0) {
      // Источник – в правой половине, чтобы волна шла через видимую часть.
      var cands = nodes.filter(function (n) { return n.hx > W * 0.45; });
      var pick = cands.length ? cands[(Math.random() * cands.length) | 0] : nodes[0];
      launch(nodes.indexOf(pick));
      nextWave = WAVE_EVERY + rand(-0.6, 0.8);
    }
    for (var w = waves.length - 1; w >= 0; w--) {
      var wv = waves[w];
      wv.t += dt * SPEED;
      for (var i = 0; i < nodes.length; i++) {
        if (!wv.fired[i] && wv.dist[i] <= wv.t) {
          wv.fired[i] = 1;
          nodes[i].act = Math.min(nodes[i].act + 1, 1.6);
        }
      }
      if (wv.t > wv.max + 200) waves.splice(w, 1);
    }
    // Вершины: пружина к дому, толчок курсора, оседание вспышки
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var ax = (n.hx - n.x) * 9, ay = (n.hy - n.y) * 9;
      if (pointer.active) {
        var dx = n.x - pointer.x, dy = n.y - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < REACH * REACH && d2 > 0.01) {
          var d = Math.sqrt(d2), f = (1 - d / REACH) * 900;
          ax += dx / d * f; ay += dy / d * f;
        }
      }
      n.vx = (n.vx + ax * dt) * Math.pow(0.02, dt);
      n.vy = (n.vy + ay * dt) * Math.pow(0.02, dt);
      n.x += n.vx * dt; n.y += n.vy * dt;
      n.act *= Math.exp(-DECAY * dt);
    }
  }

  function render(time) {
    field.fill(0);
    var size = KR * 2 + 1;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var amp = REST + 0.05 * Math.sin(time * 0.6 + n.phase) + n.act * SPIKE;
      var cx = Math.round(n.x), cy = Math.round(n.y);
      var x0 = Math.max(0, cx - KR), x1 = Math.min(W - 1, cx + KR);
      var y0 = Math.max(0, cy - KR), y1 = Math.min(H - 1, cy + KR);
      for (var y = y0; y <= y1; y++) {
        var krow = (y - cy + KR) * size + KR - cx, frow = y * W;
        for (var x = x0; x <= x1; x++) field[frow + x] += amp * kernel[krow + x];
      }
    }

    var data = img.data;
    data.fill(0);
    for (var y2 = 0; y2 < H; y2++) {
      for (var x2 = 0; x2 < W; x2++) {
        var p = y2 * W + x2, h = field[p];
        if (h < 0.06) continue;
        var lv = Math.floor(h * LEVELS);
        var right = x2 + 1 < W ? Math.floor(field[p + 1] * LEVELS) : lv;
        var down = y2 + 1 < H ? Math.floor(field[p + W] * LEVELS) : lv;
        if (lv === right && lv === down) continue;
        var top = Math.max(lv, right, down);
        var bright = top % INDEX_EVERY === 0 ? 1 : 0.55;
        // Высокие (вспыхнувшие) холмы окрашиваются в акцентный синий.
        var hot = Math.min(1, Math.max(0, (h - 0.55) / 1.2));
        var o = p * 4;
        data[o] = 120 + (59 - 120) * hot;
        data[o + 1] = 120 + (130 - 120) * hot;
        data[o + 2] = 128 + (246 - 128) * hot;
        data[o + 3] = (70 + 120 * hot) * bright;
      }
    }

    // Ребра – пунктир; ребра дерева активной волны подсвечиваются, по ним бежит импульс.
    for (var e = 0; e < edges.length; e++) dotted(data, nodes[edges[e].a], nodes[edges[e].b], 34, 4);
    for (var w = 0; w < waves.length; w++) {
      var wv = waves[w];
      for (i = 0; i < nodes.length; i++) {
        var par = wv.parent[i];
        if (par < 0) continue;
        var dA = wv.dist[par], dB = wv.dist[i];
        if (wv.t < dA || wv.t > dB + 90) continue;
        var fade = wv.t <= dB ? 1 : 1 - (wv.t - dB) / 90;
        dotted(data, nodes[par], nodes[i], 90 * fade, 2);
        if (wv.t <= dB) {
          var k = (wv.t - dA) / Math.max(1e-6, dB - dA);
          plot(data, nodes[par].x + (nodes[i].x - nodes[par].x) * k, nodes[par].y + (nodes[i].y - nodes[par].y) * k, [147, 197, 253], 255, true);
        }
      }
    }
    // Сами вершины – пиксель в центре
    for (i = 0; i < nodes.length; i++) {
      var a = Math.min(1, nodes[i].act);
      plot(data, nodes[i].x, nodes[i].y, [160 + 40 * a, 160 + 40 * a, 175 + 80 * a], 110 + 145 * a, a > 0.3);
    }
    ctx.putImageData(img, 0, 0);
  }

  function plot(data, fx, fy, rgb, alpha, big) {
    var x = Math.round(fx), y = Math.round(fy);
    for (var dy = 0; dy <= (big ? 1 : 0); dy++)
      for (var dx = 0; dx <= (big ? 1 : 0); dx++) {
        var px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        var o = (py * W + px) * 4;
        if (data[o + 3] > alpha) continue;
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = alpha;
      }
  }

  function dotted(data, A, B, alpha, every) {
    var dx = B.x - A.x, dy = B.y - A.y, len = Math.max(Math.abs(dx), Math.abs(dy));
    for (var s = 0; s <= len; s += every) {
      var k = s / (len || 1);
      var x = Math.round(A.x + dx * k), y = Math.round(A.y + dy * k);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      var o = (y * W + x) * 4;
      if (data[o + 3] >= alpha) continue;
      data[o] = 110; data[o + 1] = 140; data[o + 2] = 200; data[o + 3] = alpha;
    }
  }

  function frame(ts) {
    raf = 0;
    if (!running) return;
    var t = ts / 1000;
    if (!last) last = t - 0.033;
    if (t - last < 1 / 40) { raf = requestAnimationFrame(frame); return; } // ~30 к/с хватает
    var dt = Math.min(0.05, t - last);
    last = t;
    step(dt, t);
    render(t);
    raf = requestAnimationFrame(frame);
  }

  function setRunning() {
    var should = visible && !document.hidden && !reduce;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    if (!should) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  }

  function toMap(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / PIXEL, y: (e.clientY - r.top) / PIXEL };
  }

  host.addEventListener("pointermove", function (e) {
    var p = toMap(e); pointer.x = p.x; pointer.y = p.y; pointer.active = true;
  });
  host.addEventListener("pointerleave", function () { pointer.active = false; });
  host.addEventListener("click", function (e) {
    if (e.target.closest("a, button")) return;
    var p = toMap(e);
    launch(nearest(p.x, p.y));
    if (reduce) { for (var i = 0; i < 40; i++) step(0.05, i * 0.05); render(0); }
  });

  buildKernel();
  resize();
  window.addEventListener("resize", function () { resize(); if (!running) render(0); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; setRunning(); }).observe(host);
  }
  document.addEventListener("visibilitychange", setRunning);

  if (reduce) {
    // Без анимации: одна застывшая волна.
    launch(nearest(W * 0.75, H * 0.45));
    for (var i = 0; i < 30; i++) step(0.05, i * 0.05);
    render(0);
  }
  setRunning();
})();
