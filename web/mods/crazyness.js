/* Crazyness — the second game mode.
 *
 * Every new hand tries to be three "crazy blocks": shapes that exist nowhere
 * in the shape list. They are grown on the spot from the free space on your
 * board, as big as the size cap allows.
 *
 * Rules of a crazy block
 *  1. Its little blocks all touch each other: side by side, above/below or
 *     diagonally. No loose parts.
 *  2. Size is 1 up to (board − 1) blocks. The "Biggest crazy block" setting
 *     caps it lower (default 20) so one piece can't wipe the board every move.
 *  3. It is built from what fits right now, and a new hand is planned up to
 *     two steps ahead: block 1 is grown on the current board, block 2 on the
 *     board after block 1 has landed (lines cleared), block 3 after block 2.
 *     So every hand can be played, at least in the planned order. On top of
 *     that the hand is test-played in other orders and spots; if it is too
 *     easy to get stuck, the blocks are grown a size smaller. Without this,
 *     three maximum-size blocks usually fit in one exact order only and a
 *     simulated player lasts roughly 10 moves instead of roughly 80.
 *  4. It must not look like a regular shape (or like another crazy block of
 *     the same hand). "Look like" = the two shapes overlap by 70% or more in
 *     some position, rotation or mirror image.
 *
 * When no crazy block is possible for a slot (the free space is so small that
 * anything fitting would be a regular shape), that slot gets the best regular
 * shape instead, so the mode still holds every block of the classic mode.
 */
(function () {
  'use strict';

  var SIMILAR = 0.7;    // overlap ratio from which two shapes "look alike"
  var TRIES = 24;       // crazy blocks grown per planning step
  var BEAM = 3;         // boards kept per planning step
  var BRANCH = 3;       // crazy blocks tried per kept board
  var NB = [-1, -1, -1, 0, -1, 1, 0, -1, 0, 1, 1, -1, 1, 0, 1, 1]; // 8 neighbours (dr, dc)

  /* ---------- board helpers (Uint8Array, 1 = filled) ---------- */

  function boardBits(g) {
    var b = new Uint8Array(g.rows * g.cols);
    for (var i = 0; i < b.length; i++) b[i] = g.board[i] ? 1 : 0;
    return b;
  }

  /** Fill the given cells, clear full lines. Returns the new board + stats. */
  function drop(src, R, C, idxs) {
    var b = new Uint8Array(src);
    var i, x, y, full, lines = 0;
    for (i = 0; i < idxs.length; i++) b[idxs[i]] = 1;
    var rows = [], cols = [];
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
    for (i = 0; i < rows.length; i++) for (x = 0; x < C; x++) b[rows[i] * C + x] = 0;
    for (i = 0; i < cols.length; i++) for (y = 0; y < R; y++) b[y * C + cols[i]] = 0;
    lines = rows.length + cols.length;
    var filled = 0;
    for (i = 0; i < b.length; i++) filled += b[i];
    return { b: b, lines: lines, filled: filled };
  }

  /** Label the free space into 8-connected regions. */
  function regions(b, R, C) {
    var id = new Int16Array(R * C).fill(-1);
    var sizes = [], stack = [];
    for (var s = 0; s < b.length; s++) {
      if (b[s] || id[s] >= 0) continue;
      var n = sizes.length, count = 0;
      id[s] = n;
      stack.push(s);
      while (stack.length) {
        var i = stack.pop();
        count++;
        var r = (i / C) | 0, c = i % C;
        for (var k = 0; k < 16; k += 2) {
          var rr = r + NB[k], cc = c + NB[k + 1];
          if (rr < 0 || cc < 0 || rr >= R || cc >= C) continue;
          var j = rr * C + cc;
          if (!b[j] && id[j] < 0) { id[j] = n; stack.push(j); }
        }
      }
      sizes.push(count);
    }
    return { id: id, sizes: sizes };
  }

  /** Higher = more open, cleaner board. */
  function quality(b, R, C) {
    var v = 0, filled = 0, holes = 0, rough = 0, x, y, i;
    for (y = 0; y < R; y++) {
      for (x = 0; x < C; x++) {
        i = y * C + x;
        if (b[i]) { filled++; continue; }
        var up = y === 0 || b[i - C], dn = y === R - 1 || b[i + C];
        var lf = x === 0 || b[i - 1], rt = x === C - 1 || b[i + 1];
        if (up && dn && lf && rt) holes++;
        if (x > 0 && b[i - 1]) rough++;
        if (y > 0 && b[i - C]) rough++;
      }
    }
    v -= filled * 5 + holes * 22 + rough * 1.5;
    return v;
  }

  function moveScore(res, size, R, C) {
    var L = res.lines;
    var v = size * 16;
    if (L) v += L * 110 + (L - 1) * L * 40;
    if (L && res.filled === 0) v += 250;
    return v + quality(res.b, R, C);
  }

  /* ---------- growing a crazy block ---------- */

  /**
   * Grow a connected set of free cells, up to `target` cells.
   * style 'lines' : tries to finish rows and columns (so the block clears lines)
   * style 'wild'  : loves diagonal links and odd outlines
   * style 'blob'  : compact lumps
   */
  function grow(b, R, C, seed, target, rng, style) {
    var N = R * C;
    var inSet = new Uint8Array(N), inFront = new Uint8Array(N);
    var rowNeed = new Int16Array(R), colNeed = new Int16Array(C);
    var i, r, c, k;
    for (i = 0; i < N; i++) if (!b[i]) { rowNeed[(i / C) | 0]++; colNeed[i % C]++; }
    var cells = [], front = [];

    function add(idx) {
      inSet[idx] = 1;
      cells.push(idx);
      var r0 = (idx / C) | 0, c0 = idx % C;
      rowNeed[r0]--;
      colNeed[c0]--;
      for (var q = 0; q < 16; q += 2) {
        var rr = r0 + NB[q], cc = c0 + NB[q + 1];
        if (rr < 0 || cc < 0 || rr >= R || cc >= C) continue;
        var j = rr * C + cc;
        if (!b[j] && !inSet[j] && !inFront[j]) { inFront[j] = 1; front.push(j); }
      }
    }

    add(seed);
    while (cells.length < target) {
      var left = target - cells.length;
      var best = -1, bestW = -Infinity, bestAt = -1;
      for (k = 0; k < front.length; k++) {
        i = front[k];
        if (inSet[i]) continue;
        r = (i / C) | 0;
        c = i % C;
        // How close this cell brings a row / column to being full (only if we can afford to finish it).
        var line = (rowNeed[r] <= left ? 1 / rowNeed[r] : 0) + (colNeed[c] <= left ? 1 / colNeed[c] : 0);
        var side = 0, diag = 0;
        if (r > 0 && inSet[i - C]) side++;
        if (r < R - 1 && inSet[i + C]) side++;
        if (c > 0 && inSet[i - 1]) side++;
        if (c < C - 1 && inSet[i + 1]) side++;
        if (r > 0 && c > 0 && inSet[i - C - 1]) diag++;
        if (r > 0 && c < C - 1 && inSet[i - C + 1]) diag++;
        if (r < R - 1 && c > 0 && inSet[i + C - 1]) diag++;
        if (r < R - 1 && c < C - 1 && inSet[i + C + 1]) diag++;
        var w;
        if (style === 'lines') w = line * 6 + side * 0.35 + rng.next() * 0.7;
        else if (style === 'wild') w = line * 2.5 + (side === 0 ? 1.6 : 0) + diag * 0.3 + rng.next() * 2.4;
        else w = line * 1.5 + side * 0.9 + diag * 0.3 + rng.next() * 1.2;
        if (w > bestW) { bestW = w; best = i; bestAt = k; }
      }
      if (best < 0) break;
      front[bestAt] = front[front.length - 1];
      front.pop();
      add(best);
    }
    return cells;
  }

  function isSolidRect(idxs, C) {
    var minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
    for (var i = 0; i < idxs.length; i++) {
      var r = (idxs[i] / C) | 0, c = idxs[i] % C;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    return idxs.length > 1 && (maxR - minR + 1) * (maxC - minC + 1) === idxs.length;
  }

  /** Board cells → a piece shape (cells relative to its top-left corner). */
  function toShape(idxs, C) {
    var minR = Infinity, minC = Infinity, maxR = -1, maxC = -1, i, r, c;
    for (i = 0; i < idxs.length; i++) {
      r = (idxs[i] / C) | 0;
      c = idxs[i] % C;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    var cells = idxs.map(function (x) { return [((x / C) | 0) - minR, (x % C) - minC]; });
    cells.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return { cells: cells, w: maxC - minC + 1, h: maxR - minR + 1 };
  }

  /* ---------- "does it look like …" ---------- */

  function keyOf(cells) {
    return cells.map(function (rc) { return rc[0] + ',' + rc[1]; }).join(';');
  }

  var POP = new Uint8Array(65536);
  (function () { for (var i = 1; i < 65536; i++) POP[i] = POP[i >> 1] + (i & 1); })();

  /** One bitmask per row (bit c = block in column c). Boards are at most 16 wide. */
  function rowMasks(cells, h) {
    var rows = new Uint16Array(h);
    for (var i = 0; i < cells.length; i++) rows[cells[i][0]] |= 1 << cells[i][1];
    return rows;
  }

  /** The 8 rotations / mirror images of a shape, duplicates removed. */
  function variants(cells) {
    var out = [], seen = {};
    for (var t = 0; t < 8; t++) {
      var pts = cells.map(function (rc) {
        var r = rc[0], c = rc[1], x;
        if (t & 4) c = -c;
        for (var q = 0; q < (t & 3); q++) { x = r; r = c; c = -x; }
        return [r, c];
      });
      var minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
      pts.forEach(function (p) {
        if (p[0] < minR) minR = p[0];
        if (p[1] < minC) minC = p[1];
        if (p[0] > maxR) maxR = p[0];
        if (p[1] > maxC) maxC = p[1];
      });
      pts = pts.map(function (p) { return [p[0] - minR, p[1] - minC]; });
      pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      var k = keyOf(pts);
      if (seen[k]) continue;
      seen[k] = true;
      var h = maxR - minR + 1;
      out.push({ cells: pts, w: maxC - minC + 1, h: h, n: pts.length, rows: rowMasks(pts, h) });
    }
    return out;
  }

  /** Does `shape` overlap any of the reference variants by SIMILAR or more? */
  function looksLike(shape, refs) {
    var n = shape.cells.length, w = shape.w, h = shape.h;
    var mine = null;
    for (var v = 0; v < refs.length; v++) {
      var ref = refs[v];
      var lo = Math.min(n, ref.n), hi = Math.max(n, ref.n);
      if (lo / hi < SIMILAR) continue; // sizes too far apart to overlap that much
      if (!mine) mine = rowMasks(shape.cells, h);
      var need = Math.ceil((SIMILAR * (n + ref.n)) / (1 + SIMILAR) - 1e-9); // shared blocks needed
      var rr = ref.rows;
      for (var dr = -(ref.h - 1); dr < h; dr++) {
        var r0 = Math.max(0, dr), r1 = Math.min(h, dr + ref.h);
        for (var dc = -(ref.w - 1); dc < w; dc++) {
          var inter = 0, r;
          if (dc >= 0) for (r = r0; r < r1; r++) inter += POP[mine[r] & ((rr[r - dr] << dc) & 0xffff)];
          else for (r = r0; r < r1; r++) inter += POP[mine[r] & (rr[r - dr] >> -dc)];
          if (inter >= need) return true;
        }
      }
    }
    return false;
  }

  /** Every regular shape in play, in all orientations (built once per game). */
  function regularRefs(g) {
    if (g._crazyRefs) return g._crazyRefs;
    var out = [], seen = {};
    g.catalog.forEach(function (s) {
      variants(s.cells).forEach(function (v) {
        var k = keyOf(v.cells);
        if (!seen[k]) { seen[k] = true; out.push(v); }
      });
    });
    Object.defineProperty(g, '_crazyRefs', { value: out, enumerable: false });
    return out;
  }

  /* ---------- planning a hand ---------- */

  /** Crazy block candidates for one board, best first. */
  function candidates(b, R, C, cap, rng) {
    var reg = regions(b, R, C);
    if (!reg.sizes.length) return [];
    var N = R * C, i;
    var free = [];
    for (i = 0; i < N; i++) if (!b[i]) free.push(i);
    var biggest = 0;
    for (i = 1; i < reg.sizes.length; i++) if (reg.sizes[i] > reg.sizes[biggest]) biggest = i;
    var inBiggest = free.filter(function (x) { return reg.id[x] === biggest; });

    var out = [], seen = {};
    for (var t = 0; t < TRIES; t++) {
      // Most tries start in the biggest free region, so the block can be as big as possible.
      var pool = t % 5 === 4 ? free : inBiggest;
      var seed = pool[rng.int(pool.length)];
      var room = Math.min(cap, reg.sizes[reg.id[seed]]);
      // "As big as it can": two thirds of the tries go for the full size.
      var target = t % 3 === 2 ? Math.max(1, Math.round(room * (0.6 + rng.next() * 0.4))) : room;
      var style = t % 3 === 0 ? 'lines' : t % 3 === 1 ? 'wild' : (t % 2 ? 'lines' : 'blob');
      var idxs = grow(b, R, C, seed, target, rng, style);
      idxs.sort(function (a, c2) { return a - c2; });
      var k = idxs.join(',');
      if (seen[k]) continue;
      seen[k] = true;
      var res = drop(b, R, C, idxs);
      var score = moveScore(res, idxs.length, R, C) + rng.next() * 6;
      if (isSolidRect(idxs, C)) score -= 80; // a plain rectangle is not very crazy
      out.push({ idxs: idxs, res: res, score: score });
    }
    out.sort(function (a, c3) { return c3.score - a.score; });
    return out;
  }

  /** Best regular shape for a board (used when no crazy block is possible). */
  function bestRegular(g, b, R, C, rng) {
    var best = null;
    for (var s = 0; s < g.catalog.length; s++) {
      var sh = g.catalog[s];
      if ((sh.kind || 'normal') !== 'normal') continue;
      for (var r = 0; r <= R - sh.h; r++) {
        for (var c = 0; c <= C - sh.w; c++) {
          var ok = true, idxs = [];
          for (var i = 0; i < sh.cells.length && ok; i++) {
            var j = (r + sh.cells[i][0]) * C + c + sh.cells[i][1];
            if (b[j]) ok = false;
            else idxs.push(j);
          }
          if (!ok) continue;
          var res = drop(b, R, C, idxs);
          var v = moveScore(res, idxs.length, R, C) + rng.next() * 6;
          if (!best || v > best.score) best = { shape: sh, res: res, score: v };
        }
      }
    }
    return best;
  }

  /** Plan one hand with a fixed size cap: the best few plans, best first. */
  function planAt(g, start, rng, cap, steps) {
    var R = g.rows, C = g.cols;
    var refs = regularRefs(g);
    var beam = [{ b: start, picks: [], score: 0, mine: [] }];

    for (var step = 0; step < steps; step++) {
      var next = [];
      for (var s = 0; s < beam.length; s++) {
        var st = beam[s];
        var cands = candidates(st.b, R, C, cap, rng);
        var taken = 0;
        for (var i = 0; i < cands.length && taken < BRANCH; i++) {
          var shape = toShape(cands[i].idxs, C);
          // Rule 4: unlike every regular shape, and unlike the hand's other crazy blocks.
          if (looksLike(shape, refs) || looksLike(shape, st.mine)) continue;
          shape.id = 'crazy';
          shape.kind = 'normal';
          shape.crazy = true;
          next.push({
            b: cands[i].res.b,
            picks: st.picks.concat([shape]),
            score: st.score + cands[i].score,
            mine: st.mine.concat(variants(shape.cells))
          });
          taken++;
        }
        if (!taken) {
          // No crazy block possible here: fall back to the best regular shape.
          var reg = bestRegular(g, st.b, R, C, rng);
          if (reg) {
            next.push({
              b: reg.res.b,
              picks: st.picks.concat([reg.shape]),
              score: st.score + reg.score - 600, // crazy hands always win over this
              mine: st.mine
            });
          }
        }
      }
      if (!next.length) break;
      next.sort(function (a, c2) { return c2.score - a.score; });
      beam = next.slice(0, BEAM);
    }
    return beam.filter(function (x) { return x.picks.length > 0; });
  }

  function permutations(n) {
    var out = [];
    (function rec(cur, used) {
      if (cur.length === n) { out.push(cur.slice()); return; }
      for (var i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true;
        cur.push(i);
        rec(cur, used);
        cur.pop();
        used[i] = false;
      }
    })([], {});
    return out;
  }

  /**
   * How forgiving is this hand? Plays it out a number of times the way a
   * person in a hurry might: any order, usually the spot that clears the most
   * lines, sometimes just any spot. Returns the share of playouts that got
   * every piece onto the board.
   */
  function forgiving(start, R, C, picks, rng, rounds) {
    var N = R * C, ok = 0, i, q, r, c, x, y;
    // Blocks per row / column of each piece: tells which lines a spot completes without simulating it.
    var info = picks.map(function (sh) {
      var rc = new Uint8Array(sh.h), cc = new Uint8Array(sh.w);
      for (var k = 0; k < sh.cells.length; k++) { rc[sh.cells[k][0]]++; cc[sh.cells[k][1]]++; }
      return { rc: rc, cc: cc };
    });
    var b = new Uint8Array(N), rowFill = new Uint8Array(R), colFill = new Uint8Array(C);
    var order = picks.map(function (_, k) { return k; });

    var perms = permutations(picks.length);
    for (var n = 0; n < rounds; n++) {
      order = perms[rng.int(perms.length)];
      b.set(start);
      var alive = true;
      var greedy = rng.next() < 0.85;
      for (var k = 0; k < order.length && alive; k++) {
        var sh = picks[order[k]], cells = sh.cells, m = cells.length, inf = info[order[k]];
        rowFill.fill(0);
        colFill.fill(0);
        for (i = 0; i < N; i++) if (b[i]) { rowFill[(i / C) | 0]++; colFill[i % C]++; }
        var bestR = -1, bestC = -1, bestV = -1;
        for (r = 0; r <= R - sh.h; r++) {
          for (c = 0; c <= C - sh.w; c++) {
            var fit = true;
            for (q = 0; q < m && fit; q++) fit = !b[(r + cells[q][0]) * C + c + cells[q][1]];
            if (!fit) continue;
            var v = rng.next();
            if (greedy) {
              var lines = 0;
              for (y = 0; y < sh.h; y++) if (rowFill[r + y] + inf.rc[y] === C) lines++;
              for (x = 0; x < sh.w; x++) if (colFill[c + x] + inf.cc[x] === R) lines++;
              v = lines + v * 0.5;
            }
            if (v > bestV) { bestV = v; bestR = r; bestC = c; }
          }
        }
        if (bestR < 0) { alive = false; break; }
        for (q = 0; q < m; q++) b[(bestR + cells[q][0]) * C + bestC + cells[q][1]] = 1;
        // Clear the lines this spot completed (work them out first, then wipe).
        var fullRows = [], fullCols = [];
        for (y = 0; y < sh.h; y++) if (rowFill[bestR + y] + inf.rc[y] === C) fullRows.push(bestR + y);
        for (x = 0; x < sh.w; x++) if (colFill[bestC + x] + inf.cc[x] === R) fullCols.push(bestC + x);
        for (i = 0; i < fullRows.length; i++) for (x = 0; x < C; x++) b[fullRows[i] * C + x] = 0;
        for (i = 0; i < fullCols.length; i++) for (y = 0; y < R; y++) b[y * C + fullCols[i]] = 0;
      }
      if (alive) ok++;
    }
    return ok / rounds;
  }

  /**
   * Plan a whole hand. Returns a list of shapes (crazy ones carry crazy: true),
   * or null when nothing fits on the board at all.
   *
   * "As big as it can" means: as big as the cap allows while the hand stays
   * playable. Three maximum-size blocks often fit in one exact order and spot
   * only, and one slip would end the game. So the plan starts at the cap and
   * steps the size down until the hand survives most hurried playouts.
   */
  var SIZES = [1, 0.8, 0.62, 0.48, 0.36, 0.26];
  // Share of hurried playouts a hand has to survive, per "Hand safety" setting.
  var SAFETY = { big: 0.55, safe: 0.8, max: 0 };

  function plan(g, rng, cap, steps, safety) {
    var R = g.rows, C = g.cols;
    cap = Math.max(1, Math.min(Math.round(cap), R * C - 1));
    var start = boardBits(g);
    var need = SAFETY[safety] == null ? SAFETY.big : SAFETY[safety];
    if (need <= 0) {
      // "Always the biggest": no playability check beyond the planned order.
      var top = planAt(g, start, rng, cap, steps);
      return top.length ? top[0].picks : null;
    }
    // Start two notches above the size that worked for the last hand: quick,
    // and it keeps reaching for bigger blocks.
    var level = Math.max(0, (g._crazyLevel == null ? 0 : g._crazyLevel) - 2);
    var fallback = null, fallbackRate = -1, lastCap = -1;
    for (var s = level; s < SIZES.length; s++) {
      var c = Math.max(2, Math.round(cap * SIZES[s]));
      if (c === lastCap) continue;
      lastCap = c;
      var plans = planAt(g, start, rng, c, steps);
      if (!plans.length) return null;
      // Of the plans at this size, take the one that is hardest to get stuck on.
      var pick = null, pickRate = -1;
      for (var i = 0; i < plans.length; i++) {
        if (plans[i].picks.length < steps) continue;
        var rate = forgiving(start, R, C, plans[i].picks, rng, 16);
        if (rate > pickRate) { pickRate = rate; pick = plans[i].picks; }
      }
      if (pick && pickRate >= need) {
        setLevel(g, s);
        return pick;
      }
      if (pick && pickRate > fallbackRate) { fallbackRate = pickRate; fallback = pick; }
      if (!fallback) fallback = plans[0].picks;
    }
    setLevel(g, SIZES.length - 1);
    return fallback;
  }

  function setLevel(g, level) {
    Object.defineProperty(g, '_crazyLevel', { value: level, enumerable: false, writable: true, configurable: true });
  }

  BBC.mods.register({
    id: 'crazyness',
    name: 'Crazyness',
    version: '1.0.0',
    author: 'BurstBlastCrazyness',
    description: 'Game mode. Hands are made of crazy blocks: one-of-a-kind shapes grown from the free space on your board, as big as the cap allows, planned two steps ahead so the hand always fits. A regular shape only shows up when no crazy block is possible.',
    type: 'gameplay',
    conflicts: ['gentle-dealer'],
    settings: [
      { key: 'cap', label: 'Biggest crazy block (blocks)', type: 'number', min: 4, max: 255, default: 20 },
      { key: 'safety', label: 'Block size vs. safety', type: 'select', default: 'big',
        options: [
          { value: 'big', label: 'Big (default)' },
          { value: 'safe', label: 'Forgiving (smaller blocks, harder to get stuck)' },
          { value: 'max', label: 'Always the biggest (often fits in one order only)' }
        ] },
      { key: 'regrow', label: 'Re-grow blocks when none fits (no game over)', type: 'boolean', default: false }
    ],
    setup: function (api) {
      function cap() { return +api.setting('cap') || 20; }

      // Runs before the other dealers and marks the hand as final.
      api.filter('dealHand', function (hand, ctx) {
        var g = ctx.game;
        var picks = plan(g, ctx.rng, cap(), g.handSize, api.setting('safety'));
        if (!picks) return hand; // board is full: normal deal, game over follows
        var out = picks.map(function (sh) { return g.makePiece(sh); });
        while (out.length < g.handSize) out.push(ctx.draw());
        for (var i = out.length - 1; i > 0; i--) {
          var j = ctx.rng.int(i + 1);
          var t = out[i]; out[i] = out[j]; out[j] = t;
        }
        ctx.final = true;
        return out;
      }, 1);

      // Optional: stuck with blocks left? Grow new ones for the board as it is now.
      api.filter('isGameOver', function (stuck, ctx) {
        if (!stuck || !api.setting('regrow')) return stuck;
        var g = ctx.game;
        var slots = [];
        g.hand.forEach(function (p, i) { if (p) slots.push(i); });
        if (!slots.length) return stuck;
        var picks = plan(g, g.rng, cap(), slots.length, api.setting('safety'));
        if (!picks) return true;
        slots.forEach(function (slot, i) {
          g.hand[slot] = picks[i] ? g.makePiece(picks[i]) : null;
        });
        api.ui.banner('Re-grown!');
        return false;
      }, 4);
    }
  });

  // Exposed for tests and for mods that want to build on it.
  BBC.crazy = { plan: plan, looksLike: looksLike, variants: variants, grow: grow, regions: regions };
})();
