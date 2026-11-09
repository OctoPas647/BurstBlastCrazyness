/* Biomes — calm color worlds. Pick one, or let them change as your score grows. */
(function () {
  var BIOMES = [
    { id: 'twilight', name: 'Twilight', bg1: '#1c1633', bg2: '#30254f', accent: '#e3c873', sheet: '#241c40',
      palette: ['#d6697c', '#d8925f', '#d6bd6c', '#6fbb8c', '#5ea6c6', '#7b83d2', '#a57bc6', '#cc7fab'] },
    { id: 'ocean', name: 'Ocean', bg1: '#0e1e2c', bg2: '#173a50', accent: '#82d0c6', sheet: '#132b3d',
      palette: ['#dc7d7d', '#dea169', '#d5c47b', '#5fbb9f', '#4f9fc2', '#6a8ed2', '#9886cc', '#c58fb5'] },
    { id: 'forest', name: 'Forest', bg1: '#132119', bg2: '#21402b', accent: '#c8d67c', sheet: '#1a2f22',
      palette: ['#d5715f', '#d69a58', '#cabd65', '#7dbb6b', '#4faa8d', '#5e9bbd', '#998dca', '#c3839e'] },
    { id: 'desert', name: 'Desert', bg1: '#291c13', bg2: '#4a3221', accent: '#eec17c', sheet: '#36261a',
      palette: ['#d5745e', '#dc995c', '#d8bd72', '#9bb86f', '#5fada0', '#6c95c0', '#a688c0', '#cb8a98'] },
    { id: 'tundra', name: 'Tundra', bg1: '#17202b', bg2: '#2a394b', accent: '#bcdcea', sheet: '#1f2b3a',
      palette: ['#d27f8d', '#d4a07b', '#d2c889', '#84bea2', '#77b1d0', '#889dd8', '#a996d0', '#cb9bbc'] },
    { id: 'ember', name: 'Ember', bg1: '#231215', bg2: '#421f29', accent: '#eb9a6d', sheet: '#311820',
      palette: ['#d96b6b', '#da8a53', '#d4b160', '#85b36b', '#50a5a4', '#6b88c7', '#9e7ac3', '#cb7a9e'] },
    { id: 'sakura', name: 'Sakura', bg1: '#291a29', bg2: '#482b44', accent: '#ecb2c8', sheet: '#382236',
      palette: ['#da7a8f', '#da9b7c', '#d9c48f', '#8dc098', '#79b3c3', '#8e98d3', '#b08ed3', '#d99bbe'] }
  ];

  function current(api) {
    var pick = api.setting('biome');
    if (pick && pick !== 'auto') {
      for (var i = 0; i < BIOMES.length; i++) if (BIOMES[i].id === pick) return BIOMES[i];
    }
    return BIOMES[(api.storage.get('index', 0) || 0) % BIOMES.length];
  }

  BBC.mods.register({
    id: 'biomes',
    name: 'Biomes',
    version: '1.0.0',
    author: 'BurstBlastCrazyness',
    description: 'Calm color worlds: Twilight, Ocean, Forest, Desert, Tundra, Ember, Sakura. On Auto, you move to the next world (new colors) only when you clear the entire board.',
    type: 'cosmetic',
    defaultEnabled: true,
    conflicts: ['neon-theme'],
    settings: [
      { key: 'biome', label: 'Biome', type: 'select', default: 'auto',
        options: [{ value: 'auto', label: 'Auto (next world on a full-board clear)' }].concat(
          BIOMES.map(function (b) { return { value: b.id, label: b.name }; })) }
    ],
    setup: function (api) {
      var shown = null;
      api.filter('theme', function (t) {
        var b = current(api);
        shown = b.id;
        t.vars['--bg1'] = b.bg1;
        t.vars['--bg2'] = b.bg2;
        t.vars['--accent'] = b.accent;
        t.vars['--sheet'] = b.sheet;
        t.palette = b.palette.slice();
        return t;
      });
      // A new game starts in the first world; a resumed game keeps its world.
      api.on('gameStart', function () {
        api.storage.set('index', 0);
        if (shown !== current(api).id) api.ui.retheme();
      });
      // Only a full-board clear moves you on to the next world.
      api.on('linesCleared', function (e) {
        if (!e.result.perfect || (api.setting('biome') || 'auto') !== 'auto') return;
        api.storage.set('index', ((api.storage.get('index', 0) || 0) + 1) % BIOMES.length);
        var b = current(api);
        setTimeout(function () {
          api.ui.retheme();
          api.ui.banner(b.name);
        }, 450);
      });
    }
  });
})();
