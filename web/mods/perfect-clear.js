/* Example mod: bonus scoring (uses the "clearScore" filter). */
BBC.mods.register({
  id: 'perfect-clear',
  name: 'Perfect Clear Bonus',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'Empty the whole board with a clear and get a bonus.',
  type: 'gameplay',
  settings: [
    { key: 'bonus', label: 'Bonus points', type: 'number', min: 0, max: 5000, step: 50, default: 300 }
  ],
  setup: function (api) {
    api.filter('clearScore', function (pts, ctx) {
      if (!ctx.perfect) return pts;
      api.ui.toast('Perfect clear! +' + api.setting('bonus'));
      return pts + api.setting('bonus');
    });
  }
});
