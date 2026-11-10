/* BurstBlastCrazyness — rendering, drag & drop, menus.
 *
 * How the game view stays stable under fast play
 *  - The move counts the instant you let go: game.place() runs on release.
 *    What follows (the piece flying into its cells, the pop of cleared lines,
 *    the score) is a "flight" that only draws; it can never block, lose or
 *    reorder a move. Several flights can be in the air at once.
 *  - The board on screen is only ever changed by applying finished flights in
 *    order, so it can't get out of step with the game however fast you go.
 *  - Nothing is rebuilt that didn't change: tray slots are keyed by piece, the
 *    board keeps a mirror of what each cell shows.
 *  - The preview is its own layer above the board; it never touches the cells.
 *  - Effects are transform/opacity animations run by the compositor, so they
 *    keep moving even while the next hand is being worked out.
 */
(function (BBC) {
  'use strict';

  var UI = (BBC.ui = {});
  var M = BBC.motion;
  var $ = function (s) { return document.querySelector(s); };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  var game = null;
  var boardEl, trayEl, fxEl, underEl;
  var cellEls = [];      // board cell elements
  var shown = [];        // what each board cell currently shows ('' or 'color:kind')
  var slotEls = [];      // tray slots
  var geo = null;        // cached board geometry (viewport px)
  var trayMini = 20;     // block size of pieces in the tray
  var trayH = 150;
  var shownScore = 0;
  var scoreAnim = null;
  var overShown = false;
  var reduceMotion = false;

  var DEFAULT_THEME = {
    vars: {
      '--bg1': '#1a0f3d',
      '--bg2': '#3a1670',
      '--board': 'rgba(8, 4, 28, 0.55)',
      '--board-edge': 'rgba(255, 255, 255, 0.08)',
      '--empty': 'rgba(255, 255, 255, 0.055)',
      '--text': '#ffffff',
      '--muted': 'rgba(255, 255, 255, 0.6)',
      '--accent': '#ffd84d',
      '--sheet': '#211347',
      '--radius': '18%'
    },
    palette: ['#ff5470', '#ff9f43', '#ffd84d', '#3ddc84', '#2ec5ff', '#6c7bff', '#c06cff', '#ff6fd8']
  };

  /* ---------- setup ---------- */

  UI.init = function () {
    boardEl = $('#board');
    trayEl = $('#tray');
    fxEl = $('#fx');
    underEl = $('#under');
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduceMotion = mq.matches;
      var onMq = function () { reduceMotion = mq.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
    } catch (e) { /* ignore */ }

    $('#btn-menu').addEventListener('click', function () { UI.pause(); });
    $('#pause-resume').addEventListener('click', function () { UI.resume(); });
    $('#pause').addEventListener('click', function (e) { if (e.target.id === 'pause') UI.resume(); });
    $('#pause-restart').addEventListener('click', function () {
      var b = $('#pause-restart');
      if (b.dataset.armed) {
        UI.resume();
        BBC.newGame();
      } else {
        b.dataset.armed = '1';
        b.textContent = 'Tap again to restart';
        b.classList.add('warn');
      }
    });
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        BBC.setMode(b.getAttribute('data-mode'));
        syncModeSwitch();
      });
    });
    document.querySelectorAll('.round-toggle').forEach(function (t) {
      t.addEventListener('click', function () {
        var key = t.getAttribute('data-setting');
        BBC.settings[key] = !BBC.settings[key];
        BBC.saveSettings();
        if (key === 'haptics' && BBC.settings.haptics) vibrate(20);
        if (key === 'sound' && BBC.settings.sound) BBC.sfx.pick();
        syncToggles();
      });
    });
    document.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { UI.openSheet(b.getAttribute('data-open')); });
    });
    // Leaving the app pauses the game, so you come back to the pause menu.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && game && !game.over) UI.pause();
    });
    $('#seed-chip').addEventListener('click', function () { UI.openSheet('fair'); });
    $('#sheet-close').addEventListener('click', UI.closeSheet);
    $('#sheet-backdrop').addEventListener('click', UI.closeSheet);
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { UI.openSheet(b.getAttribute('data-tab')); });
    });
    $('#over-new').addEventListener('click', function () { hideOver(); BBC.newGame(); });
    $('#over-replay').addEventListener('click', function () { hideOver(); BBC.newGame({ seed: game.seed }); });

    document.addEventListener('pointerdown', onPickDown, { passive: false });
    document.addEventListener('contextmenu', function (e) { if (!e.target.closest('.sheet-body')) e.preventDefault(); });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    // A drag must never outlive its finger: if the window loses it, put the piece back.
    window.addEventListener('blur', function () { cancelDrag(); });
    window.addEventListener('resize', onResize);
    document.addEventListener('pointerdown', function () { BBC.sfx.unlock(); }, { once: true });
  };

  UI.applyTheme = function () {
    var theme = BBC.mods.applyFilter('theme', JSON.parse(JSON.stringify(DEFAULT_THEME)), {});
    var root = document.documentElement;
    Object.keys(theme.vars).forEach(function (k) { root.style.setProperty(k, theme.vars[k]); });
    for (var i = 0; i < BBC.COLORS; i++) {
      root.style.setProperty('--p' + i, theme.palette[i % theme.palette.length]);
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.vars['--bg1']);
    // Android app: match the strip around the camera cutout to the theme.
    try { if (window.BBCAndroid) window.BBCAndroid.setBg(theme.vars['--bg1']); } catch (e) { /* ignore */ }
    UI.theme = theme;
  };

  UI.setGame = function (g, opts) {
    var fresh = opts && opts.fresh;
    // Drop every animation that belongs to the old game.
    dropDrag();
    flushFlights(true);
    clearReturns();
    if (fresh && game && cellEls.length) wipeBoard();
    game = g;
    overShown = false;
    hideOver();
    buildBoard();
    buildTray();
    shownScore = g.score;
    layout();
    paintBoard();
    syncTray(true, fresh ? 110 : 0);
    renderHud();
    BBC.sfx.deal();
    if (g.over) setTimeout(function () { if (game === g) endGame(); }, 150);
  };

  function buildBoard() {
    boardEl.textContent = '';
    boardEl.style.setProperty('--rows', game.rows);
    boardEl.style.setProperty('--cols', game.cols);
    cellEls = [];
    shown = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < game.rows * game.cols; i++) {
      var c = el('div', 'cell');
      frag.appendChild(c);
      cellEls.push(c);
      shown.push('');
    }
    boardEl.appendChild(frag);
  }

  function buildTray() {
    trayEl.textContent = '';
    slotEls = [];
    for (var i = 0; i < game.handSize; i++) {
      var s = el('div', 'slot');
      s._uid = 0;
      trayEl.appendChild(s);
      slotEls.push(s);
    }
  }

  /* ---------- geometry ---------- */

  /** Measure the board once; everything else is arithmetic on these numbers. */
  function measure() {
    var a = cellEls[0].getBoundingClientRect();
    var b = cellEls[1].getBoundingClientRect();
    var pitch = b.left - a.left || a.width;
    geo = { left: a.left, top: a.top, size: a.width, pitch: pitch, gap: pitch - a.width };
    return geo;
  }

  /** Sizes that depend on the window: tray height and tray block size. */
  function layout() {
    measure();
    var slotW = trayEl.clientWidth / Math.max(1, game.handSize);
    trayMini = Math.max(8, Math.min(geo.pitch * 0.55, (slotW - 16) / 5));
    // Fixed height = room for a 5-block-tall piece, so the layout never shifts
    // when a new hand arrives. Bigger (crazy) pieces are scaled to fit it.
    trayH = Math.round(5 * trayMini + 24);
    var h = trayH + 'px';
    if (trayEl.style.getPropertyValue('--tray-h') !== h) {
      trayEl.style.setProperty('--tray-h', h);
      measure(); // the board may have moved
    }
  }

  function onResize() {
    if (!game) return;
    cancelDrag();
    flushFlights(true);
    layout();
    for (var i = 0; i < slotEls.length; i++) slotEls[i]._uid = -1; // force new sizes
    syncTray(false);
  }

  /* ---------- rendering ---------- */

  /** Full redraw (mods call this through api.ui.refresh). */
  UI.renderAll = function () {
    if (!game) return;
    flushFlights(true);
    paintBoard();
    syncTray(false);
    renderHud();
  };

  function paintCell(i, cell) {
    var key = cell ? cell.color + ':' + cell.kind : '';
    if (shown[i] === key) return;
    shown[i] = key;
    var e = cellEls[i];
    e.className = cell ? 'cell filled kind-' + cell.kind : 'cell';
    if (cell) e.style.setProperty('--c', 'var(--p' + cell.color + ')');
    else e.style.removeProperty('--c');
  }

  /** Bring every cell in line with the game (only touches cells that differ). */
  function paintBoard() {
    for (var i = 0; i < cellEls.length; i++) paintCell(i, game.board[i]);
  }

  function pieceEl(p, size, gap) {
    var wrap = el('div', 'piece');
    wrap.style.width = p.w * size - gap + 'px';
    wrap.style.height = p.h * size - gap + 'px';
    for (var i = 0; i < p.cells.length; i++) {
      var b = el('div', 'cell filled kind-' + p.kind);
      b.style.setProperty('--c', 'var(--p' + p.color + ')');
      b.style.left = p.cells[i][1] * size + 'px';
      b.style.top = p.cells[i][0] * size + 'px';
      b.style.width = b.style.height = size - gap + 'px';
      wrap.appendChild(b);
    }
    return wrap;
  }
  UI.pieceEl = pieceEl;

  /** Block size for a piece in the tray: normal pieces share one size, huge ones shrink to fit. */
  function traySize(p) {
    var slotW = trayEl.clientWidth / Math.max(1, game.handSize);
    return Math.max(3, Math.min(trayMini, (slotW - 10) / p.w, (trayH - 10) / p.h));
  }

  /**
   * Bring the tray in line with the hand. A slot is only rebuilt when it holds
   * a different piece than before, so placing one piece never disturbs the
   * other two (or their arrival animation).
   */
  function syncTray(animate, delay) {
    if (!game) return;
    var n = 0;
    for (var i = 0; i < slotEls.length; i++) {
      var s = slotEls[i];
      var p = game.hand[i] || null;
      var uid = p ? p.uid : 0;
      if (s._uid !== uid) {
        s._uid = uid;
        s.textContent = '';
        if (p) {
          var size = traySize(p);
          var wrap = pieceEl(p, size, Math.max(1, Math.min(2.5, size * 0.09)));
          wrap.classList.add('tray-piece');
          if (animate && !reduceMotion) {
            wrap.classList.add('enter');
            wrap.style.animationDelay = (delay || 0) + n * 28 + 'ms';
          }
          n++;
          s.appendChild(wrap);
        }
      }
      s.classList.toggle('nofit', !!p && !game.fitsAnywhere(p));
      s.classList.toggle('lifted', !!p && slotLifted(i, p));
    }
  }

  function renderHud() {
    animateScore(game.score);
    var best = Math.max(BBC.getBest(BBC.bestKey(game)), game.score);
    setText('#best', best.toLocaleString());
    var combo = $('#combo');
    if (game.combo >= 2) {
      setText('#combo', 'Combo ×' + game.combo);
      combo.classList.add('show');
    } else {
      combo.classList.remove('show');
    }
    setText('#seed-text', BBC.seedToText(game.seed));
    setText('#chip-label', crazyMode() ? 'Crazyness' : smartDealing() ? 'Smart dealer' : 'Fair dealing');
    var modCount = game.modIds.length;
    setText('#mods-badge', modCount ? String(modCount) : '');
    $('#mods-badge').style.display = modCount ? '' : 'none';
  }

  /** Only write text that changed (writing the same text still costs a layout). */
  function setText(sel, text) {
    var e = $(sel);
    if (e.textContent !== text) e.textContent = text;
  }

  function animateScore(target) {
    var scoreEl = $('#score');
    if (scoreAnim) cancelAnimationFrame(scoreAnim);
    scoreAnim = null;
    var from = shownScore;
    if (from === target || reduceMotion) {
      shownScore = target;
      scoreEl.textContent = target.toLocaleString();
      return;
    }
    var t0 = performance.now();
    var dur = Math.min(260, 80 + Math.abs(target - from));
    (function step(now) {
      var k = Math.min(1, Math.max(0, (now - t0) / dur));
      shownScore = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      scoreEl.textContent = shownScore.toLocaleString();
      scoreAnim = k < 1 ? requestAnimationFrame(step) : null;
    })(t0);
  }

  /* ---------- drag & drop ---------- */
  /*
   * Feel, in short:
   *  - Touch-down answers at once: the piece leaves the tray on the same frame.
   *  - It starts exactly where the tray piece is on screen and glides to its
   *    place above your finger (no jump), then follows the finger 1:1.
   *  - Aiming follows the finger from the first millisecond, even while the
   *    picture is still catching up, so the fastest flick still lands.
   *  - What the preview shows is where it lands. Always. A move can't be taken
   *    back, so release never "guesses" a different cell from a flick.
   *  - Letting go commits the move immediately; the piece's last few pixels are
   *    a spring that starts at the finger's speed.
   *  - A piece on its way back to the tray can be caught again mid-air.
   */
  var LOOKAHEAD_MS = 12;   // draw the piece where the finger will be when the frame shows
  var drag = null;
  var flights = [];        // pieces flying into the board (move already made)
  var returns = [];        // pieces flying back to the tray
  var loopOn = false;
  var lastFrame = 0;

  function slotLifted(slot, p) {
    if (drag && drag.slot === slot && drag.piece.uid === p.uid) return true;
    for (var i = 0; i < returns.length; i++) {
      if (returns[i].slot === slot && returns[i].piece.uid === p.uid) return true;
    }
    return false;
  }

  function returnFor(slot) {
    for (var i = 0; i < returns.length; i++) if (returns[i].slot === slot) return returns[i];
    return null;
  }

  /**
   * Big pick-up zone: anywhere below the board counts. You get the piece
   * whose slot is nearest to your finger.
   */
  function onPickDown(e) {
    if (!game || game.over) return;
    if (document.body.classList.contains('paused')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('button, a, input, select, textarea, .sheet, .over, #seed-chip')) return;
    if (drag) {
      // A second finger is ignored. A new *first* finger means the old drag
      // lost its "up" event somewhere: put that piece back and carry on.
      if (!e.isPrimary || e.pointerId === drag.id) return;
      cancelDrag();
    }
    var bb = boardEl.getBoundingClientRect();
    if (e.clientY < bb.bottom + 2) return;
    var tr = trayEl.getBoundingClientRect();
    var n = game.hand.length;
    var slot = -1, bestD = Infinity;
    for (var i = 0; i < n; i++) {
      if (!game.hand[i]) continue;
      var cx = tr.left + ((i + 0.5) * tr.width) / n;
      var d = Math.abs(e.clientX - cx);
      if (d < bestD) { bestD = d; slot = i; }
    }
    if (slot < 0) return;
    startDrag(e, slot);
  }

  function startDrag(e, slot) {
    var p = game.hand[slot];
    var slotEl = slotEls[slot];
    if (!p || !slotEl) return;
    e.preventDefault();
    measure(); // fresh numbers for this drag; nothing is measured again until release
    var pitch = geo.pitch, gap = geo.gap;
    var w = p.w * pitch - gap, h = p.h * pitch - gap;
    var touch = e.pointerType !== 'mouse';
    var now = performance.now();

    // Where is this piece on screen right now? Either flying back to the tray
    // (catch it mid-air) or sitting in / arriving at its slot.
    var ghost, bx, by, scale0, scaleV = 0, vx = 0, vy = 0;
    var R = returnFor(slot);
    if (R && R.piece.uid === p.uid) {
      returns.splice(returns.indexOf(R), 1);
      ghost = R.ghost;
      bx = R.bx.x; by = R.by.x;
      vx = R.bx.v; vy = R.by.v;
      scale0 = R.scale.x; scaleV = R.scale.v;
    } else {
      if (R) dropReturn(R);
      var tp = slotEl.firstChild;
      if (!tp) return;
      var rect = tp.getBoundingClientRect();
      ghost = pieceEl(p, pitch, gap);
      ghost.classList.add('ghost');
      document.body.appendChild(ghost);
      scale0 = rect.width / w;
      bx = rect.left + rect.width / 2;
      by = rect.bottom;
    }

    var tracker = new M.Tracker();
    tracker.reset(e.clientX, e.clientY, e.timeStamp || now);
    // The piece's bottom-centre is tied to the finger; "off" is what is left of
    // the distance to its starting spot, and it springs to zero.
    var ax = e.clientX, ay = touch ? e.clientY : e.clientY + h / 2;
    var offX = new M.Spring(bx - ax, { duration: 0.11, bounce: 0 });
    var offY = new M.Spring(by - ay, { duration: 0.11, bounce: 0 });
    offX.v = vx; offY.v = vy;
    offX.target = 0; offY.target = 0;
    var scale = new M.Spring(scale0, { duration: 0.17, bounce: 0.06 });
    scale.v = scaleV;
    scale.target = 1;

    drag = {
      slot: slot, piece: p, ghost: ghost, id: e.pointerId, pitch: pitch,
      w: w, h: h, touch: touch,
      sx: e.clientX, sy: e.clientY,
      speed: touch ? +BBC.settings.dragSpeed || 1 : 1,
      tracker: tracker, offX: offX, offY: offY, scale: scale,
      lift: new M.Spring(0, { duration: 0.15, bounce: 0 }),
      tilt: new M.Spring(0, { duration: 0.35, bounce: 0.15 }),
      bx: bx, by: by, target: null, shadow: null, glows: []
    };
    drag.lift.target = touch ? pitch * 1.4 : 0;

    try { document.body.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    slotEl.classList.add('lifted');
    BBC.sfx.pick();
    vibrate(6);
    dragFrame(0, now);
    startLoop();
  }

  function startLoop() {
    if (loopOn) return;
    loopOn = true;
    lastFrame = performance.now();
    requestAnimationFrame(tick);
  }

  function tick(now) {
    // After a hitch, don't leap: advance at most two frames' worth.
    var dt = Math.min(0.034, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    var i;
    if (drag) dragFrame(dt, now);
    for (i = 0; i < flights.length; i++) flightFrame(flights[i], dt);
    // Land in the order the moves were made.
    while (flights.length && flights[0].done) commitFlight(flights[0], false);
    for (i = returns.length - 1; i >= 0; i--) returnFrame(returns[i], dt);
    if (drag || flights.length || returns.length) requestAnimationFrame(tick);
    else loopOn = false;
  }

  /** Viewport clamp with iOS-style rubber-banding past the edges. */
  function soften(v, min, max, dim) {
    if (max < min) max = min;
    if (v < min) return min + M.rubberBand(v - min, dim);
    if (v > max) return max + M.rubberBand(v - max, dim);
    return v;
  }

  function dragFrame(dt, now) {
    var d = drag;
    var f = d.tracker.predict(LOOKAHEAD_MS, d.pitch * 0.3, now);
    var x = d.sx + (f.x - d.sx) * d.speed;
    var y = d.sy + (f.y - d.sy) * d.speed;
    d.scale.step(dt);
    d.lift.step(dt);
    d.offX.step(dt);
    d.offY.step(dt);
    var vw = window.innerWidth, vh = window.innerHeight;
    // Anchor = bottom-centre of the piece: above the finger on touch, centred on the mouse.
    var left = soften(x - d.w / 2, -d.w * 0.25, vw - d.w * 0.75, vw * 0.5);
    var top = d.touch ? y - d.lift.x - d.h : y - d.h / 2;
    top = soften(top, Math.min(0, geo.top - d.pitch), vh - d.h * 0.5, vh * 0.5);
    // (ax, ay): where the finger says the piece is. The picture catches up
    // with it within a few frames; aiming never waits for the picture.
    var ax = left + d.w / 2, ay = top + d.h;
    d.bx = ax + d.offX.x;
    d.by = ay + d.offY.x;
    // A slight lean in the direction of travel.
    var v = d.tracker.velocityAt(now);
    d.tilt.target = Math.max(-4, Math.min(4, (v.x * d.speed) / 500));
    d.tilt.step(dt);
    paintGhost(d.ghost, d.bx, d.by, d.w, d.h, d.scale.x, d.tilt.x);

    var target = snapTarget(d.piece, (ay - d.h - geo.top) / d.pitch, (ax - d.w / 2 - geo.left) / d.pitch, d.target);
    if (!sameTarget(target, d.target)) {
      d.target = target;
      showPreview(d, target);
    }
  }

  function paintGhost(g, bx, by, w, h, s, rot) {
    g.style.transform =
      'translate3d(' + (bx - w / 2).toFixed(2) + 'px,' + (by - h).toFixed(2) + 'px,0) rotate(' +
      (rot || 0).toFixed(2) + 'deg) scale(' + s.toFixed(4) + ')';
  }

  /**
   * Nearest spot the piece fits within ~0.8 cell. Sticky: the current spot is
   * kept unless another one is clearly closer, so the preview doesn't flicker.
   */
  function snapTarget(piece, fr, fc, current) {
    var r0 = Math.round(fr), c0 = Math.round(fc);
    var best = null, bestD = 0.8 * 0.8;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var r = r0 + dr, c = c0 + dc;
        var d = (r - fr) * (r - fr) + (c - fc) * (c - fc);
        if (d < bestD && game.canPlace(piece, r, c)) { best = { r: r, c: c }; bestD = d; }
      }
    }
    if (current && best && !sameTarget(current, best) && game.canPlace(piece, current.r, current.c)) {
      var cd = (current.r - fr) * (current.r - fr) + (current.c - fc) * (current.c - fc);
      if (cd < 0.78 * 0.78 && Math.sqrt(cd) - Math.sqrt(bestD) < 0.22) return current;
    }
    return best;
  }

  function sameTarget(a, b) {
    return (!a && !b) || (!!a && !!b && a.r === b.r && a.c === b.c);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    drag.tracker.add(e); // just record; the frame loop draws once per frame
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    var now = performance.now();
    d.tracker.add(e);
    dragFrame(0, now); // settle the preview on the finger's final position
    drag = null;
    hidePreview(d);
    var v = d.tracker.velocityAt(now);
    var vx = clamp(v.x * d.speed, -2500, 2500), vy = clamp(v.y * d.speed, -2500, 2500);
    d.tvx = vx; d.tvy = vy;
    // What you saw is what you get: land on the previewed cell or go back.
    if (d.target && game.canPlace(d.piece, d.target.r, d.target.c) && game.hand[d.slot] === d.piece) {
      land(d, d.target, vx, vy);
    } else {
      sendBack(d, vx, vy);
    }
  }

  function onCancel(e) {
    if (drag && e.pointerId === drag.id) cancelDrag();
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /** Put the dragged piece back in the tray (pause, lost pointer, resize). */
  function cancelDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;
    hidePreview(d);
    sendBack(d, 0, 0);
  }

  /** Forget the drag without any animation (the game it belonged to is gone). */
  function dropDrag() {
    if (!drag) return;
    hidePreview(drag);
    drag.ghost.remove();
    drag = null;
  }

  /* ---------- preview layer ---------- */

  function showPreview(d, target) {
    if (!target) {
      hidePreview(d, true);
      return;
    }
    if (!d.shadow) {
      d.shadow = pieceEl(d.piece, d.pitch, geo.gap);
      d.shadow.classList.add('shadow');
      underEl.appendChild(d.shadow);
    }
    d.shadow.style.transform =
      'translate3d(' + (geo.left + target.c * d.pitch).toFixed(2) + 'px,' + (geo.top + target.r * d.pitch).toFixed(2) + 'px,0)';
    d.shadow.style.visibility = 'visible';

    // Lines this spot would clear: one glowing bar per row / column.
    var lines = game.previewClear(d.piece, target.r, target.c);
    var n = 0, i;
    var color = 'var(--p' + d.piece.color + ')';
    var fullW = game.cols * d.pitch - geo.gap, fullH = game.rows * d.pitch - geo.gap;
    for (i = 0; i < lines.rows.length; i++) glow(d, n++, geo.left, geo.top + lines.rows[i] * d.pitch, fullW, geo.size, color);
    for (i = 0; i < lines.cols.length; i++) glow(d, n++, geo.left + lines.cols[i] * d.pitch, geo.top, geo.size, fullH, color);
    for (i = n; i < d.glows.length; i++) d.glows[i].style.visibility = 'hidden';
  }

  function glow(d, n, x, y, w, h, color) {
    var g = d.glows[n];
    if (!g) {
      g = el('div', 'line-glow');
      g.style.setProperty('--wc', color);
      underEl.appendChild(g);
      d.glows[n] = g;
    }
    g.style.width = w + 'px';
    g.style.height = h + 'px';
    g.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
    g.style.visibility = 'visible';
  }

  /** keep = only hide (the drag goes on); otherwise remove the layer's elements. */
  function hidePreview(d, keep) {
    var i;
    if (keep) {
      if (d.shadow) d.shadow.style.visibility = 'hidden';
      for (i = 0; i < d.glows.length; i++) d.glows[i].style.visibility = 'hidden';
      return;
    }
    if (d.shadow) d.shadow.remove();
    for (i = 0; i < d.glows.length; i++) d.glows[i].remove();
    d.shadow = null;
    d.glows = [];
  }

  /* ---------- landing ---------- */

  /**
   * Make the move now, then let the piece fly the last few pixels. The spring
   * starts at the finger's speed, so there is no seam between drag and landing.
   */
  function land(d, target, vx, vy) {
    var g = game;
    var res = g.place(d.slot, target.r, target.c, { deferDeal: true });
    if (!res) {
      sendBack(d, vx, vy);
      return;
    }
    syncTray(false); // this slot empties; the others update their "fits" state
    // Stiff and without bounce: the piece is driven straight into its cells.
    // Only a little of the finger's speed is carried, so it can't swing past.
    var opt = { duration: 0.11, bounce: 0 };
    var bx = new M.Spring(d.bx, opt), by = new M.Spring(d.by, opt);
    bx.v = clamp(vx, -900, 900); by.v = clamp(vy, -900, 900);
    bx.target = geo.left + target.c * d.pitch + d.w / 2;
    by.target = geo.top + target.r * d.pitch + d.h;
    flights.push({
      game: g, res: res, ghost: d.ghost, w: d.w, h: d.h,
      bx: bx, by: by,
      scale: d.scale.to(1, { duration: 0.1, bounce: 0 }),
      tilt: d.tilt.to(0, { duration: 0.1, bounce: 0 }),
      t: 0, done: false
    });
    BBC.saveSoon();
    if (reduceMotion) flushFlights(false);
    else startLoop();
  }

  function flightFrame(F, dt) {
    if (F.done) return;
    F.t += dt;
    var x = F.bx.step(dt), y = F.by.step(dt);
    F.scale.step(dt);
    F.tilt.step(dt);
    paintGhost(F.ghost, x, y, F.w, F.h, F.scale.x, F.tilt.x);
    var near = Math.abs(x - F.bx.target) < 0.75 && Math.abs(y - F.by.target) < 0.75;
    var slow = Math.abs(F.bx.v) < 90 && Math.abs(F.by.v) < 90;
    if ((near && slow) || F.t > 0.15) F.done = true;
  }

  /** The piece has arrived: draw the move's result on the board. */
  function commitFlight(F, quiet) {
    var i = flights.indexOf(F);
    if (i >= 0) flights.splice(i, 1);
    var res = F.res, g = F.game;
    if (g !== game) {
      F.ghost.remove();
      return;
    }
    var k;
    for (k = 0; k < res.cells.length; k++) {
      paintCell(g.idx(res.cells[k][0], res.cells[k][1]), { color: res.piece.color, kind: res.piece.kind });
    }
    for (k = 0; k < res.cleared.length; k++) paintCell(g.idx(res.cleared[k].r, res.cleared[k].c), null);

    if (quiet || reduceMotion) {
      F.ghost.remove();
    } else {
      // Impact: the ghost turns into a white flash exactly on its cells and
      // fades, the blocks are stamped in (pressed, then flat) and the board
      // takes the hit with a short dip. Firm, no wobble.
      paintGhost(F.ghost, F.bx.target, F.by.target, F.w, F.h, 1, 0);
      F.ghost.classList.add('flash');
      fade(F.ghost, [{ opacity: 0.8 }, { opacity: 0 }], 130);
      stamp(res, g);
    }
    if (!quiet) {
      vibrate(res.lines ? [16, 26, 22] : 14);
      if (res.cleared.length) {
        burst(res);
        BBC.sfx.clear(res.lines, res.combo);
      } else {
        BBC.sfx.place();
      }
      floatPoints(res);
      if (res.lines) praise(res);
    }
    renderHud();

    if (!flights.length) {
      // All caught up: make sure the screen matches the game exactly
      // (a mod may have changed the board outside a normal move).
      paintBoard();
      if (g.dealPending) scheduleDeal(g);
      else if (g.over) endGame();
    }
  }

  var STAMP = [{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }];
  var THUD = [{ transform: 'translateY(0)' }, { transform: 'translateY(2.5px)', offset: 0.3 }, { transform: 'translateY(0)' }];

  function stamp(res, g) {
    try {
      var opt = { duration: 110, easing: 'cubic-bezier(.2, .9, .2, 1)' };
      for (var k = 0; k < res.cells.length; k++) {
        var i = g.idx(res.cells[k][0], res.cells[k][1]);
        if (g.board[i] || shown[i]) cellEls[i].animate(STAMP, opt);
      }
      boardEl.animate(THUD, { duration: 120, easing: 'ease-out' });
    } catch (e) { /* older WebView: no stamp */ }
  }

  /** Land everything that is still in the air, right now. */
  function flushFlights(quiet) {
    while (flights.length) commitFlight(flights[0], quiet);
  }

  /**
   * The hand is empty: deal the next one. It waits one painted frame so the
   * landing flash and line pops are already running (they don't need the main
   * thread) while the dealer thinks.
   */
  function scheduleDeal(g) {
    if (g._dealQueued) return;
    g._dealQueued = true;
    var run = function () {
      if (!g._dealQueued) return;
      g._dealQueued = false;
      if (g !== game || !g.dealPending) return;
      g.dealNow();
      syncTray(true);
      BBC.sfx.deal();
      BBC.saveSoon();
      if (g.over) {
        paintBoard();
        endGame();
      }
    };
    requestAnimationFrame(function () { setTimeout(run, 0); });
    setTimeout(run, 150); // also when the page isn't painting (hidden tab)
  }

  /* ---------- back to the tray ---------- */

  /** No valid spot: the piece springs back to its slot, keeping its momentum. */
  function sendBack(d, vx, vy) {
    var slotEl = slotEls[d.slot];
    var tp = slotEl && slotEl.firstChild;
    if (!tp || game.hand[d.slot] !== d.piece) {
      d.ghost.remove();
      syncTray(false);
      return;
    }
    var sr = slotEl.getBoundingClientRect();
    var tw = tp.offsetWidth, th = tp.offsetHeight; // layout size, unaffected by animations
    var opt = { duration: 0.3, bounce: 0.14 };
    var bx = new M.Spring(d.bx, opt), by = new M.Spring(d.by, opt);
    bx.v = vx; by.v = vy;
    bx.target = sr.left + sr.width / 2;
    by.target = sr.top + sr.height / 2 + th / 2;
    returns.push({
      slot: d.slot, piece: d.piece, ghost: d.ghost, w: d.w, h: d.h,
      bx: bx, by: by,
      scale: d.scale.to(tw / d.w, opt),
      tilt: d.tilt.to(0, opt),
      t: 0
    });
    BBC.sfx.drop();
    if (reduceMotion) clearReturns();
    else startLoop();
  }

  function returnFrame(R, dt) {
    R.t += dt;
    var x = R.bx.step(dt), y = R.by.step(dt);
    R.scale.step(dt);
    R.tilt.step(dt);
    paintGhost(R.ghost, x, y, R.w, R.h, R.scale.x, R.tilt.x);
    if ((R.bx.settled(0.6) && R.by.settled(0.6)) || R.t > 0.7) dropReturn(R);
  }

  /** The piece is home: show the tray piece again, on the same frame the ghost goes. */
  function dropReturn(R) {
    var i = returns.indexOf(R);
    if (i >= 0) returns.splice(i, 1);
    R.ghost.remove();
    var s = slotEls[R.slot];
    if (s && !(drag && drag.slot === R.slot)) s.classList.remove('lifted');
  }

  function clearReturns() {
    while (returns.length) dropReturn(returns[0]);
  }

  /* ---------- effects ---------- */

  /** Run a compositor-friendly animation, then remove the element. */
  function fade(node, frames, ms, delay, easing) {
    var done = function () { node.remove(); };
    try {
      var a = node.animate(frames, { duration: ms, delay: delay || 0, easing: easing || 'ease-out', fill: 'both' });
      a.onfinish = done;
      a.oncancel = done;
    } catch (e) {
      setTimeout(done, ms + (delay || 0));
    }
  }

  /** Keep the effects layer small no matter how fast lines are cleared. */
  function trimFx() {
    var extra = fxEl.childElementCount - 260;
    while (extra-- > 0 && fxEl.firstChild) fxEl.firstChild.remove();
  }

  var POP = [
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(1.14)', opacity: 1, offset: 0.28 },
    { transform: 'scale(0.25) rotate(22deg)', opacity: 0 }
  ];

  function popCell(r, c, cell, delay) {
    var b = el('div', 'cell filled pop kind-' + cell.kind);
    b.style.setProperty('--c', 'var(--p' + cell.color + ')');
    b.style.width = b.style.height = geo.size + 'px';
    b.style.left = geo.left + c * geo.pitch + 'px';
    b.style.top = geo.top + r * geo.pitch + 'px';
    fxEl.appendChild(b);
    fade(b, POP, 250, delay);
  }

  /** Cleared blocks pop in a ripple that spreads out from the piece you placed. */
  function burst(res) {
    var cr = 0, cc = 0, i;
    for (i = 0; i < res.cells.length; i++) { cr += res.cells[i][0]; cc += res.cells[i][1]; }
    cr /= res.cells.length;
    cc /= res.cells.length;
    for (i = 0; i < res.cleared.length; i++) {
      var x = res.cleared[i];
      var dist = Math.abs(x.r - cr) + Math.abs(x.c - cc);
      popCell(x.r, x.c, x.cell, Math.min(90, dist * 9));
    }
    trimFx();
  }

  /** Restart: the old blocks pop away in a diagonal wave. */
  function wipeBoard() {
    if (reduceMotion || !geo) return;
    for (var i = 0; i < game.board.length; i++) {
      var cell = game.board[i];
      if (!cell) continue;
      var r = Math.floor(i / game.cols), c = i % game.cols;
      popCell(r, c, cell, (r + c) * 12);
    }
  }

  function floatPoints(res) {
    if (!res.points) return;
    var rs = 0, cs = 0;
    res.cells.forEach(function (rc) { rs += rc[0]; cs += rc[1]; });
    var f = el('div', 'float' + (res.lines ? ' big' : ''));
    f.textContent = '+' + res.points;
    if (res.lines >= 2) f.appendChild(el('small', null, res.perfect ? 'Board cleared!' : res.lines + ' lines'));
    else if (res.perfect) f.appendChild(el('small', null, 'Board cleared!'));
    f.style.left = geo.left + (cs / res.cells.length + 0.5) * geo.pitch + 'px';
    f.style.top = geo.top + (rs / res.cells.length + 0.5) * geo.pitch + 'px';
    fxEl.appendChild(f);
    fade(f, [
      { transform: 'translate(-50%, -30%)', opacity: 0 },
      { transform: 'translate(-50%, -60%)', opacity: 1, offset: 0.15 },
      { transform: 'translate(-50%, -230%)', opacity: 0 }
    ], 650);
  }

  var PRAISE = ['', '', 'Good!', 'Great!', 'Excellent!', 'Amazing!', 'Unbelievable!'];
  var lastPraise = null;

  function callout(cls, main, sub, x, y, ms) {
    var p = el('div', cls);
    if (main) p.appendChild(el('div', 'praise-main', main));
    if (sub) p.appendChild(el('div', 'praise-combo', sub));
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    fxEl.appendChild(p);
    var spring = M.easings && M.easings.bouncy;
    // Springs in (it celebrates a throw), fades out on its own.
    try {
      p.animate([{ transform: 'translate(-50%, -50%) scale(0.5)' }, { transform: 'translate(-50%, -50%) scale(1)' }],
        { duration: spring ? spring.ms : 300, easing: spring ? spring.easing : 'ease-out', fill: 'both' });
    } catch (e) { /* older WebView: appears without the pop */ }
    fade(p, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], ms);
    return p;
  }

  /** Big centered callout for multi-line clears and combos. */
  function praise(res) {
    var text = res.perfect ? 'Board clear!' : PRAISE[Math.min(res.lines, PRAISE.length - 1)];
    var combo = res.combo >= 2 ? 'Combo ' + res.combo : '';
    if (!text && !combo) return;
    // At speed, a new callout replaces the last one instead of piling up.
    if (lastPraise && lastPraise.isConnected) lastPraise.remove();
    var bb = boardEl.getBoundingClientRect();
    lastPraise = callout('praise', text, combo, bb.left + bb.width / 2, bb.top + bb.height * 0.42, 850);
  }

  /** Big centered title, e.g. when a new biome starts. */
  UI.banner = function (text) {
    var bb = boardEl.getBoundingClientRect();
    callout('praise banner', text, '', bb.left + bb.width / 2, bb.top - 34, 1400);
  };

  /** Game over: blocks turn grey from the bottom row up. Returns duration in ms. */
  function greyOut(g) {
    var step = 35;
    for (var r = g.rows - 1; r >= 0; r--) {
      (function (row, delay) {
        setTimeout(function () {
          if (g !== game) return;
          for (var c = 0; c < g.cols; c++) {
            if (g.board[g.idx(row, c)]) cellEls[g.idx(row, c)].classList.add('dead');
          }
        }, delay);
      })(r, (g.rows - 1 - r) * step);
    }
    return g.rows * step;
  }

  function vibrate(p) {
    if (!BBC.settings.haptics) return;
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ }
  }

  /* ---------- game over ---------- */

  function endGame() {
    if (overShown || !game || !game.over) return;
    overShown = true;
    var g = game;
    cancelDrag();
    BBC.updateBest(g);
    BBC.saveSoon();
    var t = greyOut(g);
    setTimeout(function () { if (g === game) showOver(); }, t + 250);
  }

  function showOver() {
    if (!game || !game.over) return;
    BBC.sfx.over();
    var best = BBC.getBest(BBC.bestKey(game));
    $('#over-score').textContent = game.score.toLocaleString();
    $('#over-best').textContent = best.toLocaleString();
    $('#over-new-best').style.display = game.score > 0 && game.score >= best ? '' : 'none';
    $('#over-stats').textContent =
      game.moves + ' moves · ' + game.lines + ' lines · seed ' + BBC.seedToText(game.seed);
    syncModeSwitch();
    $('#over').classList.add('show');
  }

  function hideOver() {
    $('#over').classList.remove('show');
  }

  function smartDealing() {
    return (BBC.mods._filters.dealHand || []).length > 0;
  }

  function crazyMode() {
    return !!game && game.modIds.indexOf('crazyness') >= 0;
  }

  /** Mode buttons (pause menu and game-over card) show the mode the NEXT game will use. */
  function syncModeSwitch() {
    var mode = BBC.getMode();
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    var r = $('#pause-restart');
    if (pendingGameplayChange() && game && !game.over) {
      // Picking another mode is already a deliberate tap: one more starts it.
      r.dataset.armed = '1';
      r.textContent = 'Start ' + (mode === 'crazyness' ? 'Crazyness' : 'Classic') + ' game';
      r.classList.add('warn');
    } else {
      delete r.dataset.armed;
      r.textContent = 'Restart';
      r.classList.remove('warn');
    }
    $('#over-new').textContent = pendingGameplayChange() && mode === 'crazyness' ? 'Play Crazyness' : 'Play again';
  }

  /* ---------- toast ---------- */

  UI.toast = function (msg, kind) {
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 2600);
    setTimeout(function () { t.remove(); }, 3000);
  };

  /* ---------- sheet (menu) ---------- */

  var currentTab = null;

  UI.openSheet = function (tab) {
    currentTab = tab;
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    var body = $('#sheet-body');
    body.innerHTML = '';
    if (tab === 'mods') renderModsTab(body);
    else if (tab === 'fair') renderFairTab(body);
    else renderSettingsTab(body);
    $('#sheet').classList.add('show');
  };

  UI.closeSheet = function () {
    $('#sheet').classList.remove('show');
    currentTab = null;
  };

  UI.back = function () {
    if ($('#sheet').classList.contains('show')) {
      UI.closeSheet();
      return true;
    }
    if ($('#pause').classList.contains('show')) {
      UI.resume();
      return true;
    }
    return false;
  };

  /* ---------- pause menu ---------- */

  UI.pause = function () {
    if (!game || game.over) return;
    cancelDrag();
    $('#pause-score').textContent = game.score.toLocaleString();
    $('#pause-best').textContent = Math.max(BBC.getBest(BBC.bestKey(game)), game.score).toLocaleString();
    syncModeSwitch();
    syncToggles();
    $('#pause').classList.add('show');
    document.body.classList.add('paused');
  };

  UI.resume = function () {
    $('#pause').classList.remove('show');
    document.body.classList.remove('paused');
  };

  function syncToggles() {
    document.querySelectorAll('.round-toggle').forEach(function (t) {
      t.classList.toggle('off', !BBC.settings[t.getAttribute('data-setting')]);
    });
  }

  UI.onModsChanged = function () {
    if (currentTab === 'mods') UI.openSheet('mods');
  };

  function pendingGameplayChange() {
    if (!game) return false;
    var now = BBC.mods.rulesetFor(BBC.mods.enabledIds('gameplay')).join('|');
    return now !== game.ruleset.join('|');
  }

  function renderModsTab(body) {
    var mods = BBC.mods;
    if (pendingGameplayChange()) {
      var bar = el('div', 'notice');
      bar.appendChild(el('span', null, 'Gameplay mods changed. They apply from the next game.'));
      var b = el('button', 'btn small', 'New game now');
      b.addEventListener('click', function () { UI.closeSheet(); BBC.newGame(); });
      bar.appendChild(b);
      body.appendChild(bar);
    }

    mods.errors.slice(-3).forEach(function (m) { body.appendChild(el('div', 'notice error', m)); });

    if (!mods.registry.length) body.appendChild(el('p', 'muted', 'No mods installed.'));
    mods.registry.forEach(function (m) {
      var card = el('div', 'mod');
      var head = el('div', 'mod-head');
      var title = el('div', 'mod-title');
      title.appendChild(el('strong', null, m.name));
      title.appendChild(el('span', 'tag ' + m.type, m.type === 'cosmetic' ? 'Look' : 'Gameplay'));
      if (m.source === 'custom') title.appendChild(el('span', 'tag custom', 'Yours'));
      if (game && game.modIds.indexOf(m.id) >= 0 && m.type === 'gameplay') title.appendChild(el('span', 'tag live', 'In this game'));
      head.appendChild(title);
      var sw = el('label', 'switch');
      var input = el('input');
      input.type = 'checkbox';
      input.checked = mods.isEnabled(m.id);
      input.addEventListener('change', function () {
        mods.setEnabled(m.id, input.checked);
        if (m.type === 'cosmetic') BBC.reactivate();
        UI.openSheet('mods');
      });
      sw.appendChild(input);
      sw.appendChild(el('span'));
      head.appendChild(sw);
      card.appendChild(head);
      card.appendChild(el('p', 'muted', m.description));
      card.appendChild(el('div', 'mod-meta', 'v' + m.version + ' · by ' + m.author + ' · id: ' + m.id));

      if (mods.isEnabled(m.id) && m.settings.length) {
        var form = el('div', 'mod-settings');
        m.settings.forEach(function (st) { form.appendChild(settingField(m, st)); });
        card.appendChild(form);
      }
      if (m.source === 'custom') {
        var rm = el('button', 'btn small ghost-btn', 'Remove');
        rm.addEventListener('click', function () {
          mods.removeCustom(m.id);
          BBC.reactivate();
          UI.openSheet('mods');
        });
        card.appendChild(rm);
      }
      body.appendChild(card);
    });

    var add = el('details', 'add-mod');
    add.appendChild(el('summary', null, 'Install a mod from code'));
    add.appendChild(el('p', 'muted', 'Paste the JavaScript of a mod (it must call BBC.mods.register). See MODDING.md in the repo.'));
    var ta = el('textarea');
    ta.placeholder = "BBC.mods.register({\n  id: 'my-mod',\n  name: 'My mod',\n  setup(api) { ... }\n});";
    ta.spellcheck = false;
    add.appendChild(ta);
    var install = el('button', 'btn', 'Install');
    install.addEventListener('click', function () {
      try {
        var ids = mods.runCustom(ta.value, true);
        UI.toast('Installed: ' + ids.map(function (id) { return mods.byId[id].name; }).join(', '));
        UI.openSheet('mods');
      } catch (e) {
        UI.toast('Mod error: ' + e.message, 'error');
      }
    });
    add.appendChild(install);
    body.appendChild(add);
  }

  function settingField(m, st) {
    var row = el('label', 'field');
    row.appendChild(el('span', null, st.label || st.key));
    var val = BBC.mods.getSetting(m.id, st.key);
    var input;
    if (st.type === 'boolean') {
      input = el('input');
      input.type = 'checkbox';
      input.checked = !!val;
    } else if (st.type === 'select') {
      input = el('select');
      (st.options || []).forEach(function (o) {
        var opt = el('option', null, o.label || o.value);
        opt.value = o.value;
        if (String(o.value) === String(val)) opt.selected = true;
        input.appendChild(opt);
      });
    } else {
      input = el('input');
      input.type = 'number';
      if (st.min != null) input.min = st.min;
      if (st.max != null) input.max = st.max;
      if (st.step != null) input.step = st.step;
      input.value = val;
    }
    input.addEventListener('change', function () {
      var v;
      if (st.type === 'boolean') v = input.checked;
      else if (st.type === 'select') v = input.value;
      else {
        v = parseFloat(input.value);
        if (isNaN(v)) v = st.default;
        if (st.min != null) v = Math.max(st.min, v);
        if (st.max != null) v = Math.min(st.max, v);
        input.value = v;
      }
      BBC.mods.setSetting(m.id, st.key, v);
      if (m.type === 'cosmetic') BBC.reactivate();
      UI.openSheet('mods');
    });
    row.appendChild(input);
    return row;
  }

  function renderFairTab(body) {
    body.appendChild(el('h3', null, 'How pieces are dealt'));
    var p = el('p');
    var dealersOn = (BBC.mods._filters.dealHand || []).map(function (f) { return f.mod.name; });
    p.textContent = dealersOn.length
      ? dealersOn.join(', ') + ' is choosing your pieces. It looks at your board and picks the hand that helps you most: ' +
        'big pieces that fit, line clears and full-board clears. It never deals against you. ' +
        'Switch it off in Mods for pure random dealing (from the next game).'
      : 'Every piece is drawn on its own, at random, from the list of shapes below. ' +
        'The dealer never looks at your board, your score, your combo or how long you have been playing.';
    if (crazyMode()) {
      p.textContent = 'Crazyness mode: every hand mixes the regular shapes below with crazy blocks grown from the free space on your board (1 or 2 per hand, sometimes all 3). ' +
        'A crazy block is one connected shape (blocks may touch diagonally) that is not in the shape list and does not look like one. ' +
        'Each hand is planned two steps ahead so it always fits, and the crazy blocks are made as big as the size cap allows while the hand stays playable. ' +
        'Change the mix and the cap under Mods → Crazyness.';
    }
    body.appendChild(p);
    body.appendChild(el('p', 'muted', 'No ads, no revives to buy, no difficulty that ramps up behind your back.'));

    var weights = game.weights();
    var total = weights.reduce(function (a, b) { return a + Math.max(0, b); }, 0);
    var equal = weights.every(function (w) { return w === weights[0]; });
    if (dealersOn.length) body.appendChild(el('h3', null, 'Shapes (odds when random)'));
    body.appendChild(el('p', 'muted',
      game.catalog.length + ' shapes in play. ' +
      (equal ? 'Every shape has the same chance: ' + (100 / game.catalog.length).toFixed(1) + '% each.'
             : 'A mod changed the odds. Chances are shown under each shape.')));

    var grid = el('div', 'shape-grid');
    game.catalog.forEach(function (s, i) {
      var cell = el('div', 'shape-cell');
      var p2 = { cells: s.cells, w: s.w, h: s.h, kind: s.kind || 'normal', color: i % BBC.COLORS };
      cell.appendChild(pieceEl(p2, 9, 1));
      if (!equal) cell.appendChild(el('small', null, (100 * Math.max(0, weights[i]) / total).toFixed(1) + '%'));
      grid.appendChild(cell);
    });
    body.appendChild(grid);


    body.appendChild(el('h3', null, 'Seed'));
    body.appendChild(el('p', 'muted',
      'This game\'s seed is ' + BBC.seedToText(game.seed) + '. ' + (dealersOn.length
        ? 'With a smart dealer on, the pieces depend on how you play, so a seed only replays the first hand exactly.'
        : 'Start a game with the same seed and you get exactly the same pieces in the same order, whatever you do on the board. Send it to a friend and compare scores.')));
    var row = el('div', 'seed-row');
    var input = el('input');
    input.placeholder = 'Type a seed (or any word)';
    input.value = '';
    var go = el('button', 'btn', 'Play seed');
    go.addEventListener('click', function () {
      var v = input.value.trim();
      UI.closeSheet();
      BBC.newGame({ seed: v ? BBC.textToSeed(v) : game.seed });
    });
    row.appendChild(input);
    row.appendChild(go);
    body.appendChild(row);
    var copy = el('button', 'btn ghost-btn', 'Copy this seed');
    copy.addEventListener('click', function () {
      try {
        navigator.clipboard.writeText(BBC.seedToText(game.seed)).then(
          function () { UI.toast('Seed copied'); },
          function () { UI.toast('Seed: ' + BBC.seedToText(game.seed)); });
      } catch (e) {
        UI.toast('Seed: ' + BBC.seedToText(game.seed));
      }
    });
    body.appendChild(copy);

    body.appendChild(el('h3', null, 'Scoring'));
    var ul = el('ul', 'rules');
    [
      '+1 point for every block you place.',
      'Clearing lines: (combo + 1) × 10 × lines × max(1, lines − 1). So 1 line = 10, 2 lines = 40, 3 lines = 180, 4 lines = 480 before combo.',
      'Every move that clears a line raises your combo by 1.',
      'Your combo survives up to 2 moves without a clear; the 3rd one in a row resets it.'
    ].forEach(function (t) { ul.appendChild(el('li', null, t)); });
    body.appendChild(ul);
  }

  function renderSettingsTab(body) {
    body.appendChild(toggleRow('Sound', 'sound'));
    body.appendChild(toggleRow('Vibration', 'haptics'));
    var ds = el('label', 'field');
    ds.appendChild(el('span', null, 'Drag speed (touch)'));
    var sel = el('select');
    [['1', '1× (follows finger)'], ['1.25', '1.25×'], ['1.35', '1.35×'], ['1.5', '1.5×'], ['1.75', '1.75×'], ['2', '2×']].forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      if (+o[0] === +BBC.settings.dragSpeed) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      BBC.settings.dragSpeed = +sel.value;
      BBC.saveSettings();
    });
    ds.appendChild(sel);
    body.appendChild(ds);
    var stats = el('div', 'stats');
    stats.appendChild(el('div', null, 'Score: ' + game.score.toLocaleString()));
    stats.appendChild(el('div', null, 'Moves: ' + game.moves));
    stats.appendChild(el('div', null, 'Lines: ' + game.lines));
    stats.appendChild(el('div', null, 'Hands dealt: ' + game.handsDealt));
    body.appendChild(stats);
    var ng = el('button', 'btn', 'New game');
    ng.addEventListener('click', function () { UI.closeSheet(); BBC.newGame(); });
    body.appendChild(ng);
    var reset = el('button', 'btn ghost-btn', 'Reset best scores');
    reset.addEventListener('click', function () {
      if (reset.dataset.armed) {
        BBC.resetBest();
        UI.toast('Best scores reset');
        UI.renderAll();
        UI.openSheet('settings');
      } else {
        reset.dataset.armed = '1';
        reset.textContent = 'Tap again to confirm';
      }
    });
    body.appendChild(reset);
    body.appendChild(el('p', 'muted small', 'BurstBlastCrazyness ' + BBC.VERSION + ' · open source · no ads, no tracking.'));
  }

  function toggleRow(label, key) {
    var row = el('label', 'field');
    row.appendChild(el('span', null, label));
    var sw = el('span', 'switch');
    var input = el('input');
    input.type = 'checkbox';
    input.checked = !!BBC.settings[key];
    input.addEventListener('change', function () {
      BBC.settings[key] = input.checked;
      BBC.saveSettings();
    });
    sw.appendChild(input);
    sw.appendChild(el('span'));
    row.appendChild(sw);
    return row;
  }
})((window.BBC = window.BBC || {}));
