# ilias-the-great
a great efficient repository ,down to do all your tasks like a bro to bro

## Wortwerk: German from A1 to B2

An installable web app that teaches German from zero to B2. Every word and grammar rule is taught first, then practised with spaced repetition.

- **1,879 words** in 49 themed packs (A1 to B2). Each word comes with its article, plural, verb forms, audio and an example sentence.
- **34 grammar lessons**: step-by-step explanations with tables, examples and check questions, plus 612 practice sentences.
- **Teach, then test.** New words appear as teaching cards. Practice then climbs from recognising to choosing, building, typing, listening and speaking.
- **Adaptive.** A placement test skips what you already know. The daily load adjusts to your accuracy and review backlog. Weak spots get extra training.
- **Honest progress.** An hours meter tracks progress against the roughly 450–600 hours that B2 takes, with a daily on-track status and a level check at the end of each level.
- **Works offline** and installs on your phone's home screen.

### Use it

- **Online, with the AI tutor:** <https://claude.ai/artifact/Gq2uRDQ5m5fL9SgLEG7iPZ>
- **As its own website:** open `index.html`, or host this folder on any static host (see below).

### Put it online with GitHub Pages

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Pick the branch that holds this code and the folder `/ (root)`, then click **Save**.
4. After a minute the app is live at `https://<your-username>.github.io/ilias-the-great/`.

On your phone, open that address. Then use **Share → Add to Home Screen** on iPhone, or **Install app** on Android. It then runs like a normal app, offline too.

### Edit the content

- `src/content/vocab-*.js`: vocabulary packs, one word per line: `German|English|Example|Example in English`.
- `src/content/grammar-plus.js`: the grammar lessons and extra sentences.
- `src/data.js`: the original stations, verbs and tutor scenes.
- `src/app.js` and `src/styles.css`: the app itself.

After editing, run `node build.mjs` to rebuild `index.html`, `sw.js` and `manifest.webmanifest`.
