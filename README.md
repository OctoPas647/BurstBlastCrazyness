# BurstBlastCrazyness

An 8×8 block puzzle with no ads and no revives to buy. By default the **Smart Dealer** reads your board and deals the hand that helps you most. Switch it off for **truly random** pieces.

- Drag 3 pieces onto the board, fill rows **or** columns to clear them, then get 3 new pieces.
- Combos for clearing on moves close together, big bonuses for clearing several lines at once.
- Game over when none of your pieces fits anywhere.
- **Mods**: switch gameplay and looks on and off in the app, or install your own (see [MODDING.md](MODDING.md)).

## Play

| Where | How |
| --- | --- |
| Android | Download `BurstBlastCrazyness.apk` from [Releases → latest](https://github.com/OctoPas647/BurstBlastCrazyness/releases/latest). Every new build installs over the last one and keeps your scores. |
| Browser | https://octopas647.github.io/burstblastcrazyness/ (after Pages is switched on, see below) |
| Locally | `cd web && python3 -m http.server` then open http://localhost:8000 |

## Smart Dealer (on by default)

On every new hand it runs a beam search over the board:

1. For every shape, find its best spot and score the board that results.
2. Keep the 6 best boards, then repeat for the 2nd and 3rd piece.
3. Deal the 3 shapes from the best plan, in shuffled slot order.

Scoring favours **big pieces** (1–2 block pieces are heavily penalised), **line clears**, **multi-line clears** and **full-board clears** (+3000). It also keeps the board open, with few holes and room for a 3×3. Each hand is guaranteed to fit, at least in the planned order. If you get stuck anyway, your leftover pieces are swapped for ones that fit.

You can adjust Big piece preference (Normal / High / Max), Variety and stuck-swap under Mods → Smart Dealer. In a 6-game test, a simple bot scored about **35k–100k** over 450 moves with no game over. With random dealing it scored about **130–620** and died after 17–47 moves.

## Pure random mode (Smart Dealer off)

Write-ups about the popular games in this genre describe a dealer that reads your board and how well you're doing, then picks pieces that get harder when you're on a streak. This game works the other way:

- Every piece is drawn **on its own**, from the shape list, with **equal odds** (37 shapes → 2.7% each).
- The dealer never reads the board, score, combo or play time. You can check in `web/js/engine.js` → `drawPiece()`.
- Every game has a **seed**. Same seed = same pieces in the same order, no matter how you play. Share it and compare scores.
- The **Fair play** tab in the app shows every shape in play and its odds, and names any mod that changes how hands are dealt.

## Scoring

The scoring follows the formula documented for the genre:

- **+1** per block placed
- Clearing **L** lines in one move: `(combo + 1) × 10 × L × max(1, L − 1)`
  (1 line = 10, 2 = 40, 3 = 180, 4 = 480, all multiplied by combo)
- Each clearing move raises combo by 1. Three moves in a row with no clear reset it to 0.

## Built-in mods

| Mod | Type | What it does |
| --- | --- | --- |
| Smart Dealer | gameplay | On by default. Deals the most helpful hand, big pieces, swaps when stuck |
| Big Board | gameplay | Board size 5–14 (default 10×10) |
| Crazy Shapes | gameplay | Adds plus, U, ring, zig-zag and diagonal pieces |
| Bombs | gameplay | Rare bomb block that destroys its 3×3 area |
| Perfect Clear Bonus | gameplay | Bonus for emptying the whole board |
| Gentle Dealer | gameplay | Rerolls pieces that can't fit anywhere (opt-in, clearly labelled) |
| Zen Mode | gameplay | No game over |
| Biomes | look | On by default. Calm color worlds (Twilight, Ocean, Forest, Desert, Tundra, Ember, Sakura), changing every 1500 points or fixed |
| Neon Night | look | Neon color theme |
| Square Blocks | look | Sharp-cornered blocks |

Gameplay mods start applying at the next game, and each set of mods keeps its own best score. Look mods switch on and off immediately.

## Project layout

```
web/                 the whole game (plain HTML/CSS/JS, no build step)
  index.html
  css/style.css
  js/rng.js          seeded random (Mulberry32)
  js/pieces.js       shape list (ASCII art → cells)
  js/mods.js         mod system: filters, events, settings, custom mods
  js/engine.js       rules, scoring, dealing, save/restore (no DOM)
  js/ui.js           board, drag & drop, menus, effects
  js/sfx.js          synthesized sounds
  js/main.js         boot, new game, best scores
  mods/              built-in mods + manifest.js (list of files to load)
android/             WebView wrapper that packs /web into an APK
.github/workflows/   APK build → Releases, web → GitHub Pages
```

## One-time GitHub setup

1. **APK**: nothing to do. The `Build APK` workflow runs on every push to `main`.
2. **Web version**: go to *Settings → Pages → Build and deployment → Source* and pick **GitHub Actions**, then re-run the `Deploy web version` workflow.

**Signing:** add these repository secrets (Settings → Secrets and variables → Actions) to sign with your private key: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. If they're missing, the build falls back to the shared key in `android/app/bbc-debug.keystore`.

## Building the APK yourself

You'll need the Android SDK and JDK 17:

```
cd android
./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

## Credits

The game rules and scoring formula come from public player write-ups and open-source analyses of 8×8 block puzzles. All code, art and sound in this repo are original.
