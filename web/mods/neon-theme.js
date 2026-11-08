/* Example cosmetic mod: recolors everything (uses the "theme" filter).
 * Cosmetic mods can be switched on and off in the middle of a game. */
BBC.mods.register({
  id: 'neon-theme',
  name: 'Neon Night',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'Black background with glowing neon blocks.',
  type: 'cosmetic',
  conflicts: [],
  setup: function (api) {
    api.filter('theme', function (t) {
      t.vars['--bg1'] = '#050508';
      t.vars['--bg2'] = '#11111f';
      t.vars['--board'] = 'rgba(255,255,255,0.03)';
      t.vars['--board-edge'] = 'rgba(0,255,200,0.25)';
      t.vars['--empty'] = 'rgba(255,255,255,0.04)';
      t.vars['--accent'] = '#00ffc8';
      t.vars['--sheet'] = '#101018';
      t.palette = ['#ff2e63', '#ff9e00', '#f9f871', '#00ffc8', '#00b3ff', '#7a5cff', '#e100ff', '#ff4fd8'];
      return t;
    });
  }
});
