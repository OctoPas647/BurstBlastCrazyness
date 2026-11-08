/* Example mod: replaces how hands are dealt (uses the "dealHand" filter).
 * This makes dealing look at the board, so it's off by default and the
 * Fair play tab says so while it's on. It only helps you; it never
 * picks pieces to make you lose. */
BBC.mods.register({
  id: 'gentle-dealer',
  name: 'Gentle Dealer',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'Rerolls any piece that has no space anywhere on the board (still random, just never a dead piece). Seeds stop being replayable with this on.',
  type: 'gameplay',
  settings: [
    { key: 'tries', label: 'Rerolls per piece', type: 'number', min: 1, max: 100, default: 20 }
  ],
  setup: function (api) {
    api.filter('dealHand', function (hand, ctx) {
      var tries = api.setting('tries');
      return hand.map(function (p) {
        var n = 0;
        while (!ctx.game.fitsAnywhere(p) && n++ < tries) p = ctx.draw();
        return p;
      });
    });
  }
});
