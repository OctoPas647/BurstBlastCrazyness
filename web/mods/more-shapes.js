/* More Shapes — the bigger shapes Block Blast doesn't have. Off by default,
 * so Classic plays with the Block Blast set only. */
BBC.mods.register({
  id: 'more-shapes',
  name: 'More Shapes',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'Adds bigger shapes that are not in Block Blast: long L/J, P/Q, big T, U, plus, 2×4 and big S/Z.',
  type: 'gameplay',
  setup: function (api) {
    api.filter('pieceCatalog', function (list) {
      return list.concat(api.pieces.extended());
    });
  }
});
