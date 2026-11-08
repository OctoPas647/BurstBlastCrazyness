/* Example mod: changes the lose condition (uses the "isGameOver" filter). */
BBC.mods.register({
  id: 'zen',
  name: 'Zen Mode',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'No game over. When you are stuck you get a fresh hand; if nothing fits at all, the board is wiped and you keep your score.',
  type: 'gameplay',
  setup: function (api) {
    api.filter('isGameOver', function (stuck, ctx) {
      if (!stuck) return false;
      var g = ctx.game;
      for (var i = 0; i < 10; i++) {
        g.dealHand();
        if (g.hand.some(function (p) { return p && g.fitsAnywhere(p); })) {
          api.ui.toast('Stuck — new hand');
          return false;
        }
      }
      for (var k = 0; k < g.board.length; k++) g.board[k] = null;
      api.ui.toast('Board wiped — keep going');
      return false;
    });
  }
});
