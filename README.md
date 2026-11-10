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

## Game modes

Pick the mode in the pause menu or on the game-over card. Each mode keeps its own best score.

- **Classic**: the regular shapes, dealt by the Smart Dealer (or purely at random if you switch it off).
- **Crazyness**: hands are made of **crazy blocks**, shapes that are grown on the spot from the free space on your board.

### Crazy blocks

1. All little blocks of a crazy block touch each other, side by side or diagonally. No loose parts.
2. Size is 1 up to (board − 1) blocks. The *Biggest crazy block* setting caps it (default 20, so one block can't wipe the board on every move).
3. A hand is planned two steps ahead: block 1 is grown on the current board, block 2 on the board after block 1 has landed and cleared its lines, block 3 after block 2. So a hand always fits, at least in that order.
4. A crazy block never looks like a regular shape, or like another crazy block in the same hand. "Looks like" means the two overlap by 70% or more in some position, rotation or mirror image.
5. The dealer always goes for three crazy blocks, as big as it can make them. A regular shape only appears when no crazy block is possible for that slot.

"As big as it can" has one safeguard. Three maximum-size blocks usually fit in one exact order only: in tests, a simulated player lasted about 10 moves that way. So each hand is test-played in other orders and spots, and if it is too easy to get stuck the blocks are grown a size smaller. With the default settings the typical block is about 15 blocks big and the same simulated player lasts about 80 moves. Under Mods → Crazyness you can change the cap, pick *Forgiving* or *Always the biggest*, or switch on *Re-grow blocks when none fits* (no game over).

## How it moves

The animation layer follows Apple's fluid-interface rules (from the WWDC talks "Designing Fluid Interfaces" and "Animate with springs"):

- **Answer on touch-down.** A piece leaves the tray on the frame you touch it.
- **Start from where it is.** The dragged piece starts exactly on the tray piece and glides to your finger; nothing jumps.
- **Everything can be interrupted.** A piece flying back to the tray can be caught mid-air. A piece that is still arriving can be grabbed.
- **Springs, with bounce only after a throw.** Landing and returning are springs that start at your finger's speed. Menus settle without bounce.
- **The game never waits for an animation.** A move counts the moment you let go. The flight into the cell, the line pops and the score are drawn afterwards, and several can run at once.
- **What the preview shows is where it lands.** A move can't be taken back, so a flick never picks a different cell than the one highlighted.
- **Less motion on request.** With the system's "reduce motion" setting on, pieces appear instead of flying.

For speed: the next hand is worked out one frame after the last piece lands (not in the middle of the landing), effects only animate transform and opacity so they keep running while the dealer thinks, the tray and board only redraw what changed, and the game is saved shortly after a move instead of during it.

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
| Crazyness | gameplay | The Crazyness game mode: hands of procedurally grown crazy blocks |
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
  js/motion.js       springs, finger tracking
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
