/* BurstBlastCrazyness — tiny synthesized sound effects (no audio files). */
(function (BBC) {
  'use strict';
  var ctx = null;
  var SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

  function ac() {
    if (!BBC.settings || !BBC.settings.sound) return null;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      return null;
    }
    return ctx;
  }

  function tone(freq, start, dur, type, vol) {
    var a = ac();
    if (!a) return;
    var t = a.currentTime + start;
    var o = a.createOscillator();
    var g = a.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function note(step) {
    return 330 * Math.pow(2, step / 12);
  }

  BBC.sfx = {
    unlock: function () { ac(); },
    pick: function () { tone(520, 0, 0.05, 'sine', 0.08); },
    place: function () { tone(180, 0, 0.09, 'triangle', 0.2); },
    drop: function () { tone(140, 0, 0.12, 'sine', 0.12); },
    clear: function (lines, combo) {
      var base = Math.min(combo, SCALE.length - 4);
      var n = Math.min(lines + 1, 4);
      for (var i = 0; i < n; i++) tone(note(SCALE[base + i]), i * 0.06, 0.25, 'triangle', 0.16);
    },
    over: function () {
      [7, 4, 0, -5].forEach(function (s, i) { tone(note(s), i * 0.14, 0.3, 'sine', 0.15); });
    }
  };
})((window.BBC = window.BBC || {}));
