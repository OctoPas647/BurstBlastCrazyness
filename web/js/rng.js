/* BurstBlastCrazyness — seeded random number generator.
 * Mulberry32: tiny, fast, and fully reproducible from a 32-bit seed.
 * The whole game uses ONE generator per game, so a seed replays the
 * exact same piece sequence (as long as no mod makes dealing board-aware).
 */
(function (BBC) {
  'use strict';

  function RNG(seed) {
    this.state = seed >>> 0;
  }

  RNG.prototype.next = function () {
    var t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Integer in [0, n). */
  RNG.prototype.int = function (n) {
    return Math.floor(this.next() * n);
  };

  RNG.prototype.pick = function (arr) {
    return arr[this.int(arr.length)];
  };

  /** Pick an item using parallel weights array (all >= 0). */
  RNG.prototype.weighted = function (items, weights) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += Math.max(0, weights[i] || 0);
    if (total <= 0) return this.pick(items);
    var roll = this.next() * total;
    for (i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i] || 0);
      if (roll < 0) return items[i];
    }
    return items[items.length - 1];
  };

  BBC.RNG = RNG;

  BBC.newSeed = function () {
    try {
      return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    } catch (e) {
      return (Math.random() * 4294967296) >>> 0;
    }
  };

  BBC.seedToText = function (seed) {
    return (seed >>> 0).toString(36).toUpperCase();
  };

  BBC.textToSeed = function (text) {
    var clean = String(text || '').trim().toLowerCase();
    if (/^[0-9a-z]{1,7}$/.test(clean)) {
      var n = parseInt(clean, 36);
      if (n <= 4294967295) return n >>> 0;
    }
    // Any other text: hash it (FNV-1a) so "hello" is a valid seed too.
    var h = 0x811c9dc5;
    for (var i = 0; i < clean.length; i++) {
      h ^= clean.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
})((window.BBC = window.BBC || {}));
