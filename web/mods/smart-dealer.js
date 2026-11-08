/* Smart Dealer — deals the hand that helps you most.
 *
 * How it works (beam search):
 *  1. Take the current board.
 *  2. For every shape, find its best spot on the board and score the result.
 *  3. Keep the best few boards, then repeat for the 2nd and 3rd piece.
 *  4. Deal the 3 shapes from the best plan (in shuffled slot order).
 *
 * So every hand is guaranteed to fit (in at least one order), and the plan
 * favours big pieces, line clears, multi-line clears and full-board clears,
 * while keeping the board open (few holes, room for big shapes).
 */
(function () {
  var SIZE = {
    normal: { per: 6, tiny: 40, three: 0 },
    high: { per: 14, tiny: 140, three: 30 },
    max: { per: 26, tiny: 320, three: 90 }
  };

  function plan(g, rng, opts, steps) {
    var R = g.rows, C = g.cols, N = R * C;
    var shapes = g.catalog.filter(function (s) { return (s.kind || 'normal') === 'normal'; });
    var start = new Uint8Array(N);
    for (var i = 0; i < N; i++) start[i] = g.board[i] ? 1 : 0;

    var beam = [{ b: start, picks: [], score: 0 }];
    var width = 6;

    for (var step = 0; step < (steps || g.handSize); step++) {
      var next = [];
      for (var k = 0; k < beam.length; k++) {
        var st = beam[k];
        for (var s = 0; s < shapes.length; s++) {
          var sh = shapes[s];
          var best = null;
          for (var r = 0; r <= R - sh.h; r++) {
            for (var c = 0; c <= C - sh.w; c++) {
              if (!fits(st.b, C, sh, r, c)) continue;
              var res = place(st.b, R, C, sh, r, c);
              var v = st.score + moveValue(res, sh, R, C, opts);
              if (!best || v > best.score) best = { b: res.b, picks: st.picks.concat([sh]), score: v };
            }
          }
          if (best) next.push(best);
        }
      }
      if (!next.length) break;
      var noise = opts.chaos;
      for (var n = 0; n < next.length; n++) {
        var dupes = 0;
        var last = next[n].picks[next[n].picks.length - 1];
        for (var q = 0; q < next[n].picks.length - 1; q++) if (next[n].picks[q].id === last.id) dupes++;
        next[n].rank = next[n].score - dupes * 60 + (rng.next() - 0.5) * noise;
      }
      next.sort(function (a, b) { return b.rank - a.rank; });
      beam = next.slice(0, width);
    }
    return beam[0] && beam[0].picks.length ? beam[0].picks : null;
  }

  function fits(b, C, sh, r, c) {
    for (var i = 0; i < sh.cells.length; i++) {
      if (b[(r + sh.cells[i][0]) * C + c + sh.cells[i][1]]) return false;
    }
    return true;
  }

  function place(src, R, C, sh, r, c) {
    var b = src.slice();
    for (var i = 0; i < sh.cells.length; i++) b[(r + sh.cells[i][0]) * C + c + sh.cells[i][1]] = 1;
    var rows = [], cols = [], x, y, full;
    for (y = 0; y < R; y++) {
      full = true;
      for (x = 0; x < C && full; x++) full = b[y * C + x] === 1;
      if (full) rows.push(y);
    }
    for (x = 0; x < C; x++) {
      full = true;
      for (y = 0; y < R && full; y++) full = b[y * C + x] === 1;
      if (full) cols.push(x);
    }
    rows.forEach(function (yy) { for (var xx = 0; xx < C; xx++) b[yy * C + xx] = 0; });
    cols.forEach(function (xx) { for (var yy = 0; yy < R; yy++) b[yy * C + xx] = 0; });
    var filled = 0;
    for (var i2 = 0; i2 < b.length; i2++) filled += b[i2];
    return { b: b, lines: rows.length + cols.length, filled: filled };
  }

  function moveValue(res, sh, R, C, opts) {
    var w = SIZE[opts.big] || SIZE.high;
    var cells = sh.cells.length;
    var v = w.per * cells;
    if (cells <= 2) v -= w.tiny;
    else if (cells === 3) v -= w.three;

    var L = res.lines;
    if (L) v += L * 120 + (L - 1) * L * 60;
    if (L && res.filled === 0) v += 3000; // full board clear
    return v + boardQuality(res.b, R, C);
  }

  /** Higher = more open, cleaner board that's close to clearing lines. */
  function boardQuality(b, R, C) {
    var v = 0, filled = 0, holes = 0, rough = 0, x, y, i;
    for (y = 0; y < R; y++) {
      var rowFill = 0;
      for (x = 0; x < C; x++) {
        i = y * C + x;
        if (b[i]) { filled++; rowFill++; continue; }
        var up = y === 0 || b[i - C], dn = y === R - 1 || b[i + C];
        var lf = x === 0 || b[i - 1], rt = x === C - 1 || b[i + 1];
        if (up && dn && lf && rt) holes++;
        if (x > 0 && b[i - 1]) rough++;
        if (y > 0 && b[i - C]) rough++;
      }
      if (rowFill >= C - 2 && rowFill < C) v += 10 * (rowFill - (C - 3));
    }
    for (x = 0; x < C; x++) {
      var colFill = 0;
      for (y = 0; y < R; y++) colFill += b[y * C + x];
      if (colFill >= R - 2 && colFill < R) v += 10 * (colFill - (R - 3));
    }
    v -= filled * 3 + holes * 30 + rough * 1.5;

    // Room for a 3×3 keeps big pieces playable.
    for (y = 0; y <= R - 3; y++) {
      for (x = 0; x <= C - 3; x++) {
        if (!b[y * C + x] && !b[y * C + x + 1] && !b[y * C + x + 2] &&
            !b[(y + 1) * C + x] && !b[(y + 1) * C + x + 1] && !b[(y + 1) * C + x + 2] &&
            !b[(y + 2) * C + x] && !b[(y + 2) * C + x + 1] && !b[(y + 2) * C + x + 2]) {
          return v + 40;
        }
      }
    }
    return v;
  }

  BBC.mods.register({
    id: 'smart-dealer',
    name: 'Smart Dealer',
    version: '1.0.0',
    author: 'BurstBlastCrazyness',
    description: 'Looks at your board and deals the hand that helps most: big pieces that always fit, set up line clears and go for full-board clears. Turn it off for pure random dealing.',
    type: 'gameplay',
    defaultEnabled: true,
    conflicts: ['gentle-dealer'],
    settings: [
      { key: 'big', label: 'Big piece preference', type: 'select', default: 'high',
        options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'max', label: 'Max' }] },
      { key: 'chaos', label: 'Variety (0–100)', type: 'number', min: 0, max: 100, default: 25 },
      { key: 'rescue', label: 'Swap pieces when stuck', type: 'boolean', default: true }
    ],
    setup: function (api) {
      api.filter('dealHand', function (hand, ctx) {
        var g = ctx.game;
        var picks = plan(g, ctx.rng, { big: api.setting('big'), chaos: api.setting('chaos') * 4 });
        if (!picks) return hand; // nothing fits at all → normal deal (game over)
        var out = picks.map(function (sh) { return g.makePiece(sh); });
        while (out.length < g.handSize) out.push(ctx.draw());
        for (var i = out.length - 1; i > 0; i--) {
          var j = ctx.rng.int(i + 1);
          var t = out[i]; out[i] = out[j]; out[j] = t;
        }
        return out;
      });

      // Stuck with pieces left? Swap the leftovers for ones that fit.
      api.filter('isGameOver', function (stuck, ctx) {
        if (!stuck || !api.setting('rescue')) return stuck;
        var g = ctx.game;
        var slots = [];
        g.hand.forEach(function (p, i) { if (p) slots.push(i); });
        if (!slots.length) return stuck;
        var picks = plan(g, g.rng, { big: api.setting('big'), chaos: api.setting('chaos') * 4 }, slots.length);
        if (!picks) return true;
        slots.forEach(function (slot, i) { g.hand[slot] = picks[i] ? g.makePiece(picks[i]) : null; });
        api.ui.banner('Fresh pieces!');
        return false;
      }, 5);
    }
  });
})();
