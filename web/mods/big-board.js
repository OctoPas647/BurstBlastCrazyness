/* Example mod: changes the board size (uses the "config" filter). */
BBC.mods.register({
  id: 'big-board',
  name: 'Big Board',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'Play on a bigger (or smaller) board. Default 10×10.',
  type: 'gameplay',
  settings: [
    { key: 'size', label: 'Board size', type: 'number', min: 5, max: 14, default: 10 }
  ],
  setup: function (api) {
    api.filter('config', function (cfg) {
      var n = api.setting('size');
      cfg.rows = n;
      cfg.cols = n;
      return cfg;
    });
  }
});
