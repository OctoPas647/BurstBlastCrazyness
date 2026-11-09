/* Example mod: adds new shapes to the bag (uses the "pieceCatalog" filter). */
BBC.mods.register({
  id: 'crazy-shapes',
  name: 'Crazy Shapes',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'Adds hollow squares, zig-zag stairs, X shapes and diagonal steps to the shape list.',
  type: 'gameplay',
  setup: function (api) {
    var P = api.pieces;
    api.filter('pieceCatalog', function (list) {
      var extra = [];
      extra.push(P.fromArt('crazy_ring', ['###', '#.#', '###']));
      extra = extra.concat(P.rotations('crazy_w', ['#..', '##.', '.##']));
      extra = extra.concat(P.rotations('crazy_diag2', ['#.', '.#']));
      extra = extra.concat(P.rotations('crazy_diag3', ['#..', '.#.', '..#']));
      extra = extra.concat(P.rotations('crazy_x', ['#.#', '.#.', '#.#']).slice(0, 1));
      return list.concat(extra);
    });
  }
});
