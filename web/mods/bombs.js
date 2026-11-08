/* Example mod: a special piece with its own effect
 * (uses "pieceCatalog", "pieceWeights", the "piecePlaced" event and "clearScore"). */
BBC.mods.register({
  id: 'bombs',
  name: 'Bombs',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'Sometimes you get a bomb block. Place it and it blows up everything in the 3×3 around it (+5 per block destroyed).',
  type: 'gameplay',
  settings: [
    { key: 'chance', label: 'Bomb chance (%)', type: 'number', min: 1, max: 50, default: 4 }
  ],
  setup: function (api) {
    api.filter('pieceCatalog', function (list) {
      return list.concat([api.pieces.fromArt('bomb', ['#'], { kind: 'bomb' })]);
    });

    // Give the bomb a fixed share of the bag, the rest stays equal.
    api.filter('pieceWeights', function (weights, ctx) {
      var cat = ctx.game.catalog;
      var bombs = 0, others = 0;
      cat.forEach(function (s, i) { if (s.kind === 'bomb') bombs++; else others += weights[i]; });
      if (!bombs) return weights;
      var p = Math.min(0.9, api.setting('chance') / 100);
      var each = (others * p / (1 - p)) / bombs;
      return weights.map(function (w, i) { return cat[i].kind === 'bomb' ? each : w; });
    });

    api.on('piecePlaced', function (ctx) {
      if (ctx.piece.kind !== 'bomb') return;
      var hit = 0;
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          var r = ctx.row + dr, c = ctx.col + dc;
          ctx.extraClears.push([r, c]);
          if (ctx.game.inside(r, c) && ctx.game.get(r, c)) hit++;
        }
      }
      ctx.bombHits = hit;
    });

    api.filter('clearScore', function (pts, ctx) {
      return ctx.bombHits ? pts + ctx.bombHits * 5 : pts;
    });
  }
});
