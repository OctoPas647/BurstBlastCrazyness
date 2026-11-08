# Modding BurstBlastCrazyness

A mod is one JavaScript file that calls `BBC.mods.register({...})`. There are two ways to add one:

1. **Ship it with the game.** Put the file in `web/mods/` and add its path to `web/mods/manifest.js`.
2. **Install it in the app.** Go to Menu → Mods → *Install a mod from code* and paste the code. It's saved on that device and has a **Remove** button.

## Smallest possible mod

```js
BBC.mods.register({
  id: 'double-points',          // unique, letters/numbers/-_.
  name: 'Double Points',
  type: 'gameplay',             // 'gameplay' or 'cosmetic'
  description: 'Placing blocks scores double.',
  setup: function (api) {
    api.filter('placementScore', function (points) {
      return points * 2;
    });
  }
});
```

## Mod definition

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique id. Registering the same id again replaces the old mod. |
| `setup(api)` | yes | Runs when a game starts (and when look mods are toggled). Hook in here. |
| `name`, `description`, `version`, `author` | no | Shown in the Mods menu. |
| `type` | no | `'gameplay'` (default) applies from the next game and gets its own best score. `'cosmetic'` toggles live. |
| `defaultEnabled` | no | Start switched on. Default `false`. |
| `settings` | no | List of options shown under the mod (see below). |
| `conflicts` | no | Mod ids that get switched off when this one is switched on. |

### Settings

```js
settings: [
  { key: 'size',  label: 'Board size', type: 'number', min: 5, max: 14, step: 1, default: 10 },
  { key: 'hard',  label: 'Hard mode',  type: 'boolean', default: false },
  { key: 'style', label: 'Style', type: 'select', default: 'a',
    options: [{ value: 'a', label: 'Style A' }, { value: 'b', label: 'Style B' }] }
]
```

Read a setting with `api.setting('size')`. Gameplay settings are part of the ruleset, so changing one starts a separate best score.

## The `api` object

| Member | What it does |
| --- | --- |
| `api.filter(name, fn, priority = 10)` | Change a value. `fn(value, ctx)` returns the new value (returning `undefined` keeps the old one). Lower priority runs first. |
| `api.on(event, fn)` | React to something. `fn(payload)`. |
| `api.setting(key)` | Current value of one of your settings. |
| `api.game` | The running `BBC.Game` (board, hand, score…). |
| `api.pieces` | Shape helpers: `fromArt(id, art, extra)`, `rotations(id, art, extra)`, `rotate(shape)`, `classic()`. |
| `api.storage.get(key, fallback)` / `.set(key, value)` | Small saved storage for your mod only. |
| `api.ui.toast(msg, kind)` | Show a message (`kind`: `'error'` or nothing). |
| `api.ui.refresh()` | Redraw board and tray. |

If a mod throws an error, the game catches it, shows a toast and keeps going.

## Filters

| Filter | Value | ctx | Use it for |
| --- | --- | --- | --- |
| `config` | `{ rows, cols, handSize }` | – | Board size, pieces per hand (1–5) |
| `pieceCatalog` | array of shapes | – | Add or remove shapes |
| `pieceWeights` | array of numbers (one per catalog shape, all `1` by default) | `game` | Change odds |
| `dealHand` | array of pieces | `game`, `rng`, `draw()` | Replace how a hand is dealt (`draw()` = one fair random piece) |
| `placementScore` | number (blocks placed) | see *move ctx* | Points for placing |
| `clearScore` | number | see *move ctx* | Points for clearing |
| `isGameOver` | boolean (`true` = stuck) | `game` | Change the lose rule (return `false` to keep playing) |
| `theme` | `{ vars: {...CSS variables}, palette: [8 colors] }` | – | Colors and look |

**move ctx** has `game, piece, row, col, cells, lines, clearedRows, clearedCols, cleared, comboBefore, perfect, extraClears` plus anything an earlier event handler added.

### Theme variables

`--bg1 --bg2 --board --board-edge --empty --text --muted --accent --sheet --radius`, plus `palette`: an array of 8 block colors.

## Events

| Event | Payload | When |
| --- | --- | --- |
| `gameStart` | `{ game }` | New game, after the first hand |
| `gameRestored` | `{ game }` | Saved game resumed |
| `handDealt` | `{ game, hand }` | Every new hand |
| `piecePlaced` | move ctx | Piece is on the board, before lines are checked. Push `[row, col]` into `ctx.extraClears` to destroy more cells. |
| `linesCleared` | `{ game, result }` | Something was cleared |
| `moveDone` | `{ game, result }` | After every move |
| `gameOver` | `{ game }` | No piece fits |

## Shapes

Shapes are ASCII art, `#` = block:

```js
var plus = api.pieces.fromArt('my_plus', ['.#.', '###', '.#.']);
var ells = api.pieces.rotations('my_L', ['#.', '#.', '##']);   // all 4 rotations
var bomb = api.pieces.fromArt('bomb', ['#'], { kind: 'bomb' }); // custom kind
```

A custom `kind` puts the CSS class `kind-<name>` on its cells, so you can style it. See `.kind-bomb` in `web/css/style.css`.

## Example: a special block

```js
BBC.mods.register({
  id: 'row-zapper',
  name: 'Row Zapper',
  description: 'A rare 1×1 block that clears its whole row.',
  settings: [{ key: 'chance', label: 'Chance (%)', type: 'number', min: 1, max: 30, default: 3 }],
  setup: function (api) {
    api.filter('pieceCatalog', function (list) {
      return list.concat([api.pieces.fromArt('zap', ['#'], { kind: 'zap' })]);
    });
    api.filter('pieceWeights', function (w, ctx) {
      var cat = ctx.game.catalog, total = 0;
      cat.forEach(function (s, i) { if (s.kind !== 'zap') total += w[i]; });
      var p = api.setting('chance') / 100;
      return w.map(function (x, i) { return cat[i].kind === 'zap' ? total * p / (1 - p) : x; });
    });
    api.on('piecePlaced', function (ctx) {
      if (ctx.piece.kind !== 'zap') return;
      for (var c = 0; c < ctx.game.cols; c++) ctx.extraClears.push([ctx.row, c]);
    });
  }
});
```

## Keeping it fair

A mod that makes dealing look at the board (like *Gentle Dealer*) is allowed, but the **Fair play** tab names every active `dealHand` mod so players always know. Please don't publish mods that deal against the player.
