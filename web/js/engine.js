/* BurstBlastCrazyness — game engine (no DOM in here).
 *
 * Rules
 *  - Board 8x8 (mods can change it), hand of 3 pieces, no rotation.
 *  - Place all 3, then you get 3 new ones.
 *  - Full rows AND full columns clear at the same time.
 *  - Game over when none of the pieces left in your hand fits anywhere.
 *
 * Scoring (the genre's commonly documented formula)
 *  - +1 point per block placed.
 *  - Clearing L lines in one move: (combo + 1) × 10 × L × max(1, L − 1)
 *  - Each move that clears raises combo by 1. Combo drops to 0 after
 *    3 moves in a row that clear nothing.
 *
 * Fair dealing
 *  - Every piece is drawn independently from the shape list with equal
 *    weight (unless a mod changes the weights). The dealer never reads the
 *    board, the score, the combo or how long you have played.
 */
(function (BBC) {
  'use strict';

  var COLORS = 8;
  var COMBO_GRACE = 3;

  function Game(opts) {
    this.rows = opts.rows || 8;
    this.cols = opts.cols || 8;
    this.handSize = opts.handSize || 3;
    this.catalog = opts.catalog;
    this.ruleset = opts.ruleset || [];
    this.modIds = opts.modIds || [];
    this.seed = opts.seed >>> 0;
    this.rng = new BBC.RNG(this.seed);
    this.board = new Array(this.rows * this.cols).fill(null);
    this.hand = [];
    this.score = 0;
    this.combo = 0;
    this.miss = 0;
    this.moves = 0;
    this.lines = 0;
    this.handsDealt = 0;
    this.over = false;
    this.dealPending = false;
    this.uid = 0;
  }

  var G = Game.prototype;

  G.idx = function (r, c) { return r * this.cols + c; };
  G.get = function (r, c) { return this.board[r * this.cols + c]; };
  G.inside = function (r, c) { return r >= 0 && c >= 0 && r < this.rows && c < this.cols; };

  G.canPlace = function (piece, r, c) {
    if (!piece) return false;
    for (var i = 0; i < piece.cells.length; i++) {
      var rr = r + piece.cells[i][0];
      var cc = c + piece.cells[i][1];
      if (!this.inside(rr, cc) || this.board[rr * this.cols + cc]) return false;
    }
    return true;
  };

  G.fitsAnywhere = function (piece) {
    for (var r = 0; r <= this.rows - piece.h; r++) {
      for (var c = 0; c <= this.cols - piece.w; c++) {
        if (this.canPlace(piece, r, c)) return true;
      }
    }
    return false;
  };

  G.makePiece = function (shape) {
    var p = {
      uid: ++this.uid,
      id: shape.id,
      cells: shape.cells,
      w: shape.w,
      h: shape.h,
      kind: shape.kind || 'normal',
      color: this.rng.int(COLORS)
    };
    if (shape.crazy) p.crazy = true;
    return p;
  };

  G.weights = function () {
    return BBC.mods.applyFilter('pieceWeights', this.catalog.map(function () { return 1; }), { game: this });
  };

  /** One fair draw: a random shape from the catalog, by weight. */
  G.drawPiece = function () {
    return this.makePiece(this.rng.weighted(this.catalog, this.weights()));
  };

  G.dealHand = function () {
    var self = this;
    var hand = [];
    for (var i = 0; i < this.handSize; i++) hand.push(this.drawPiece());
    hand = BBC.mods.applyFilter('dealHand', hand, {
      game: this,
      rng: this.rng,
      draw: function () { return self.drawPiece(); }
    });
    this.hand = hand;
    this.dealPending = false;
    this.handsDealt++;
    BBC.mods.emit('handDealt', { game: this, hand: hand });
  };

  G.start = function () {
    this.dealHand();
    BBC.mods.emit('gameStart', { game: this });
    this.checkOver();
  };

  /** Lines that would be full if `extra` cells were filled. */
  G.fullLines = function (extra) {
    var self = this;
    var filled = function (r, c) {
      return !!self.board[r * self.cols + c] || (extra && extra[r * self.cols + c]);
    };
    var rows = [], cols = [], r, c, ok;
    for (r = 0; r < this.rows; r++) {
      ok = true;
      for (c = 0; c < this.cols && ok; c++) ok = filled(r, c);
      if (ok) rows.push(r);
    }
    for (c = 0; c < this.cols; c++) {
      ok = true;
      for (r = 0; r < this.rows && ok; r++) ok = filled(r, c);
      if (ok) cols.push(c);
    }
    return { rows: rows, cols: cols };
  };

  /** Preview for the UI: which lines a placement would clear. */
  G.previewClear = function (piece, r, c) {
    var extra = {};
    for (var i = 0; i < piece.cells.length; i++) {
      extra[(r + piece.cells[i][0]) * this.cols + (c + piece.cells[i][1])] = true;
    }
    return this.fullLines(extra);
  };

  /**
   * opts.deferDeal: when the hand runs empty, don't deal inside this call.
   * The result gets newHand = 'pending' and the caller runs dealNow() a moment
   * later, so the (possibly slow) dealer never blocks the frame you placed on.
   */
  G.place = function (slot, r, c, opts) {
    var piece = this.hand[slot];
    if (this.over || !piece || !this.canPlace(piece, r, c)) return null;
    var self = this;

    var placed = piece.cells.map(function (rc) { return [r + rc[0], c + rc[1]]; });
    placed.forEach(function (rc) {
      self.board[self.idx(rc[0], rc[1])] = { color: piece.color, kind: piece.kind };
    });
    this.hand[slot] = null;
    this.moves++;

    var ctx = { game: this, piece: piece, row: r, col: c, cells: placed, extraClears: [] };
    BBC.mods.emit('piecePlaced', ctx);

    var lines = this.fullLines();
    var clearSet = {};
    lines.rows.forEach(function (rr) {
      for (var cc = 0; cc < self.cols; cc++) clearSet[self.idx(rr, cc)] = true;
    });
    lines.cols.forEach(function (cc) {
      for (var rr = 0; rr < self.rows; rr++) clearSet[self.idx(rr, cc)] = true;
    });
    ctx.extraClears.forEach(function (rc) {
      if (self.inside(rc[0], rc[1])) clearSet[self.idx(rc[0], rc[1])] = true;
    });

    var cleared = [];
    Object.keys(clearSet).forEach(function (k) {
      var i = +k;
      if (self.board[i]) cleared.push({ r: Math.floor(i / self.cols), c: i % self.cols, cell: self.board[i] });
    });

    var lineCount = lines.rows.length + lines.cols.length;
    var leftAfter = 0;
    for (var i = 0; i < this.board.length; i++) if (this.board[i] && !clearSet[i]) leftAfter++;

    ctx.lines = lineCount;
    ctx.clearedRows = lines.rows;
    ctx.clearedCols = lines.cols;
    ctx.cleared = cleared;
    ctx.comboBefore = this.combo;
    ctx.perfect = cleared.length > 0 && leftAfter === 0;

    var placePts = BBC.mods.applyFilter('placementScore', placed.length, ctx);
    var clearPts = lineCount > 0 ? (this.combo + 1) * 10 * lineCount * Math.max(1, lineCount - 1) : 0;
    clearPts = BBC.mods.applyFilter('clearScore', clearPts, ctx);

    if (lineCount > 0) {
      this.combo++;
      this.miss = 0;
    } else {
      this.miss++;
      if (this.miss >= COMBO_GRACE) this.combo = 0;
    }

    cleared.forEach(function (x) { self.board[self.idx(x.r, x.c)] = null; });

    var points = Math.round(placePts + clearPts);
    this.score += points;
    this.lines += lineCount;

    var result = {
      piece: piece,
      cells: placed,
      lines: lineCount,
      clearedRows: lines.rows,
      clearedCols: lines.cols,
      cleared: cleared,
      points: points,
      clearPoints: clearPts,
      combo: this.combo,
      perfect: ctx.perfect,
      newHand: false
    };

    if (lineCount > 0 || cleared.length) BBC.mods.emit('linesCleared', { game: this, result: result });
    BBC.mods.emit('moveDone', { game: this, result: result });

    if (this.hand.every(function (p) { return !p; })) {
      if (opts && opts.deferDeal) {
        this.dealPending = true;
        result.newHand = 'pending';
        return result;
      }
      this.dealHand();
      result.newHand = true;
    }
    this.checkOver();
    return result;
  };

  /** Deal the hand that place() left pending. Returns true if it dealt. */
  G.dealNow = function () {
    if (!this.dealPending || this.over) return false;
    this.dealHand();
    this.checkOver();
    return true;
  };

  G.checkOver = function () {
    var self = this;
    var stuck = !this.hand.some(function (p) { return p && self.fitsAnywhere(p); });
    var over = BBC.mods.applyFilter('isGameOver', stuck, { game: this });
    if (over && !this.over) {
      this.over = true;
      BBC.mods.emit('gameOver', { game: this });
    }
    return this.over;
  };

  /* ---------- save / restore ---------- */

  G.toJSON = function () {
    return {
      v: 1,
      rows: this.rows,
      cols: this.cols,
      handSize: this.handSize,
      ruleset: this.ruleset,
      modIds: this.modIds,
      seed: this.seed,
      rngState: this.rng.state,
      board: this.board,
      hand: this.hand,
      score: this.score,
      combo: this.combo,
      miss: this.miss,
      moves: this.moves,
      lines: this.lines,
      handsDealt: this.handsDealt,
      over: this.over,
      uid: this.uid
    };
  };

  G.restore = function (s) {
    var keys = ['board', 'hand', 'score', 'combo', 'miss', 'moves', 'lines', 'handsDealt', 'over', 'uid'];
    for (var i = 0; i < keys.length; i++) if (s[keys[i]] !== undefined) this[keys[i]] = s[keys[i]];
    this.rng.state = s.rngState >>> 0;
    BBC.mods.emit('gameRestored', { game: this });
    // Saved between the last piece of a hand and the next deal: deal now.
    if (!this.over && this.hand.every(function (p) { return !p; })) {
      this.dealHand();
      this.checkOver();
    }
  };

  BBC.Game = Game;
  BBC.COLORS = COLORS;
})((window.BBC = window.BBC || {}));
