(function () {
  'use strict';

  // ---------- Playables SDK ----------
  var yt = typeof ytgame !== 'undefined' ? ytgame : null;
  var inYT = !!(yt && yt.IN_PLAYABLES_ENV);

  // ---------- Sabitler ----------
  var ROUND = 45; // saniye
  var MAX_BALLS = 28;
  var TAU = Math.PI * 2;
  var SAVE_KEY = 'ponpon-patlat-save';

  var COLORS = [
    { id: 'coral', light: '#FFA79C', base: '#FF6F61', dark: '#E0493C', line: '#B93327', who: 0 },
    { id: 'turq', light: '#8BE3E3', base: '#2EC4C6', dark: '#1A9EA3', line: '#127A80', who: 1 },
    { id: 'yellow', light: '#FFE28A', base: '#FFC93C', dark: '#EFA81A', line: '#C98600', who: 2 },
    { id: 'purple', light: '#CDB9F0', base: '#A78BDA', dark: '#8566C2', line: '#6648A6', who: 0 },
    { id: 'green', light: '#A6E8C0', base: '#5CC98B', dark: '#38A86B', line: '#24804E', who: 1 },
    { id: 'orange', light: '#FFC08F', base: '#FF9A4D', dark: '#EE7722', line: '#C25A0E', who: 2 }
  ];
  var STAR = { id: 'star', light: '#FFF3B0', base: '#FFD84A', dark: '#F2B01E', line: '#C98600', who: 2 };

  var TEXT = {
    tr: {
      title: 'Ponpon Patlat',
      lead: 'Yün toplarına dokun, patlat!',
      play: 'Oyna',
      over: 'Süre doldu!',
      score: 'puan',
      best: 'En iyi puan: {n}',
      newBest: 'Yeni rekor!',
      again: 'Tekrar oyna'
    },
    en: {
      title: 'Pop the Pompoms',
      lead: 'Tap the yarn balls to pop them!',
      play: 'Play',
      over: 'Time’s up!',
      score: 'points',
      best: 'Best score: {n}',
      newBest: 'New best score!',
      again: 'Play again'
    }
  };

  // ---------- Durum ----------
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, dpr = 1, R = 40;
  var bg = document.createElement('canvas');
  var sprites = {};
  var images = [null, null, null];

  var state = 'loading'; // loading | menu | playing | over
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var clock = 0;
  var timeLeft = ROUND;
  var spawnIn = 0;
  var score = 0;
  var best = 0;
  var saveLoaded = false;
  var T = TEXT.en;

  var balls = [];
  var pops = [];
  var bits = [];
  var floats = [];
  var avatars = [{ y: 0, v: 0 }, { y: 0, v: 0 }, { y: 0, v: 0 }];

  var reduceMotion = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;
    mq.addEventListener('change', function (e) { reduceMotion = e.matches; });
  } catch (e) { /* eski tarayıcı */ }

  var el = function (id) { return document.getElementById(id); };
  var hud = el('hud'), hudScore = el('hudScore'), timeFill = el('timeFill');
  var screens = { loading: el('loading'), menu: el('menu'), over: el('over') };
  var btnPlay = el('btnPlay'), btnAgain = el('btnAgain');

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- Ses ----------
  var audioOn = true;
  var actx = null;
  if (inYT) {
    try { audioOn = yt.system.isAudioEnabled(); } catch (e) { audioOn = false; }
    try {
      yt.system.onAudioEnabledChange(function (on) {
        audioOn = !!on;
        syncAudio();
      });
    } catch (e) { /* yok say */ }
  }

  function ensureAudio() {
    if (!audioOn || paused) return;
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
      }
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* ses yok */ }
  }

  function syncAudio() {
    if (!actx) return;
    try {
      if (audioOn && !paused) actx.resume(); else actx.suspend();
    } catch (e) { /* yok say */ }
  }

  function tone(freq, endFreq, dur, when, vol, type) {
    if (!audioOn || paused || !actx || actx.state !== 'running') return;
    var t0 = actx.currentTime + (when || 0);
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function sfxPop(i) { tone(520 + i * 60, 170, 0.11, 0, 0.22, 'triangle'); }
  function sfxStar() { tone(784, 784, 0.1, 0, 0.18); tone(1047, 1047, 0.1, 0.08, 0.18); tone(1319, 1319, 0.16, 0.16, 0.18); }
  function sfxEnd() { tone(523, 523, 0.14, 0, 0.18); tone(659, 659, 0.14, 0.14, 0.18); tone(784, 784, 0.28, 0.28, 0.18); }

  // ---------- Kayıt ----------
  function parseSave(str) {
    try {
      var d = JSON.parse(str || '{}');
      var b = Math.floor(Number(d && d.best));
      return isFinite(b) && b > 0 ? b : 0;
    } catch (e) { return 0; }
  }

  function loadSave() {
    if (inYT) {
      return yt.game.loadData().then(function (str) {
        saveLoaded = true;
        best = Math.max(best, parseSave(str));
      }).catch(function () { saveLoaded = false; });
    }
    try { best = parseSave(window.localStorage.getItem(SAVE_KEY)); } catch (e) { /* yok say */ }
    saveLoaded = true;
    return Promise.resolve();
  }

  function writeSave() {
    var data = JSON.stringify({ v: 1, best: best });
    if (!inYT) {
      try { window.localStorage.setItem(SAVE_KEY, data); } catch (e) { /* yok say */ }
      return;
    }
    // loadData başarıyla bitmeden saveData çağrılmaz: eski kaydın üzerine yazmamak için.
    var ready = saveLoaded ? Promise.resolve() : loadSave();
    ready.then(function () {
      if (!saveLoaded) return;
      return yt.game.saveData(JSON.stringify({ v: 1, best: best }));
    }).catch(function () { warn(); });
  }

  function sendScore(value) {
    if (!inYT) return;
    try {
      var p = yt.engagement.sendScore({ value: value });
      if (p && p.catch) p.catch(function () { warn(); });
    } catch (e) { warn(); }
  }

  function warn() { try { if (inYT) yt.health.logWarning(); } catch (e) { /* yok say */ } }
  window.addEventListener('error', function () { try { if (inYT) yt.health.logError(); } catch (e) { /* yok say */ } });

  // ---------- Çizim hazırlığı ----------
  function resize() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    R = clamp(Math.min(W, H) * 0.085, 30, 72);
    buildBackground();
    buildSprites();
    if (paused || state === 'loading') draw();
  }

  function buildBackground() {
    bg.width = canvas.width; bg.height = canvas.height;
    var g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    var sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#6FCDE3');
    sky.addColorStop(0.55, '#BFEAF0');
    sky.addColorStop(0.85, '#FDF6D8');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // gökkuşağı
    var cx = W / 2, cy = H * 0.9;
    var rr = Math.min(W * 0.62, H * 0.78);
    var band = Math.max(2, rr * 0.055);
    var arcs = ['#FF8A80', '#FFB974', '#FFE27A', '#9BE3A8', '#8FD3F4', '#C3A6F0'];
    g.globalAlpha = 0.42; g.lineWidth = band;
    for (var i = 0; i < arcs.length; i++) {
      g.strokeStyle = arcs[i];
      g.beginPath(); g.arc(cx, cy, Math.max(1, rr - i * band), Math.PI, TAU); g.stroke();
    }
    g.globalAlpha = 1;

    // bulutlar
    var u = clamp(Math.min(W, H) * 0.12, 36, 110);
    cloud(g, W * 0.12, H * 0.16, u);
    cloud(g, W * 0.86, H * 0.12, u * 1.15);
    cloud(g, W * 0.7, H * 0.42, u * 0.7);
    cloud(g, W * 0.2, H * 0.5, u * 0.6);

    // tepeler
    g.fillStyle = '#BFE3A8';
    g.beginPath(); g.ellipse(W * 0.2, H * 1.08, W * 0.6, H * 0.2, 0, 0, TAU); g.fill();
    g.fillStyle = '#A9D992';
    g.beginPath(); g.ellipse(W * 0.85, H * 1.1, W * 0.6, H * 0.2, 0, 0, TAU); g.fill();
  }

  function cloud(g, x, y, s) {
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.arc(x - s * 0.55, y + s * 0.1, s * 0.38, 0, TAU);
    g.arc(x, y - s * 0.12, s * 0.5, 0, TAU);
    g.arc(x + s * 0.55, y + s * 0.08, s * 0.4, 0, TAU);
    g.rect(x - s * 0.55, y + s * 0.05, s * 1.1, s * 0.43);
    g.fill();
  }

  function buildSprites() {
    sprites = {};
    var all = COLORS.concat([STAR]);
    for (var i = 0; i < all.length; i++) sprites[all[i].id] = makeBall(all[i], R * 1.15, all[i] === STAR);
  }

  // Top en büyük ölçeğinde çizilir; küçükleri aynı görüntüden küçültülür.
  function makeBall(c, r, star) {
    var pad = 4;
    var size = Math.ceil((r + pad) * 2 * dpr);
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(r + pad, r + pad);

    var grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    grad.addColorStop(0, c.light); grad.addColorStop(0.6, c.base); grad.addColorStop(1, c.dark);
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = grad; g.fill();

    g.save(); g.clip();
    g.lineWidth = Math.max(1.5, r * 0.06); g.lineCap = 'round';
    var bundles = [[0.5, c.dark], [-0.75, c.light], [1.9, c.dark]];
    for (var b = 0; b < bundles.length; b++) {
      g.save(); g.rotate(bundles[b][0]); g.strokeStyle = bundles[b][1]; g.globalAlpha = 0.6;
      for (var i = -3; i <= 3; i++) {
        g.beginPath();
        g.ellipse(0, i * r * 0.17, r * 1.05, r * 0.4, 0, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
      }
      g.restore();
    }
    g.restore();

    g.beginPath(); g.arc(0, 0, r, 0, TAU);
    g.lineWidth = Math.max(2, r * 0.07); g.strokeStyle = c.line; g.stroke();

    if (star) {
      g.beginPath();
      for (var k = 0; k < 10; k++) {
        var rad = k % 2 === 0 ? r * 0.5 : r * 0.22;
        var a = -Math.PI / 2 + k * Math.PI / 5;
        g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      g.closePath();
      g.fillStyle = '#FFFFFF'; g.fill();
      g.lineJoin = 'round'; g.lineWidth = Math.max(2, r * 0.06); g.strokeStyle = c.line; g.stroke();
    }
    return { cv: cv, r: r + pad };
  }

  function loadImages() {
    var names = ['assets/mina.jpg', 'assets/ayaz.jpg', 'assets/ponpon.jpg'];
    return Promise.all(names.map(function (src, i) {
      return new Promise(function (done) {
        var im = new Image();
        im.onload = function () { images[i] = im; done(); };
        im.onerror = function () { done(); };
        im.src = src;
      });
    }));
  }

  // ---------- Oyun ----------
  function spawn() {
    if (balls.length >= MAX_BALLS) return;
    var playing = state === 'playing';
    var star = playing && Math.random() < 0.1;
    var c = star ? STAR : COLORS[(Math.random() * COLORS.length) | 0];
    var p = playing ? 1 - timeLeft / ROUND : 0;
    balls.push({
      c: c,
      x: 0.08 + Math.random() * 0.84,
      y: 1 + (R * 1.3) / H,
      s: star ? 1.1 : 0.82 + Math.random() * 0.3,
      v: (playing ? lerp(0.2, 0.38, p) : 0.13) * (0.85 + Math.random() * 0.3),
      ph: Math.random() * TAU,
      fr: 0.8 + Math.random() * 0.8
    });
  }

  function ballX(b) {
    var sway = reduceMotion ? 0 : Math.sin(clock * b.fr + b.ph) * 0.02;
    return (b.x + sway) * W;
  }

  function update(dt) {
    clock += dt;

    if (state === 'playing') {
      timeLeft -= dt;
      if (timeLeft <= 0) { timeLeft = 0; endRound(); }
    }

    if (state !== 'loading') {
      spawnIn -= dt;
      if (spawnIn <= 0) {
        spawn();
        spawnIn = state === 'playing' ? lerp(0.85, 0.36, 1 - timeLeft / ROUND) : 1.3;
      }
    }

    var i;
    for (i = balls.length - 1; i >= 0; i--) {
      balls[i].y -= balls[i].v * dt;
      if (balls[i].y * H < -R * 1.5) balls.splice(i, 1);
    }
    for (i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t > 0.16) pops.splice(i, 1); }
    for (i = bits.length - 1; i >= 0; i--) {
      var p = bits[i];
      p.t += dt; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t > 0.45) bits.splice(i, 1);
    }
    for (i = floats.length - 1; i >= 0; i--) { floats[i].t += dt; if (floats[i].t > 0.6) floats.splice(i, 1); }

    // karakterler: sönümlü yay
    for (i = 0; i < 3; i++) {
      var a = avatars[i];
      a.v += (-260 * a.y - 14 * a.v) * dt;
      a.y += a.v * dt;
    }
  }

  function popBall(index) {
    var b = balls[index];
    var x = ballX(b), y = b.y * H, r = R * b.s;
    balls.splice(index, 1);
    pops.push({ c: b.c, x: x, y: y, r: r, t: 0 });

    if (!reduceMotion) {
      var n = b.c === STAR ? 12 : 8;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU + Math.random() * 0.5;
        var sp = r * (4 + Math.random() * 4);
        bits.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - r * 2, c: b.c.base, t: 0, len: r * 0.3 });
      }
      avatars[b.c.who].v -= 3;
    }

    if (b.c === STAR) sfxStar(); else sfxPop(COLORS.indexOf(b.c));

    if (state === 'playing') {
      var gain = b.c === STAR ? 5 : 1;
      score += gain;
      hudScore.textContent = String(score);
      floats.push({ x: x, y: y - r, text: '+' + gain, t: 0 });
    }
  }

  function onPointerDown(e) {
    if (paused || state === 'loading') return;
    ensureAudio();
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    for (var i = balls.length - 1; i >= 0; i--) {
      var b = balls[i];
      var dx = ballX(b) - px, dy = b.y * H - py;
      var hit = R * b.s * 1.25; // küçük parmaklar için geniş dokunma alanı
      if (dx * dx + dy * dy <= hit * hit) { popBall(i); return; }
    }
  }

  function startRound() {
    ensureAudio();
    score = 0; timeLeft = ROUND; spawnIn = 0.2;
    balls.length = 0;
    hudScore.textContent = '0';
    state = 'playing';
    show(null);
    hud.setAttribute('data-open', 'true');
  }

  function endRound() {
    state = 'over';
    hud.setAttribute('data-open', 'false');
    var isBest = score > best;
    if (isBest) best = score;
    el('overScore').textContent = String(score);
    el('overBest').textContent = isBest ? T.newBest : T.best.replace('{n}', best);
    sfxEnd();
    sendScore(score);
    if (isBest) writeSave();

    // Hızlı dokunan çocuk yanlışlıkla yeniden başlatmasın diye düğme kısa süre kapalı.
    btnAgain.disabled = true;
    show('over');
    window.setTimeout(function () {
      btnAgain.disabled = false;
      if (state === 'over') btnAgain.focus({ preventScroll: true });
    }, 700);
  }

  function show(name) {
    for (var key in screens) {
      var open = key === name;
      screens[key].setAttribute('data-open', open ? 'true' : 'false');
      if (open) screens[key].removeAttribute('inert'); else screens[key].setAttribute('inert', '');
    }
  }

  // ---------- Çizim ----------
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var i;
    for (i = 0; i < balls.length; i++) {
      var b = balls[i];
      drawBall(b.c, ballX(b), b.y * H, b.s, 1);
    }

    for (i = 0; i < pops.length; i++) {
      var p = pops[i], k = p.t / 0.16;
      var e = 1 - Math.pow(1 - k, 3);
      drawBall(p.c, p.x, p.y, (p.r / R) * (reduceMotion ? 1 : 1 + 0.3 * e), 1 - e);
    }

    ctx.lineCap = 'round';
    for (i = 0; i < bits.length; i++) {
      var q = bits[i], life = 1 - q.t / 0.45;
      var sp = Math.sqrt(q.vx * q.vx + q.vy * q.vy) || 1;
      ctx.globalAlpha = life;
      ctx.strokeStyle = q.c; ctx.lineWidth = Math.max(3, R * 0.1);
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - (q.vx / sp) * q.len, q.y - (q.vy / sp) * q.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    drawAvatars();

    if (floats.length) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.round(R * 0.7) + 'px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, R * 0.14);
      for (i = 0; i < floats.length; i++) {
        var f = floats[i], t = f.t / 0.6;
        var rise = reduceMotion ? 0 : (1 - Math.pow(1 - t, 3)) * R * 0.9;
        ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
        ctx.strokeStyle = '#FFFFFF'; ctx.strokeText(f.text, f.x, f.y - rise);
        ctx.fillStyle = '#1E2A78'; ctx.fillText(f.text, f.x, f.y - rise);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawBall(c, x, y, scale, alpha) {
    var s = sprites[c.id];
    if (!s) return;
    var half = s.r * (scale / 1.15);
    if (alpha < 1) ctx.globalAlpha = Math.max(0, alpha);
    ctx.drawImage(s.cv, x - half, y - half, half * 2, half * 2);
    if (alpha < 1) ctx.globalAlpha = 1;
  }

  function drawAvatars() {
    // Kısa ekranda menü paneliyle çakışmasın.
    if (state !== 'playing' && H < 460) return;
    var size = clamp(Math.min(W, H) * 0.15, 44, 104);
    var gap = size * 0.28;
    var total = size * 3 + gap * 2;
    var x0 = (W - total) / 2 + size / 2;
    var y0 = H - size / 2 - 14;
    var ring = Math.max(3, size * 0.05);
    for (var i = 0; i < 3; i++) {
      var x = x0 + i * (size + gap);
      var y = y0 + Math.min(0, avatars[i].y) * size;
      ctx.beginPath(); ctx.arc(x, y, size / 2 + ring, 0, TAU);
      ctx.fillStyle = '#1E2A78'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, size / 2, 0, TAU);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      if (images[i]) {
        ctx.save(); ctx.clip();
        ctx.drawImage(images[i], x - size / 2, y - size / 2, size, size);
        ctx.restore();
      }
    }
  }

  // ---------- Döngü ----------
  function frame(ts) {
    rafId = 0;
    if (paused) return;
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    update(dt);
    draw();
    if (state === 'playing') {
      timeFill.style.transform = 'scaleX(' + (timeLeft / ROUND).toFixed(4) + ')';
      var low = timeLeft <= 5 ? 'true' : 'false';
      if (timeFill.getAttribute('data-low') !== low) timeFill.setAttribute('data-low', low);
    }
    rafId = window.requestAnimationFrame(frame);
  }

  function run() {
    if (!rafId && !paused) { lastTs = 0; rafId = window.requestAnimationFrame(frame); }
  }

  function pause() {
    paused = true;
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    syncAudio();
  }

  function resume() {
    paused = false;
    syncAudio();
    run();
  }

  if (inYT) {
    try { yt.system.onPause(pause); yt.system.onResume(resume); } catch (e) { /* yok say */ }
  }

  // ---------- Başlangıç ----------
  function pickLanguage() {
    var fallback = (navigator.language || 'en');
    if (!inYT) return Promise.resolve(fallback);
    try {
      return yt.system.getLanguage().catch(function () { return 'en'; });
    } catch (e) { return Promise.resolve('en'); }
  }

  function applyText(tag) {
    var lang = String(tag || 'en').toLowerCase().slice(0, 2) === 'tr' ? 'tr' : 'en';
    T = TEXT[lang];
    document.documentElement.lang = lang;
    document.title = T.title;
    el('tTitle').textContent = T.title;
    el('tLead').textContent = T.lead;
    el('tOver').textContent = T.over;
    el('tScoreLabel').textContent = T.score;
    btnPlay.textContent = T.play;
    btnAgain.textContent = T.again;
    var mb = el('menuBest');
    if (best > 0) { mb.textContent = T.best.replace('{n}', best); mb.hidden = false; } else { mb.hidden = true; }
  }

  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', onPointerDown);
  btnPlay.addEventListener('click', startRound);
  btnAgain.addEventListener('click', startRound);

  resize();
  draw();
  window.requestAnimationFrame(function () {
    // Yükleme ekranı çizildi.
    try { if (yt) yt.game.firstFrameReady(); } catch (e) { /* yok say */ }

    Promise.all([loadImages(), loadSave(), pickLanguage()]).then(function (res) {
      applyText(res[2]);
      state = 'menu';
      show('menu');
      run();
      // Menü etkileşime açık.
      try { if (yt) yt.game.gameReady(); } catch (e) { /* yok say */ }
    });
  });
})();
