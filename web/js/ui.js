/* BurstBlastCrazyness — rendering, drag & drop, menus. */
(function (BBC) {
  'use strict';

  var UI = (BBC.ui = {});
  var $ = function (s) { return document.querySelector(s); };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  var game = null;
  var boardEl, trayEl, cellEls = [];
  var drag = null;
  var preview = { cells: [], lines: [] };
  var shownScore = 0;
  var scoreAnim = null;

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
    $('#btn-menu').addEventListener('click', function () { UI.openSheet('mods'); });
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
    window.addEventListener('resize', function () { renderTray(); });
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
    if (fresh && game && cellEls.length) wipeBoard();
    game = g;
    hideOver();
    buildBoard();
    shownScore = g.score;
    UI.renderAll();
    dealAnim(fresh ? 120 : 0);
    if (g.over) setTimeout(showOver, 150);
  };

  /** New hand: pieces fly in from the right, one after another, with a little overshoot. */
  function dealAnim(delay) {
    trayEl.classList.remove('deal');
    void trayEl.offsetWidth;
    trayEl.style.setProperty('--deal-delay', (delay || 0) + 'ms');
    trayEl.classList.add('deal');
    BBC.sfx.deal();
    clearTimeout(dealAnim.t);
    dealAnim.t = setTimeout(function () { trayEl.classList.remove('deal'); }, 420 + (delay || 0));
  }

  /** Restart: the old blocks pop away in a diagonal wave. */
  function wipeBoard() {
    var o = gridOrigin();
    var pitch = cellPitch();
    var layer = $('#fx');
    for (var i = 0; i < game.board.length; i++) {
      var cell = game.board[i];
      if (!cell) continue;
      var r = Math.floor(i / game.cols), c = i % game.cols;
      var b = el('div', 'cell filled pop kind-' + cell.kind);
      b.style.setProperty('--c', 'var(--p' + cell.color + ')');
      b.style.width = b.style.height = o.width + 'px';
      b.style.left = o.left + c * pitch + 'px';
      b.style.top = o.top + r * pitch + 'px';
      b.style.animationDelay = (r + c) * 12 + 'ms';
      layer.appendChild(b);
      (function (node) { setTimeout(function () { node.remove(); }, 600); })(b);
    }
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--rows', game.rows);
    boardEl.style.setProperty('--cols', game.cols);
    cellEls = [];
    for (var i = 0; i < game.rows * game.cols; i++) {
      var c = el('div', 'cell');
      boardEl.appendChild(c);
      cellEls.push(c);
    }
  }

  /* ---------- rendering ---------- */

  UI.renderAll = function () {
    if (!game) return;
    renderBoard();
    renderTray();
    renderHud();
  };

  function cellClass(cell) {
    return cell ? 'cell filled kind-' + cell.kind : 'cell';
  }

  function renderBoard() {
    for (var i = 0; i < cellEls.length; i++) {
      var cell = game.board[i];
      var e = cellEls[i];
      e.className = cellClass(cell);
      e.style.setProperty('--c', cell ? 'var(--p' + cell.color + ')' : 'transparent');
    }
    preview = { cells: [], lines: [] };
  }

  function miniSize() {
    var slotW = trayEl.clientWidth / Math.max(1, game.handSize);
    var boardCell = cellPitch();
    var maxDim = 5;
    return Math.max(10, Math.min(boardCell * 0.55, (slotW - 16) / maxDim));
  }

  function renderTray() {
    if (!game) return;
    trayEl.innerHTML = '';
    var mini = miniSize();
    // Fixed height = room for the tallest possible piece (5 blocks), so the
    // layout never shifts when a new hand arrives.
    var trayH = Math.round(5 * mini + 24) + 'px';
    if (trayEl.style.getPropertyValue('--tray-h') !== trayH) trayEl.style.setProperty('--tray-h', trayH);
    game.hand.forEach(function (p, slot) {
      var s = el('div', 'slot');
      s.dataset.slot = slot;
      if (p) {
        var fits = game.fitsAnywhere(p);
        var wrap = pieceEl(p, mini, Math.max(2, mini * 0.08));
        wrap.classList.add('tray-piece');
        if (!fits) s.classList.add('nofit');
        if (drag && drag.slot === slot) s.classList.add('dragging');
        s.appendChild(wrap);
      }
      trayEl.appendChild(s);
    });
  }

  function pieceEl(p, size, gap) {
    var wrap = el('div', 'piece');
    wrap.style.width = p.w * size - gap + 'px';
    wrap.style.height = p.h * size - gap + 'px';
    p.cells.forEach(function (rc) {
      var b = el('div', 'cell filled kind-' + p.kind);
      b.style.setProperty('--c', 'var(--p' + p.color + ')');
      b.style.left = rc[1] * size + 'px';
      b.style.top = rc[0] * size + 'px';
      b.style.width = b.style.height = size - gap + 'px';
      wrap.appendChild(b);
    });
    return wrap;
  }

  function renderHud() {
    animateScore(game.score);
    var bestKey = BBC.bestKey(game);
    var best = Math.max(BBC.getBest(bestKey), game.score);
    $('#best').textContent = best.toLocaleString();
    var combo = $('#combo');
    if (game.combo >= 2) {
      combo.textContent = 'Combo ×' + game.combo;
      combo.classList.add('show');
    } else {
      combo.classList.remove('show');
    }
    $('#seed-text').textContent = BBC.seedToText(game.seed);
    $('#chip-label').textContent = smartDealing() ? 'Smart dealer' : 'Fair dealing';
    var modCount = game.modIds.length;
    $('#mods-badge').textContent = modCount ? modCount : '';
    $('#mods-badge').style.display = modCount ? '' : 'none';
  }

  function animateScore(target) {
    var scoreEl = $('#score');
    if (scoreAnim) cancelAnimationFrame(scoreAnim);
    var from = shownScore;
    if (from === target) {
      scoreEl.textContent = target.toLocaleString();
      return;
    }
    var t0 = performance.now();
    var dur = Math.min(280, 80 + Math.abs(target - from));
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      shownScore = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      scoreEl.textContent = shownScore.toLocaleString();
      if (k < 1) scoreAnim = requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- geometry ---------- */

  function cellPitch() {
    if (cellEls.length < 2) return 40;
    var a = cellEls[0].getBoundingClientRect();
    var b = cellEls[1].getBoundingClientRect();
    return b.left - a.left || a.width;
  }

  function gridOrigin() {
    return cellEls[0].getBoundingClientRect();
  }

  /* ---------- drag & drop ---------- */

  /**
   * Big pick-up zones: anywhere below the board counts. The touch is matched
   * to the column (left / middle / right) it lands in; if that slot is
   * already used, the nearest piece still in the tray is picked instead.
   */
  function onPickDown(e) {
    if (!game || game.over || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, a, input, select, textarea, .sheet, .over, #seed-chip')) return;
    var bb = boardEl.getBoundingClientRect();
    if (e.clientY < bb.bottom + 2) return;
    var tr = trayEl.getBoundingClientRect();
    var n = game.hand.length;
    var col = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - tr.left) / tr.width) * n)));
    var slot = -1, bestD = Infinity;
    for (var i = 0; i < n; i++) {
      if (game.hand[i] && Math.abs(i - col) < bestD) { slot = i; bestD = Math.abs(i - col); }
    }
    if (slot < 0) return;
    startDrag(e, slot);
  }

  function startDrag(e, slot) {
    var slotEl = trayEl.querySelector('.slot[data-slot="' + slot + '"]');
    var p = game.hand[slot];
    if (!p || !slotEl) return;
    e.preventDefault();
    var pitch = cellPitch();
    var cellSize = gridOrigin().width;
    var gap = pitch - cellSize;
    var ghost = pieceEl(p, pitch, gap);
    ghost.classList.add('ghost');
    document.body.appendChild(ghost);
    var touch = e.pointerType !== 'mouse';
    drag = {
      slot: slot,
      piece: p,
      ghost: ghost,
      id: e.pointerId,
      w: p.w * pitch - gap,
      h: p.h * pitch - gap,
      lift: touch ? pitch * 1.4 : 0,
      pitch: pitch,
      sx: e.clientX,
      sy: e.clientY,
      speed: touch ? +BBC.settings.dragSpeed || 1 : 1,
      target: null,
      fromRect: slotEl.querySelector('.piece').getBoundingClientRect()
    };
    slotEl.classList.add('dragging');
    BBC.sfx.pick();
    // Grow from tray size to board size as it lifts off.
    var k = drag.fromRect.width / drag.w;
    ghost.style.scale = k;
    positionGhost(e.clientX, e.clientY);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ghost.classList.add('lifted');
        ghost.style.scale = 1;
      });
    });
  }

  function positionGhost(x, y) {
    // Drag speed: the piece travels further than your finger (touch only).
    x = drag.sx + (x - drag.sx) * drag.speed;
    y = drag.sy + (y - drag.sy) * drag.speed;
    var left = x - drag.w / 2;
    var top = drag.lift ? y - drag.h - drag.lift : y - drag.h / 2;
    drag.ghost.style.transform = 'translate(' + left + 'px,' + top + 'px)';
    var o = gridOrigin();
    var target = snapTarget((top - o.top) / drag.pitch, (left - o.left) / drag.pitch);
    if (!sameTarget(target, drag.target)) {
      drag.target = target;
      showPreview(target);
    }
  }

  /** Nearest spot the piece fits, within ~0.8 of a cell, so quick drops still land. */
  function snapTarget(fr, fc) {
    var r0 = Math.round(fr), c0 = Math.round(fc);
    if (game.canPlace(drag.piece, r0, c0)) return { r: r0, c: c0 };
    var best = null, bestD = 0.8 * 0.8;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var r = r0 + dr, c = c0 + dc;
        var d = (r - fr) * (r - fr) + (c - fc) * (c - fc);
        if (d < bestD && game.canPlace(drag.piece, r, c)) { best = { r: r, c: c }; bestD = d; }
      }
    }
    return best;
  }

  function sameTarget(a, b) {
    return (!a && !b) || (a && b && a.r === b.r && a.c === b.c);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    positionGhost(e.clientX, e.clientY);
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    if (d.target) {
      d.ghost.remove();
      drag = null;
      doPlace(d.slot, d.target.r, d.target.c);
    } else {
      cancelDrag();
    }
  }

  function onCancel(e) {
    if (drag && e.pointerId === drag.id) cancelDrag();
  }

  function cancelDrag() {
    var d = drag;
    drag = null;
    showPreview(null);
    var to = d.fromRect;
    var k = to.width / d.w;
    d.ghost.classList.add('returning');
    d.ghost.style.scale = k;
    d.ghost.style.transform = 'translate(' + (to.left - (d.w / 2) * (1 - k)) + 'px,' + (to.top - d.h * (1 - k)) + 'px)';
    setTimeout(function () {
      d.ghost.remove();
      renderTray();
    }, 120);
    BBC.sfx.drop();
  }

  function showPreview(target) {
    preview.cells.forEach(function (i) {
      cellEls[i].classList.remove('preview');
      if (!game.board[i]) cellEls[i].style.setProperty('--c', 'transparent');
    });
    preview.lines.forEach(function (i) {
      cellEls[i].classList.remove('will-clear');
    });
    preview = { cells: [], lines: [] };
    if (!target || !drag) return;
    var p = drag.piece;
    var color = 'var(--p' + p.color + ')';
    p.cells.forEach(function (rc) {
      var i = game.idx(target.r + rc[0], target.c + rc[1]);
      cellEls[i].classList.add('preview');
      cellEls[i].style.setProperty('--c', color);
      preview.cells.push(i);
    });
    var lines = game.previewClear(p, target.r, target.c);
    var mark = function (i) {
      cellEls[i].classList.add('will-clear');
      cellEls[i].style.setProperty('--wc', color);
      preview.lines.push(i);
    };
    lines.rows.forEach(function (r) { for (var c = 0; c < game.cols; c++) mark(game.idx(r, c)); });
    lines.cols.forEach(function (c) { for (var r = 0; r < game.rows; r++) mark(game.idx(r, c)); });
  }

  /* ---------- placing ---------- */

  function doPlace(slot, r, c) {
    var res = game.place(slot, r, c);
    if (!res) {
      UI.renderAll();
      return;
    }
    vibrate(res.lines ? [12, 30, 18] : 10);
    if (res.cleared.length) {
      burst(res.cleared);
      BBC.sfx.clear(res.lines, res.combo);
    } else {
      BBC.sfx.place();
    }
    UI.renderAll();
    landBounce(res.cells);
    floatPoints(res);
    if (res.lines) praise(res);
    if (res.newHand) dealAnim(res.cleared.length ? 90 : 0);
    BBC.saveGame();
    BBC.updateBest(game);
    if (game.over) {
      var t = greyOut();
      setTimeout(showOver, t + 250);
    }
  }

  function landBounce(cells) {
    cells.forEach(function (rc) {
      var e = cellEls[game.idx(rc[0], rc[1])];
      if (!e || !game.board[game.idx(rc[0], rc[1])]) return;
      e.classList.add('land');
      setTimeout(function () { e.classList.remove('land'); }, 140);
    });
  }

  function burst(cleared) {
    var layer = $('#fx');
    var o = gridOrigin();
    var pitch = cellPitch();
    var size = o.width;
    cleared.forEach(function (x, n) {
      var b = el('div', 'cell filled pop kind-' + x.cell.kind);
      b.style.setProperty('--c', 'var(--p' + x.cell.color + ')');
      b.style.width = b.style.height = size + 'px';
      b.style.left = o.left + x.c * pitch + 'px';
      b.style.top = o.top + x.r * pitch + 'px';
      b.style.animationDelay = (n % 8) * 8 + 'ms';
      layer.appendChild(b);
      setTimeout(function () { b.remove(); }, 380);
    });
  }

  function floatPoints(res) {
    if (!res.points) return;
    var o = gridOrigin();
    var pitch = cellPitch();
    var rs = 0, cs = 0;
    res.cells.forEach(function (rc) { rs += rc[0]; cs += rc[1]; });
    var x = o.left + (cs / res.cells.length + 0.5) * pitch;
    var y = o.top + (rs / res.cells.length + 0.5) * pitch;
    var f = el('div', 'float' + (res.lines ? ' big' : ''));
    f.textContent = '+' + res.points;
    if (res.lines >= 2) {
      var sub = el('small', null, res.perfect ? 'Board cleared!' : res.lines + ' lines');
      f.appendChild(sub);
    } else if (res.perfect) {
      f.appendChild(el('small', null, 'Board cleared!'));
    }
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    $('#fx').appendChild(f);
    setTimeout(function () { f.remove(); }, 720);
  }

  var PRAISE = ['', '', 'Good!', 'Great!', 'Excellent!', 'Amazing!', 'Unbelievable!'];

  /** Big centered callout for multi-line clears and combos. */
  function praise(res) {
    var text = res.perfect ? 'Board clear!' : PRAISE[Math.min(res.lines, PRAISE.length - 1)];
    var combo = res.combo >= 2 ? 'Combo ' + res.combo : '';
    if (!text && !combo) return;
    var bb = boardEl.getBoundingClientRect();
    var p = el('div', 'praise');
    if (text) p.appendChild(el('div', 'praise-main', text));
    if (combo) p.appendChild(el('div', 'praise-combo', combo));
    p.style.left = bb.left + bb.width / 2 + 'px';
    p.style.top = bb.top + bb.height * 0.42 + 'px';
    $('#fx').appendChild(p);
    setTimeout(function () { p.remove(); }, 900);
  }

  /** Game over: blocks turn grey from the bottom row up. Returns duration in ms. */
  function greyOut() {
    var step = 35;
    for (var r = game.rows - 1; r >= 0; r--) {
      (function (row, delay) {
        setTimeout(function () {
          for (var c = 0; c < game.cols; c++) {
            if (game.board[game.idx(row, c)]) cellEls[game.idx(row, c)].classList.add('dead');
          }
        }, delay);
      })(r, (game.rows - 1 - r) * step);
    }
    return game.rows * step;
  }

  function vibrate(p) {
    if (!BBC.settings.haptics) return;
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ }
  }

  /* ---------- game over ---------- */

  function showOver() {
    if (!game || !game.over) return;
    BBC.sfx.over();
    var best = BBC.getBest(BBC.bestKey(game));
    $('#over-score').textContent = game.score.toLocaleString();
    $('#over-best').textContent = best.toLocaleString();
    $('#over-new-best').style.display = game.score > 0 && game.score >= best ? '' : 'none';
    $('#over-stats').textContent =
      game.moves + ' moves · ' + game.lines + ' lines · seed ' + BBC.seedToText(game.seed);
    $('#over').classList.add('show');
  }

  function hideOver() {
    $('#over').classList.remove('show');
  }

  function smartDealing() {
    return (BBC.mods._filters.dealHand || []).length > 0;
  }

  /** Big centered title, e.g. when a new biome starts. */
  UI.banner = function (text) {
    var bb = boardEl.getBoundingClientRect();
    var p = el('div', 'praise banner');
    p.appendChild(el('div', 'praise-main', text));
    p.style.left = bb.left + bb.width / 2 + 'px';
    p.style.top = bb.top - 34 + 'px';
    $('#fx').appendChild(p);
    setTimeout(function () { p.remove(); }, 1400);
  };

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
    return false;
  };

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
    [['1', '1× (follows finger)'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['1.75', '1.75×'], ['2', '2×']].forEach(function (o) {
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
