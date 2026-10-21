# Waiter Pad

An offline iPhone notepad for taking orders, built on the restaurant's real menu
(vareniki / pelmeni / Soviet-style café, 22 menu photos, October 2026).

You write the order in Waiter Pad while talking to the guest, then type it into
the restaurant's official tablet (POS) from a clean checklist. Waiter Pad keeps
every open table saved on the phone, reminds you of what is easy to forget
(sizes, sides, broth, поджарка, the free breakfast coffee), and trains you on
the menu between tables.

## Put it on the iPhone

Waiter Pad is a static web app with no server and no account. Host the repository
root anywhere that serves files over HTTPS, then in **Safari → Share → Add to
Home Screen**. It then opens full-screen and keeps working offline (service
worker). Two easy hosts:

- **GitHub Pages**: open
  https://github.com/alshakhhassanilias-alt/ilias-the-great/settings/pages →
  *Deploy from a branch* → branch **`waiter-pad`**, folder **/ (root)** → Save.
  After 1–2 minutes the app is at
  https://alshakhhassanilias-alt.github.io/ilias-the-great/
  (Pages on a free plan needs the repository to be public.)
- **Netlify Drop** (app.netlify.com/drop): drag the repo folder in.

`npm run build` also writes `dist/waiter-pad.html`, a single self-contained file
(no offline caching) that you can host as one file.

Data lives only on this phone (localStorage). Export a backup now and then:
**Menu & data → Backup & settings**.

## How a table works

1. **Tables → + New table**: type the number on the keypad, tap the guest count.
   Opening a number that is already open just opens that table, so you can't
   create a duplicate table 5.
2. The menu opens straight away. **Tap an item = +1.** Tapping again adds another to
   the same line. Items that need a choice (juice 200 мл / 1 л, beer 330/500,
   wine glass/bottle, soda flavour, shot flavour…) open a sheet and cannot be
   added until the choice is made.
3. Search is forgiving and fast, and works offline:
   - **first letters**: `пс` → Пельмени сибирские, `вк` → Вареники с картофелем,
     `псг` → Пельмени сибирские в грибном соусе, `цк` → Цезарь с курицей
   - **word starts run together**: `пелсиб`, `сибпел`
   - **any word form**: `пельменей`, `шуба`, `сало`, `киевскую`
   - **typos and spelling**: `пильмени`, `борш`, `капучинно`, `глинтвеин`
   - **Latin or wrong keyboard**: `pelmeni`, `kapuchino`, `gc` (= пс)
   - **it learns from you**: whatever you pick after typing something comes
     first the next time you type it. Use that to make your own shortcuts.
4. Back on the table, each line shows what still needs attention:
   - **red**: must fix (size not chosen, stop-list item)
   - **amber**: confirm with the guest (side dish, second order of the same dish)
   - **blue**: optional offers the menu itself recommends. Tap one to add it.
5. **Review ✓** lists the new lines in menu order, in large type. Tick each one
   as you enter it into the POS, then **Mark entered**. Later rounds show up
   separately as "Not in POS yet".
6. **⋯ → Close table (paid)** moves it to history (kept 7 days, can be reopened).

**Notes:** tap ✎ on any line to write what the guest asked for ("без укропа",
"соус отдельно"); it shows under the dish in amber and appears in Review and
Copy text. "📝 Add table note" at the top of a table is for things like an
allergy, a birthday or a split bill. If a guest wants something that isn't on
the menu, type it in search and tap **✚ Add "…" as a request not on the
menu**. It becomes its own line marked *Не из меню*, with an optional price.

If you tag lines with a guest number (the **Guest** row in the menu screen), the
review screen can also group the order **By guest**. Use it to read the order
back to the table, then switch to **By menu** for typing into the POS.

## Learning the menu

- **Practice order**: a guest orders 2–4 things in English, often look-alike
  dishes, with sizes, side swaps and extras. Enter it with the normal menu
  screen on a practice table that never mixes with your real tables, then tap
  **Check**. It tells you what you missed, which size was wrong, which side you
  didn't confirm, and when you picked a look-alike (for example the rum Мохито
  instead of the non-alcoholic one), with the difference explained.
- **Quiz**: price, English↔Russian name, "which dish contains…", look-alikes.
- **Cards**: flashcards with price, weight and composition.
- **Look-alikes**: the 23 groups side by side with prices.
- **Hard 🧠**: items you mark come up 3× more often everywhere.

Wrong answers move an item back to the start, right answers move it forward
(spaced repetition).

## What it does because of *this* menu

These came from reading the photos, not from a generic template.

| Problem on this menu | What the app does |
|---|---|
| **Look-alike dishes.** Siberian pelmeni come in 4 versions (640/660/660/695); Belarusian vareniki on a plate are 460, in a pot 510; there are two "Мохито" (rum 550, non-alcoholic 360). | Every row has a black **form tag** (`ГОРШОЧЕК`, `ЖАРЕНЫЕ`, `ЗАПЕЧЁННЫЕ`, `С РОМОМ`, `БЕЗ АЛКОГОЛЯ`, `НАБОР`), filling icons (🐑 lamb, 🍄 mushroom, 🐟 fish…) and the section name above the dish name. ⓘ shows a "Don't confuse" box. 23 look-alike groups are drilled in **Learn → Look-alikes** and in the quiz. |
| **Printed recommendations get forgotten**: поджарка +140/110 for any vareniki, chicken broth +35 for Siberian/Ural pelmeni, сало +110 next to borsch, ice cream with any dessert. | Shown as a blue **Offer …** chip on the line, one tap to add. They are **never added automatically**, and "Guest declined" hides them. |
| **Sides**: 5 mains name their side in the title, and the menu says "Заменить гарнир +35₽". | The line asks you to confirm the side ("✓ As listed" or swap to one of the 4 sides at +35). Chicken Kiev and chicken cutlets with cheese have multi-part weights but no named side, so they show "ask what comes with it" instead of guessing. |
| **Breakfast promo**: free espresso / americano / tea until 12:00 with any breakfast dish. | Tables with a breakfast dish ordered before 12:00 get a reminder. Drinks have a 🎁 gift (0 ₽) toggle, and the reminder counts how many gift lines you have. |
| **Vodka promo**: 1 L of any vodka gets 3 L of juice free. | Counts vodka 40 мл portions per table and reminds you at 1 L. |
| **Repeat orders** ("another round of the same") vs. accidental double taps. | Untouched duplicates merge into one line. A dish that was already entered in the POS and is added again shows "already entered ×2 — second order?". |
| **Pits/bones** are printed on cherry vareniki, posikunchiki, the sweet set and the ukha. | A 🦴 tag and a "Tell guest" reminder. |
| **Forgetting drinks.** | Tables with food and no drinks get "ask about drinks". |
| **Stop-list.** Dishes run out during a shift. | ⓘ → ⛔ Stop-list greys the dish out and warns before adding. Cleared at end of shift. |

## Reliability

- Every tap saves immediately, and each write is read back to confirm it. If saving
  fails, a red **NOT SAVED** banner appears instead of failing silently.
- Snapshots are taken automatically every 2 minutes and on every table close (12
  kept). If the main save is damaged, the app restores the newest snapshot on
  start. **Menu & data → Snapshots** restores any of them.
- Undo for every add, remove and close (5 seconds).
- Backup can be exported as a file or copied as text (for web views that block
  downloads). Both restore.
- The app reopens on the same table if iOS kills it in the background.

## Things you should verify (I could not)

Marked ⚠ in the app. All of them are listed under **Menu & data → ⚠ To verify**,
and you can fix prices there.

- **Blini with toppings (390)**: how many toppings are included is not printed.
- **Side swap +35**: which dishes it applies to is not printed.
- **Tasting set of 5 shots**: has a `**` footnote that is not legible.
- **Винегрет 200/45 г**: the photo shows herring on bread next to it, but what
  the 45 г is isn't stated.
- **Wine**: two Russian/English mismatches (Шато Тамань Розе Брют: "сухое" vs
  "demi sweet"; Коно Сур Совиньон Блан: "полусухое" vs "dry").
- **Not photographed**: if the menu has pages beyond these 22 (e.g. kids' menu,
  more pelmeni), add them via **Menu & data → + Add item missing from the photos**.
- **Allergens**: the menu prints none, so the app shows none. It only shows
  compositions exactly as printed.

## Development

```
npm test          # 29 unit tests: menu data, order logic, storage, practice grading
npm run test:e2e  # 23 browser checks at iPhone size (needs Playwright + Chromium)
npm run build     # dist/waiter-pad.html single-file build
```

Files: `js/menu-data.js` (the transcribed menu), `js/logic.js` (pricing,
checks, search), `js/store.js` (persistence), `js/training.js` (quiz),
`js/app.js` (UI), `css/app.css`, `sw.js` (offline).
