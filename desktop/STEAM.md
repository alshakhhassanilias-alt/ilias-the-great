# World Order on Steam: setup guide

Everything in the game that talks to Steam is already built in. This is what has to be set up on the Steamworks
website once you have a Steamworks account and an app id.

## 1. Build the game

- **On your own computer:** `npm install`, then `npm run desktop:dist` in the project folder. Windows builds come out of
  `desktop/release/` (`win-unpacked/` is the folder you upload to Steam).
- **On GitHub (all three systems):** Actions tab → *Desktop build* → *Run workflow*. When it finishes, download the
  `world-order-windows`, `world-order-macos` and `world-order-linux` artifacts. Pushing a tag such as `v0.9.0` runs it too.
- **To try it without packaging:** `npm run desktop`.

## 2. App id

When Steam starts the game it passes its app id itself. To test outside Steam, put a `steam_appid.txt` with your
app id next to `WorldOrder.exe` (or set the `STEAM_APP_ID` environment variable). Without either, the game uses 480
(Valve's public test app). Without Steam running at all, the game works normally and simply unlocks nothing.

## 3. Depots and launch options

| Depot | Contents | Launch option |
|---|---|---|
| Windows | everything in `win-unpacked/` | Executable `WorldOrder.exe` |
| macOS | `World Order.app` from the macOS zip | Executable `World Order.app` |
| Linux | everything in `linux-unpacked/` | Executable `WorldOrder` |

## 4. Achievements

`steam/achievements.csv` lists all 24, with the exact API names the game uses (`ACH_FIRST_CONQUEST`, …).
Create each one under *Stats & Achievements* with that API name, its display name and description, and upload the
icons from `steam/achievement-icons/` (`ACH_x.png` is the unlocked icon, `ACH_x_locked.png` the locked one, both
256 × 256). The game unlocks them as the in-game trophies are earned; ones earned before Steam was installed are
unlocked the next time the game is loaded with Steam running.

## 5. Steam Cloud (saves follow the player)

The game keeps each save as two files in a `saves` folder. Under *Steam Cloud → Auto-Cloud*, add these roots
(byte quota: 2 GB, number of files: 2000 is plenty):

| Root | Subdirectory | Pattern | OS |
|---|---|---|---|
| WinAppDataRoaming | `World Order/saves` | `*` | Windows |
| MacAppSupport | `World Order/saves` | `*` | macOS |
| LinuxXdgDataHome or LinuxHome | `.config/World Order/saves` | `*` | Linux |

Preferences (volume, keys) stay on each computer on purpose.

## 6. Overlay

The Steam overlay (Shift+Tab) is turned on in the app. Nothing to configure.

## 7. Crash reports

The game writes crash reports to the `logs` folder beside `saves` (on Windows: `%APPDATA%\World Order\logs`).
Ask beta testers to attach the newest one when they report a problem.

## Credits to add to the store page

- Game code, score and art: original.
- Map: Natural Earth (public domain).
- Fonts: Cinzel, Cormorant Garamond, Barlow, Barlow Condensed (SIL Open Font License).
- Achievement icon glyphs: Noto Color Emoji (SIL Open Font License).
- Steam integration: steamworks.js (MIT).
