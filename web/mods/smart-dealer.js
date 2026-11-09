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

  function normalShapes(g) {
    return g.catalog.filter(function (s) { return (s.kind || 'normal') === 'normal'; });
  }

  function boardBits(g) {
    var b = new Uint8Array(g.rows * g.cols);
    for (var i = 0; i < b.length; i++) b[i] = g.board[i] ? 1 : 0;
    return b;
  }

  /** Shapes that can clear at least one line right now, best first. */
  function clearers(g, opts) {
    var R = g.rows, C = g.cols, b = boardBits(g), out = [];
    normalShapes(g).forEach(function (sh) {
      var best = null;
      for (var r = 0; r <= R - sh.h; r++) {
        for (var c = 0; c <= C - sh.w; c++) {
          if (!fits(b, C, sh, r, c)) continue;
          var res = place(b, R, C, sh, r, c);
          if (!res.lines) continue;
          var v = moveValue(res, sh, R, C, opts);
          if (best === null || v > best) best = v;
        }
      }
      if (best !== null) out.push({ shape: sh, value: best });
    });
    out.sort(function (a, b2) { return b2.value - a.value; });
    return out;
  }

  /** Can this piece clear a line somewhere on the current board? */
  function canClear(g, piece) {
    var R = g.rows, C = g.cols, b = boardBits(g);
    for (var r = 0; r <= R - piece.h; r++) {
      for (var c = 0; c <= C - piece.w; c++) {
        if (fits(b, C, piece, r, c) && place(b, R, C, piece, r, c).lines) return true;
      }
    }
    return false;
  }

  function plan(g, rng, opts, steps, firstShapes) {
    var R = g.rows, C = g.cols;
    var shapes = normalShapes(g);
    var start = boardBits(g);

    var beam = [{ b: start, picks: [], score: 0 }];
    var width = 8;
    var scratch = new Uint8Array(R * C);
    var recent = opts.recent || {};

    var shortlist = null;
    for (var step = 0; step < (steps || g.handSize); step++) {
      var next = [];
      var pool = step === 0 ? (firstShapes || shapes) : shortlist || shapes;
      for (var pass = 0; pass < 2 && !next.length; pass++) {
      for (var k = 0; k < beam.length; k++) {
        var st = beam[k];
        for (var s = 0; s < pool.length; s++) {
          var sh = pool[s];
          // No repeated shape in one hand, unless nothing else fits (2nd pass).
          if (pass === 0 && hasFamily(st.picks, sh)) continue;
          var best = null;
          for (var r = 0; r <= R - sh.h; r++) {
            for (var c = 0; c <= C - sh.w; c++) {
              if (!fits(st.b, C, sh, r, c)) continue;
              var res = place(st.b, R, C, sh, r, c, scratch);
              var v = st.score + moveValue(res, sh, R, C, opts);
              if (!best || v > best.score) best = { b: res.b.slice(), picks: st.picks.concat([sh]), score: v };
            }
          }
          if (best) next.push(best);
        }
      }
      if (!next.length && pool !== shapes) pool = shapes; // shortlist exhausted: widen
      }
      if (!next.length) break;
      if (step === 0 && !shortlist) {
        // Later steps only look at the 28 most promising shapes (plus a few random ones): ~2x faster.
        var ranked = next.slice().sort(function (a, b2) { return b2.score - a.score; });
        shortlist = ranked.slice(0, 28).map(function (x) { return x.picks[0]; });
        for (var extra = 0; extra < 4; extra++) shortlist.push(shapes[rng.int(shapes.length)]);
      }
      var noise = opts.chaos;
      for (var n = 0; n < next.length; n++) {
        // Variety: same shape family twice in a hand, or shapes from the last
        // couple of hands, cost points, so you see a wider mix.
        var dupes = 0;
        var last = next[n].picks[next[n].picks.length - 1];
        var fam = family(last.id);
        for (var q = 0; q < next[n].picks.length - 1; q++) if (family(next[n].picks[q].id) === fam) dupes++;
        next[n].rank = next[n].score - dupes * 400 - (recent[fam] || 0) * 90 + (rng.next() - 0.5) * noise;
      }
      next.sort(function (a, b) { return b.rank - a.rank; });
      beam = next.slice(0, width);
    }
    if (!beam[0] || !beam[0].picks.length) return null;
    var want = steps || g.handSize;
    var full = beam.filter(function (x) { return x.picks.length === want; });
    var distinct = full.filter(function (x) { return noRepeats(x.picks); });
    // Best: no repeated shape AND works in any order. Then any-order. Then no repeats.
    var i;
    for (i = 0; i < distinct.length; i++) {
      if (anyOrderWorks(start, R, C, distinct[i].picks, opts)) return distinct[i].picks;
    }
    for (i = 0; i < Math.min(2, full.length); i++) {
      if (anyOrderWorks(start, R, C, full[i].picks, opts)) return full[i].picks;
    }
    return (distinct[0] || beam[0]).picks;
  }

  /** Every placement order fits if each piece goes on its best spot at that moment. */
  function anyOrderWorks(start, R, C, picks, opts) {
    var orders = permutations(picks.length);
    for (var o = 0; o < orders.length; o++) {
      var b = start;
      for (var i = 0; i < orders[o].length; i++) {
        var sh = picks[orders[o][i]];
        var best = null, bestV = -Infinity;
        for (var r = 0; r <= R - sh.h; r++) {
          for (var c = 0; c <= C - sh.w; c++) {
            if (!fits(b, C, sh, r, c)) continue;
            var res = place(b, R, C, sh, r, c);
            var v = moveValue(res, sh, R, C, opts);
            if (v > bestV) { bestV = v; best = res.b; }
          }
        }
        if (!best) return false;
        b = best;
      }
    }
    return true;
  }

  function permutations(n) {
    if (n <= 1) return [[0]];
    var out = [];
    (function rec(cur, used) {
      if (cur.length === n) { out.push(cur.slice()); return; }
      for (var i = 0; i < n; i++) if (!used[i]) { used[i] = true; cur.push(i); rec(cur, used); cur.pop(); used[i] = false; }
    })([], {});
    return out;
  }

  function hasFamily(picks, sh) {
    var f = family(sh.id);
    for (var i = 0; i < picks.length; i++) if (family(picks[i].id) === f) return true;
    return false;
  }

  function noRepeats(picks) {
    var seen = {};
    for (var i = 0; i < picks.length; i++) {
      var f = family(picks[i].id);
      if (seen[f]) return false;
      seen[f] = true;
    }
    return true;
  }

  function family(id) {
    var i = id.lastIndexOf('_');
    return i > 0 ? id.slice(0, i) : id;
  }

  function fits(b, C, sh, r, c) {
    for (var i = 0; i < sh.cells.length; i++) {
      if (b[(r + sh.cells[i][0]) * C + c + sh.cells[i][1]]) return false;
    }
    return true;
  }

  function place(src, R, C, sh, r, c, into) {
    var b = into || new Uint8Array(src.length);
    b.set(src);
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
    description: 'Looks at your board and deals the hand that helps most: big pieces that fit in any order, always at least one piece that clears a line, and plans for full-board clears. Your hand never changes once dealt. Turn it off for pure random dealing.',
    type: 'gameplay',
    defaultEnabled: true,
    conflicts: ['gentle-dealer'],
    settings: [
      { key: 'big', label: 'Big piece preference', type: 'select', default: 'high',
        options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'max', label: 'Max' }] },
      { key: 'chaos', label: 'Variety (0–100)', type: 'number', min: 0, max: 100, default: 25 },
      { key: 'winning', label: 'Always a line-clearing piece', type: 'boolean', default: true },
      { key: 'rescue', label: 'Swap pieces when stuck (changes your hand)', type: 'boolean', default: false }
    ],
    setup: function (api) {
      // Shape families from the last couple of hands (fades out over time).
      var recent = {};
      function remember(picks) {
        Object.keys(recent).forEach(function (k) { recent[k] *= 0.5; if (recent[k] < 0.2) delete recent[k]; });
        picks.forEach(function (sh) { var f = family(sh.id); recent[f] = (recent[f] || 0) + 1; });
      }

      api.filter('dealHand', function (hand, ctx) {
        var g = ctx.game;
        var opts = { big: api.setting('big'), chaos: api.setting('chaos') * 4 };
        opts.recent = recent;
        var picks = plan(g, ctx.rng, opts);
        if (!picks) return hand; // nothing fits at all → normal deal (game over)
        // Make sure the hand holds a piece that clears a line right away.
        if (api.setting('winning')) {
          var cl = clearers(g, opts);
          var ids = {};
          cl.forEach(function (x) { ids[x.shape.id] = true; });
          if (cl.length && !picks.some(function (sh) { return ids[sh.id]; })) {
            var forced = plan(g, ctx.rng, opts, g.handSize, cl.slice(0, 8).map(function (x) { return x.shape; }));
            if (forced) picks = forced;
          }
        }
        remember(picks);
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
        slots.forEach(function (slot, i) {
          g.hand[slot] = picks[i] ? g.makePiece(picks[i]) : null;
          if (g.hand[slot]) g.hand[slot].swapped = true;
        });
        api.ui.banner('Fresh pieces!');
        return false;
      }, 5);
    }
  });
})();
