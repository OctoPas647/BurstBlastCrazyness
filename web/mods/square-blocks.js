/* Example cosmetic mod: a theme variable other than colors. */
BBC.mods.register({
  id: 'square-blocks',
  name: 'Square Blocks',
  version: '1.0.0',
  author: 'BurstBlastCrazyness',
  description: 'Sharp square corners instead of rounded blocks.',
  type: 'cosmetic',
  setup: function (api) {
    api.filter('theme', function (t) {
      t.vars['--radius'] = '3px';
      return t;
    });
  }
});
