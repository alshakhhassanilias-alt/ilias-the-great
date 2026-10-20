# Music

The World Order score: seven original pieces, generated from code in `tools/music/` (no samples, no third-party
recordings), so they are free to ship on Steam.

| File | Title | Plays when |
|---|---|---|
| `main-theme.ogg` | The World Order | main menu |
| `quiet-capitals.ogg` | Quiet Capitals | peace |
| `trade-winds.ogg` | Trade Winds | peace |
| `the-long-game.ogg` | The Long Game | peace |
| `red-lines.ogg` | Red Lines | tension: a crisis, low stability or an urgent decision |
| `iron-and-fire.ogg` | Iron and Fire | war |
| `the-front.ogg` | The Front | war |

The game crossfades between moods as the world changes and plays tracks of the same mood one after another.

## Use your own music

Replace any file with your own `.ogg` (or `.mp3` renamed in `src/music.ts`) under the same name and rebuild. To add
tracks, add a line to `TRACKS` in `src/music.ts` with its file, title and mood.

## Change the score

`python3 tools/music/tracks.py` renders every track again (needs Python 3 with numpy and scipy, plus ffmpeg);
`python3 tools/music/tracks.py red-lines` renders one. Each piece is a function in `tracks.py`; the instruments are
in `engine.py`.
