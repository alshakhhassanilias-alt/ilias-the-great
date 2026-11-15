# ilias-the-great
a great efficient repository ,down to do all your tasks like a bro to bro

## Wortwerk: German from A1 to B2

An installable web app that teaches German from zero to B2. Every word and grammar rule is taught first, then practised with spaced repetition.

- **4,003 words** in 116 themed packs (A1 to B2). Each word has its article, plural, verb forms, audio, an example sentence and, where useful, its word family.
- **34 grammar lessons**: step-by-step explanations, check questions and 612 practice sentences.
- **Production drills**: conjugation, case and adjective endings, sentence transformations, error spotting and plurals, weighted toward your weakest skill.
- **Listening**: 20 dialogues read by different voices, with transcripts and questions.
- **Reading**: 36 graded texts with audio, key words and questions.
- **Mock exams (A2, B1, B2)** in the Goethe format. Claude writes a fresh exam each time and grades your writing and speaking.
- **Voice tutor**: role-play conversations you can speak instead of type, with every message corrected.
- **A scheduler (FSRS)** that predicts when you'd forget each item, plus a daily review cap and streak freezes.
- **A daily-load coach** that notices fatigue (accuracy dropping) and caps new material per day. Then it tells you to stop and suggests German videos, podcasts, series or books for the evening, or a topic Claude picks for you.
- **Honest progress**: an hours meter toward the ~450–600 hours B2 takes, weekly summaries, badges, level checks and certificates.
- **Works offline** and installs on your phone's home screen. The AI features need the Claude version.

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
