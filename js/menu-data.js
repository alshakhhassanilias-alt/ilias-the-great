/*
 * Menu data transcribed from the 22 menu photos provided (October 2026).
 *
 * Rules followed:
 *  - Russian names, prices, weights and compositions are copied from the photos.
 *  - Nothing is invented. Where a photo was cropped or ambiguous the field is
 *    flagged with `unverified: '<reason>'` and shown in the app with a ⚠ mark.
 *  - Items printed on two pages (творожные шарики, блины с добавками) are
 *    stored once and listed under both categories via `alsoIn`.
 *  - "Recommendations" printed on the menu (поджарка, бульон, сало, мороженое)
 *    are modelled as optional extras the app *suggests*, never auto-adds.
 *
 * Item fields:
 *   id, cat, ru, en, price (₽, base), w (weight/volume as printed),
 *   desc (composition, RU as printed), descEn (EN as printed),
 *   tags: new | pits | bones | spicy | alc | breakfast
 *   icons: quick visual filling cue (derived from the printed name only)
 *   form: short distinguishing label (варёные / жареные / в горшочке / ...)
 *   options: [{id, label, required, multi, choices:[{id, label, price?}]}]
 *            choice.price replaces the base price (sizes); otherwise base stays.
 *   side: { name, swap } — side named in the dish title (swap = "+35 ₽" rule)
 *   sideUnknown: true — weight suggests a garnish but the menu does not name it
 *   mods: list of modifier-group ids that can be attached
 *   suggest: modifier ids the menu itself recommends for this dish
 *   ml: alcohol portion size for promo calculations
 */
(function (root) {
  'use strict';

  var GROUPS = [
    { id: 'food', label: 'Food' },
    { id: 'drinks', label: 'Drinks' },
    { id: 'bar', label: 'Bar' },
  ];

  var CATS = [
    { id: 'breakfast', group: 'food', ru: 'Завтраки', en: 'Breakfasts', hue: 38 },
    { id: 'vareniki', group: 'food', ru: 'Вареники', en: 'Vareniki', hue: 48 },
    { id: 'pot', group: 'food', ru: 'Вареники в горшочках', en: 'Vareniki in a pot', hue: 22 },
    { id: 'sets', group: 'food', ru: 'Наборы вареников', en: 'Vareniki sets', hue: 30 },
    { id: 'sweetvar', group: 'food', ru: 'Сладкие вареники', en: 'Sweet vareniki', hue: 330 },
    { id: 'pelmeni', group: 'food', ru: 'Пельмени', en: 'Pelmeni', hue: 12 },
    { id: 'salads', group: 'food', ru: 'Салаты', en: 'Salads', hue: 110 },
    { id: 'snacks', group: 'food', ru: 'Закуски', en: 'Snacks', hue: 80 },
    { id: 'cheese', group: 'food', ru: 'Сыр', en: 'Cheese', hue: 55 },
    { id: 'soups', group: 'food', ru: 'Супы', en: 'Soups', hue: 0 },
    { id: 'bread', group: 'food', ru: 'Хлеб / выпечка', en: 'Bread / pastry', hue: 34 },
    { id: 'mains', group: 'food', ru: 'Основные блюда', en: 'Main dishes', hue: 350 },
    { id: 'sides', group: 'food', ru: 'Гарниры', en: 'Side dishes', hue: 60 },
    { id: 'desserts', group: 'food', ru: 'Десерты', en: 'Desserts', hue: 300 },
    { id: 'pancakes', group: 'food', ru: 'Блины', en: 'Pancakes', hue: 42 },
    { id: 'extras', group: 'food', ru: 'Добавки / соусы', en: 'Extras / sauces', hue: 200 },

    { id: 'coffee', group: 'drinks', ru: 'Кофе', en: 'Coffee', hue: 25 },
    { id: 'teaberry', group: 'drinks', ru: 'Чай с ягодами и травами', en: 'Tea with berries & herbs', hue: 340 },
    { id: 'tealeaf', group: 'drinks', ru: 'Листовой чай', en: 'Leaf tea', hue: 90 },
    { id: 'morse', group: 'drinks', ru: 'Согревающие морсы', en: 'Warming berry drinks', hue: 355 },
    { id: 'lemonade', group: 'drinks', ru: 'Лимонады / б/а коктейли', en: 'Lemonades / non-alc', hue: 140 },
    { id: 'juice', group: 'drinks', ru: 'Соки / фреши', en: 'Juices / freshes', hue: 30 },
    { id: 'own', group: 'drinks', ru: 'Компоты / морс / кисель', en: 'Compote / kissel / mors', hue: 320 },
    { id: 'soda', group: 'drinks', ru: 'Газ вода / вода', en: 'Soda / water', hue: 195 },
    { id: 'shake', group: 'drinks', ru: 'Молочные коктейли', en: 'Milkshakes', hue: 280 },

    { id: 'beer', group: 'bar', ru: 'Пиво / квас', en: 'Beer / kvass', hue: 45 },
    { id: 'wine', group: 'bar', ru: 'Вино', en: 'Wine', hue: 345 },
    { id: 'cocktails', group: 'bar', ru: 'Коктейли', en: 'Cocktails', hue: 300 },
    { id: 'hotcock', group: 'bar', ru: 'Горячие коктейли', en: 'Hot cocktails', hue: 15 },
    { id: 'shots', group: 'bar', ru: 'Шоты', en: 'Shots', hue: 330 },
    { id: 'vodka', group: 'bar', ru: 'Водка', en: 'Vodka', hue: 210 },
    { id: 'samogon', group: 'bar', ru: 'Самогон', en: 'Moonshine', hue: 35 },
    { id: 'spirits', group: 'bar', ru: 'Джин / ром / виски / коньяк', en: 'Gin / rum / whisky / cognac', hue: 28 },
    { id: 'liqueur', group: 'bar', ru: 'Настойки / ликёры / аперитивы', en: 'Nalewka / liqueur / aperitif', hue: 270 },
  ];

  // ---- Modifiers (extras attached to a dish line) -------------------------
  var MODS = {};
  function mod(group, id, ru, en, price, extra) {
    MODS[id] = Object.assign({ id: id, group: group, ru: ru, en: en, price: price }, extra || {});
  }
  // "Добавки 40 г" — printed on the vareniki page and the salads page.
  // The two lists are identical except: vareniki page has Квашеная капуста,
  // salads page has Маслины. Both are kept.
  mod('savory', 'm_mayo', 'Майонез', 'Mayonnaise', 90);
  mod('savory', 'm_ketchup', 'Кетчуп', 'Ketchup', 80);
  mod('savory', 'm_mustard', 'Горчица', 'Mustard', 60);
  mod('savory', 'm_horseradish', 'Хрен 30 г', 'Horseradish 30 g', 130);
  mod('savory', 'm_smetana', 'Сметана', 'Sour cream', 85);
  mod('savory', 'm_honeymustard', 'Медово-горчичный соус', 'Honey-mustard sauce', 90);
  mod('savory', 'm_tartar', 'Соус тар-тар', 'Tartar sauce', 90);
  mod('savory', 'm_garlicmayo', 'Чесночный майонез', 'Garlic mayonnaise', 100);
  mod('savory', 'm_adjika', 'Аджика', 'Adjika', 160, { spicy: true });
  mod('savory', 'm_sauerkraut', 'Квашеная капуста 100 г', 'Sauerkraut 100 g', 110);
  mod('savory', 'm_friedonion', 'Лук жареный 20 г', 'Fried onion 20 g', 95);
  mod('savory', 'm_olives', 'Маслины', 'Olives', 110);
  mod('savory', 'm_caesar', 'Соус «Цезарь»', '"Caesar" sauce', 100);
  mod('savory', 'm_oliveoil', 'Масло оливковое', 'Olive oil', 110);
  mod('savory', 'm_smetana200', 'Стакан сметаны 200 г', 'Glass of sour cream 200 g', 330);
  // Breakfast "Добавки 50 г"
  mod('breakfast', 'b_tomato', 'Помидоры', 'Fresh tomatoes', 130);
  mod('breakfast', 'b_pepper', 'Перец болгарский', 'Bulgarian pepper', 150);
  mod('breakfast', 'b_mozz', 'Сыр «Моцарелла»', 'Mozzarella', 150);
  mod('breakfast', 'b_sausage', 'Сосиска 70 г', 'Sausage 70 g', 140);
  mod('breakfast', 'b_chicken', 'Куриное филе жареное', 'Fried chicken fillet', 190);
  // Sweet "Добавки 40 г" (sweet vareniki page)
  mod('sweet', 's_condensed', 'Сгущенка', 'Condensed milk', 90);
  mod('sweet', 's_boiledcond', 'Вареная сгущенка', 'Boiled condensed milk', 80);
  mod('sweet', 's_smetana', 'Сметана', 'Sour cream', 85);
  mod('sweet', 's_honey', 'Мед', 'Honey', 70);
  mod('sweet', 's_jam', 'Домашнее варенье', 'Homemade jam', 90);
  mod('sweet', 's_choc', 'Шоколадный соус', 'Chocolate sauce', 110);
  mod('sweet', 's_saltcaramel', 'Соленая карамель', 'Salty caramel', 130);
  mod('sweet', 's_smetana200', 'Стакан сметаны 200 г', 'Glass of sour cream 200 g', 330);
  // Printed recommendations
  mod('podzharka', 'p_meat', 'Мясная поджарка', 'Meat grilled topping', 140);
  mod('podzharka', 'p_mush', 'Грибная поджарка', 'Mushroom grilled topping', 110);
  mod('broth', 'r_broth', 'Куриный бульон 100 г', 'Chicken broth 100 g', 35);
  mod('salo', 'r_salo', 'Сало 30 г', 'Lard 30 g', 110);
  mod('icecream', 'i_straw', 'Мороженое клубничное 50 г', 'Strawberry ice cream', 190);
  mod('icecream', 'i_van', 'Мороженое ванильное 50 г', 'Vanilla ice cream', 190);
  mod('icecream', 'i_choc', 'Мороженое шоколадное 50 г', 'Chocolate ice cream', 190);
  mod('icecream', 'i_pist', 'Мороженое фисташковое 50 г', 'Pistachio ice cream', 190);
  // Tea additives
  mod('tea', 't_ginger', 'Имбирь 10 г', 'Ginger', 50);
  mod('tea', 't_mint', 'Мята 3 г', 'Mint', 40);
  mod('tea', 't_lemon', 'Лимон 20 г', 'Lemon', 50);
  mod('tea', 't_thyme', 'Тимьян 5 г', 'Thyme', 50);
  mod('tea', 't_honey', 'Мед 30 г', 'Honey', 50);
  // Coffee additions (coffee section)
  mod('coffee', 'c_milk', 'Молоко 30 мл', 'Milk', 40);
  mod('coffee', 'c_cream', 'Сливки 30 мл', 'Cream', 50);
  mod('coffee', 'c_syr_van', 'Сироп ваниль 20 мл', 'Syrup vanilla', 45);
  mod('coffee', 'c_syr_hazel', 'Сироп лесной орех 20 мл', 'Syrup hazelnut', 45);
  mod('coffee', 'c_syr_alm', 'Сироп миндаль 20 мл', 'Syrup almond', 45);
  mod('coffee', 'c_syr_coco', 'Сироп кокос 20 мл', 'Syrup coconut', 45);
  mod('coffee', 'c_syr_salt', 'Сироп соленая карамель 20 мл', 'Syrup salted caramel', 45);

  var MOD_GROUPS = [
    { id: 'podzharka', label: 'Поджарка (menu recommends for any vareniki)' },
    { id: 'broth', label: 'Бульон (menu recommends for Siberian & Ural pelmeni)' },
    { id: 'salo', label: 'Сало (menu recommends next to borsch)' },
    { id: 'icecream', label: 'Мороженое (menu: “order with any dessert”)' },
    { id: 'savory', label: 'Sauces / extras 40 г' },
    { id: 'breakfast', label: 'Breakfast extras 50 г' },
    { id: 'sweet', label: 'Sweet extras 40 г' },
    { id: 'tea', label: 'Tea additives' },
    { id: 'coffee', label: 'Milk / cream / syrup' },
  ];

  // ---- Items ---------------------------------------------------------------
  var ITEMS = [];
  function I(cat, id, ru, en, price, w, extra) {
    ITEMS.push(Object.assign({ id: id, cat: cat, ru: ru, en: en, price: price, w: w || '' }, extra || {}));
  }
  function sizes(list) {
    // list: [[id, label, price], ...]
    return { id: 'size', label: 'Size', required: true, choices: list.map(function (s) { return { id: s[0], label: s[1], price: s[2] }; }) };
  }
  function pick(id, label, names, extra) {
    return Object.assign({ id: id, label: label, required: true, choices: names.map(function (n, i) {
      return typeof n === 'string' ? { id: 'c' + i, label: n } : n;
    }) }, extra || {});
  }
  var SAVORY = ['savory'];
  var VAR_MODS = ['podzharka', 'savory'];
  var VAR_SUGGEST = ['p_meat', 'p_mush'];
  var SWEET = ['sweet'];

  // ===== Breakfasts =====
  I('breakfast', 'omelet', 'Омлет с помидорами и сыром', 'Omelet with tomatoes and cheese', 420, '240/35 г', { tags: ['breakfast'], icons: '🍳🍅🧀', mods: ['breakfast'] });
  I('breakfast', 'eggs_saus', 'Глазунья с сосисками', 'Fried eggs with sausages', 490, '250 г', { tags: ['breakfast'], icons: '🍳🌭', mods: ['breakfast'] });
  I('breakfast', 'oatmeal', 'Овсяная каша', 'Oatmeal porridge', 290, '230 г', { tags: ['breakfast', 'new'], icons: '🥣', mods: ['breakfast'] });
  I('breakfast', 'curdballs', 'Жареные творожные шарики с соусом дюшес', 'Fried curd balls with duchess sauce', 520, '160/30 г', { tags: ['breakfast'], icons: '🧆', alsoIn: ['desserts'], mods: SWEET,
    note: 'Same dish is printed on the Breakfast page and the Dessert page.' });
  I('breakfast', 'blini', 'Блины с добавками на выбор', 'Pancakes with toppings to choose', 390, '90/40 г', { tags: ['breakfast'], icons: '🥞', alsoIn: ['pancakes'], mods: SWEET,
    options: [pick('top', 'Topping', ['Мед', 'Сгущенка', 'Вареная сгущенка', 'Шоколадный соус', 'Ванильный соус', 'Карамельный соус', 'Домашнее варенье', 'Сметана'], { multi: true })],
    unverified: 'Menu does not say how many toppings are included in 390 ₽ — ask the kitchen/manager.' });

  // ===== Vareniki (plate) =====
  I('vareniki', 'v_lamb', 'Вареники с томлёной бараниной и запеченным картофелем', 'Vareniki with slow-cooked lamb and roasted potatoes', 690, '210 г', { tags: ['new'], icons: '🐑🥔', form: 'тарелка', mods: VAR_MODS, suggest: VAR_SUGGEST });
  I('vareniki', 'v_spinach', 'Вареники со шпинатом и домашним сыром сулугуни', 'Vareniki with spinach and homemade suluguni cheese', 540, '200 г', { icons: '🌿🧀', form: 'тарелка', mods: VAR_MODS, suggest: VAR_SUGGEST });
  I('vareniki', 'v_belarus', 'Вареники по-белорусски', 'Belarusian vareniki', 460, '200/15 г', { icons: '🥔🧄', form: 'тарелка', desc: 'с картофелем, чесноком и жареным луком', descEn: 'with potatoes, garlic and fried onions', mods: VAR_MODS, suggest: VAR_SUGGEST });
  I('vareniki', 'v_chickmush', 'Вареники с курицей и грибами', 'Vareniki with chicken and mushrooms', 560, '200/15 г', { icons: '🍗🍄', form: 'тарелка', mods: VAR_MODS, suggest: VAR_SUGGEST });
  I('vareniki', 'v_cabchick', 'Вареники с капустой и жареной курицей', 'Vareniki with cabbage and fried chicken', 490, '200/15 г', { icons: '🥬🍗', form: 'тарелка', mods: VAR_MODS, suggest: VAR_SUGGEST });
  I('vareniki', 'v_potmush', 'Вареники с картофелем и грибами', 'Vareniki with potato and mushrooms', 460, '200/15 г', { icons: '🥔🍄', form: 'тарелка', mods: VAR_MODS, suggest: VAR_SUGGEST });
  I('vareniki', 'v_pike', 'Вареники с щукой, подаются с соусом тар-тар', 'Pike vareniki with tartar sauce', 650, '200/40 г', { icons: '🐟', form: 'тарелка', mods: VAR_MODS, suggest: VAR_SUGGEST,
    note: 'Tartar sauce is already included (printed in the name).' });
  I('vareniki', 'v_friedpotcheese', 'Жареные вареники с картофелем и сыром', 'Fried vareniki with potatoes and cheese', 490, '200/15 г', { icons: '🔥🥔🧀', form: 'ЖАРЕНЫЕ', mods: VAR_MODS, suggest: VAR_SUGGEST });
  I('vareniki', 'v_potato', 'Вареники с картофелем', 'Vareniki with potato', 420, '200/15 г', { icons: '🥔', form: 'тарелка', mods: VAR_MODS, suggest: VAR_SUGGEST });

  // ===== Vareniki in pots (поджарка already inside) =====
  I('pot', 'pot_cabchick', 'Вареники с капустой, жареной курицей и грибной поджаркой', 'Vareniki with cabbage, fried chicken and mushroom grilled', 550, '200/30 г', { icons: '🍯🥬🍗🍄', form: 'ГОРШОЧЕК', mods: SAVORY });
  I('pot', 'pot_lamb', 'Вареники с томлёной бараниной, запеченным картофелем и грибной поджаркой', 'Vareniki with slow-cooked lamb, roasted potatoes and sautéed mushrooms', 750, '230 г', { tags: ['new'], icons: '🍯🐑🍄', form: 'ГОРШОЧЕК', mods: SAVORY });
  I('pot', 'pot_potmeat', 'Вареники с картофелем и мясной поджаркой', 'Vareniki with potato and meat grilled', 495, '200/30 г', { icons: '🍯🥔🥩', form: 'ГОРШОЧЕК', mods: SAVORY });
  I('pot', 'pot_belarus', 'Вареники по-белорусски с грибной поджаркой', 'Belarusian vareniki with mushroom grilled', 510, '200/30 г', { icons: '🍯🥔🧄🍄', form: 'ГОРШОЧЕК', desc: 'с картофелем, чесноком и жареным луком', descEn: 'with potatoes, garlic and fried onions', mods: SAVORY });
  I('pot', 'pot_chickmeat', 'Вареники с курицей, грибами и мясной поджаркой', 'Vareniki with chicken, mushrooms and meat grilled', 640, '200/30 г', { icons: '🍯🍗🍄🥩', form: 'ГОРШОЧЕК', mods: SAVORY });
  I('pot', 'pot_potmushmeat', 'Вареники с картофелем, грибами и мясной поджаркой', 'Vareniki with potato, mushrooms and meat grilled', 510, '200/30 г', { icons: '🍯🥔🍄🥩', form: 'ГОРШОЧЕК', mods: SAVORY });

  // ===== Sets =====
  I('sets', 'set_veg', 'Овощной', 'Vegetable set', 680, '410/20 г', { icons: '🥔🍄🥬', form: 'НАБОР',
    desc: 'Вареники с картофелем, вареники с картофелем и грибами, вареники с капустой и грибами',
    descEn: 'Vareniki with potato, with potato & mushrooms, with cabbage & mushroom', mods: VAR_MODS,
    note: '“с капустой и грибами” exists only inside this set — the single plate is “с капустой и жареной курицей”.' });
  I('sets', 'set_sweet', 'Сладкоежка', 'Sweet tooth set', 740, '420 г', { tags: ['pits'], icons: '🍒🍇', form: 'НАБОР',
    desc: 'Вареники с творогом и изюмом, вареники с вишней, вареники маковые с творогом и курагой',
    descEn: 'Vareniki with cottage cheese & raisins, with cherry, poppy seed with dried apricots & cottage cheese', mods: SWEET });
  I('sets', 'set_meat', 'Мясной', 'Meat set', 890, '360/20 г', { icons: '🥩🍗🐑', form: 'НАБОР',
    desc: 'Пельмени сибирские, вареники с курицей и грибами, вареники с томленой бараниной и запеченным картофелем',
    descEn: 'Siberian pelmeni, vareniki with chicken & mushrooms, vareniki with slow-cooked lamb & roasted potatoes', mods: VAR_MODS });

  // ===== Sweet vareniki =====
  I('sweetvar', 'sv_poppy', 'Вареники маковые с творогом и курагой', 'Poppy vareniki with cottage cheese and dried apricots', 440, '200 г', { icons: '⚫🧡', form: 'сладкие', mods: SWEET });
  I('sweetvar', 'sv_raisin', 'Вареники с творогом и изюмом', 'Vareniki with cottage cheese and raisins', 420, '200 г', { icons: '🍇', form: 'сладкие', mods: SWEET });
  I('sweetvar', 'sv_cherry', 'Вареники с вишней', 'Vareniki with cherry', 540, '200 г', { tags: ['pits'], icons: '🍒', form: 'сладкие', mods: SWEET });
  I('sweetvar', 'sv_posik', 'Посикунчики с вишней', 'Posikunchiki with cherries', 450, '160 г', { tags: ['pits'], icons: '🍒⚫', form: 'посикунчики', mods: SWEET });

  // ===== Pelmeni =====
  I('pelmeni', 'pl_shrimp', 'Пельмени с креветками в соусе Том Ям', 'Dumplings with shrimps in Tom Yam sauce', 660, '240 г', { icons: '🦐🌶', form: 'том ям', mods: SAVORY });
  I('pelmeni', 'pl_sib', 'Пельмени сибирские', 'Siberian pelmeni', 640, '200 г', { icons: '🐖🐄🍗', form: 'варёные', desc: 'свинина, говядина, курица', descEn: 'pork, veal, chicken', mods: ['broth', 'savory'], suggest: ['r_broth'] });
  I('pelmeni', 'pl_ural', 'Пельмени уральские с укропом', 'Ural pelmeni', 640, '200 г', { icons: '🐄🐑🍗🌿', form: 'варёные', desc: 'говядина, баранина и курица', descEn: 'veal, lamb and chicken', mods: ['broth', 'savory'], suggest: ['r_broth'] });
  I('pelmeni', 'pl_sibmush', 'Пельмени сибирские в грибном соусе', 'Siberian pelmeni in mushroom sauce', 660, '200/30 г', { icons: '🐖🍄', form: 'грибной соус', desc: 'свинина, говядина, курица', descEn: 'pork, veal, chicken', mods: SAVORY,
    note: 'Bouillon recommendation on the menu is for Siberian & Ural pelmeni — check if it applies to this version too.' });
  I('pelmeni', 'pl_bakedsmet', 'Запеченные сибирские пельмени со сметаной', 'Baked Siberian dumplings with sour cream', 660, '220/40 г', { icons: '🔥🐖🥛', form: 'ЗАПЕЧЁННЫЕ', desc: 'свинина, говядина, курица', descEn: 'pork, veal, chicken', mods: SAVORY,
    note: 'Sour cream is included (printed in the name).' });
  I('pelmeni', 'pl_bakedpepper', 'Запеченные пельмени в перечном соусе', 'Baked pelmeni in pepper sauce', 695, '275 г', { icons: '🔥🐖🌶', form: 'ЗАПЕЧЁННЫЕ', desc: 'свинина, говядина, курица', descEn: 'pork, veal, chicken', mods: SAVORY });

  // ===== Salads =====
  I('salads', 'sl_adyghe', 'Салат с жареным адыгейским сыром и свеклой', 'Salad with grilled Adyghe cheese and beetroot', 670, '210 г', { icons: '🧀🟣', mods: SAVORY });
  I('salads', 'sl_olivier', 'Салат «Оливье советский» с колбасой', 'Salad “Olivier Soviet-style” with sausage', 490, '230 г', { icons: '🥗', mods: SAVORY });
  I('salads', 'sl_mimosa', 'Салат «Мимоза» со скумбрией', 'Salad “Mimosa” with mackerel', 495, '225 г', { icons: '🐟', mods: SAVORY });
  I('salads', 'sl_dacha', 'Дачный салат с маслинами', 'Rustic salad with olives', 480, '160 г', { icons: '🥒🍅', mods: SAVORY });
  I('salads', 'sl_vinegret', 'Салат «Винегрет»', 'Russian salad “Vinegret”', 395, '200/45 г', { icons: '🟣', mods: SAVORY,
    unverified: 'Photo shows herring on bread next to it and weight is 200/45 г — confirm what the 45 г is.' });
  I('salads', 'sl_eggplant', 'Салат с жареными баклажанами и пикантным соусом', 'Fried eggplant salad with spicy sauce', 650, '220 г', { icons: '🍆', mods: SAVORY });
  I('salads', 'sl_shuba', 'Салат «Сельдь под шубой»', 'Salad “Herring under vegetable”', 510, '210 г', { icons: '🐟🟣', mods: SAVORY });
  I('salads', 'sl_caesar', 'Салат «Цезарь» с курицей', '“Caesar” salad with chicken', 660, '250 г', { icons: '🍗🥬', mods: SAVORY });

  // ===== Snacks =====
  I('snacks', 'sn_croutons', 'Чесночные гренки', 'Garlic croutons with sauce', 355, '145/40 г', { icons: '🍞🧄', mods: SAVORY });
  I('snacks', 'sn_pickles', 'Домашние соленья', 'Homemade pickles', 690, '425 г', { icons: '🥒🍅', desc: 'Помидоры, капуста, огурцы, черемша', descEn: 'Tomatoes, cabbage, cucumbers, wild garlic', mods: SAVORY });
  I('snacks', 'sn_beer', 'Пивная тарелка', 'Beer dish', 1390, '470 г', { icons: '🍺', desc: 'Жареные сибирские пельмени, сырные палочки, луковые кольца в кляре, чесночные гренки и чесночный соус', descEn: 'Fried Siberian dumplings, cheese sticks, onion rings, garlic croutons and garlic sauce', mods: SAVORY });
  I('snacks', 'sn_cheesefries', 'Сырные ломтики фри, подаются с медовым соусом и кунжутом', 'Cheese fries served with honey sauce and sesame seeds', 520, '145/40 г', { icons: '🧀🍯', mods: SAVORY });
  I('snacks', 'sn_salo', 'Ассорти из домашнего сала с чесноком и гренками', 'Assorted homemade lard with garlic and croutons', 810, '300 г', { icons: '🥓🧄', mods: SAVORY,
    unverified: 'English line also mentions “squash, cucumbers, wild garlic”, Russian line does not.' });
  I('snacks', 'sn_cheb_cheese', 'Чебуреки с сыром сулугуни и помидорами', 'Cheburek with suluguni cheese', 485, '210/40 г', { icons: '🥟🧀🍅', mods: SAVORY });
  I('snacks', 'sn_cheb_beef', 'Чебуреки с говядиной', 'Cheburek with beef', 595, '200/40 г', { icons: '🥟🐄', mods: SAVORY });
  I('snacks', 'sn_borodino', 'Гренки из бородинского хлеба с сельдью и отварным яйцом', 'Borodino bread croutons with herring and boiled egg', 520, '265 г', { icons: '🍞🐟🥚', mods: SAVORY });

  // ===== Cheese portions =====
  I('cheese', 'ch_parm', 'Пармезан', 'Parmesan', 190, '50 г', { icons: '🧀' });
  I('cheese', 'ch_mozz', 'Моцарелла', 'Mozzarella', 150, '50 г', { icons: '🧀' });
  I('cheese', 'ch_soviet', 'Советский', 'Soviet cheese', 160, '50 г', { icons: '🧀' });

  // ===== Soups =====
  I('soups', 'sp_uha', 'Уха из судака и окуня', 'Pike perch and river perch ear (fish soup)', 640, '385/40 г', { tags: ['bones'], icons: '🐟', mods: SAVORY });
  I('soups', 'sp_solyanka', 'Солянка мясная', 'Solyanka', 560, '310 г', { icons: '🥩🍋', mods: SAVORY });
  I('soups', 'sp_broth', 'Куриный бульон с домашней лапшой', 'Chicken bouillon with homemade noodles', 490, '300 г', { icons: '🍗🍜', mods: SAVORY });
  I('soups', 'sp_borsch', 'Традиционный борщ с пампушками', 'Traditional borsch with pampushki', 595, '350/80/20 г', { icons: '🟥🥖', mods: ['salo', 'savory'], suggest: ['r_salo'] });

  // ===== Bread / pastry =====
  I('bread', 'br_pie_cab', 'Пирожки с капустой (2 шт.)', 'Pies with cabbage (2 pieces)', 165, '100 г', { icons: '🥟🥬' });
  I('bread', 'br_pie_meat', 'Пирожки с мясом (2 шт.)', 'Pies with meat (2 pieces)', 250, '100 г', { icons: '🥟🥩' });
  I('bread', 'br_pampushki', 'Пампушки с чесночным соусом', 'Pampushki with garlic sauce', 145, '80/20 г', { icons: '🥖🧄' });
  I('bread', 'br_basket', 'Хлебная корзина (4 куска)', 'Bread basket (4 pieces)', 95, '', { icons: '🍞',
    options: [sizes([['std', 'Стандарт 70 г', 95], ['black', 'Черная 90 г', 140], ['white', 'Белая 70 г', 95]])] });

  // ===== Main dishes =====
  var SWAP = true;
  I('mains', 'mn_fillet', 'Куриное филе под нежной сырной шубкой', 'Chicken fillet under a delicate cheese coat', 660, '320 г', { icons: '🍗🧀', mods: SAVORY });
  I('mains', 'mn_legs', 'Жареные куриные ножки с картофелем под сыром', 'Fried chicken legs with potatoes and cheese', 670, '350 г', { icons: '🍗🥔', mods: SAVORY, side: { name: 'картофель под сыром', swap: SWAP } });
  I('mains', 'mn_sudak', 'Жареный судак с картофельным пюре', 'Fried pike perch with mashed potatoes', 890, '250 г', { icons: '🐟🥔', mods: SAVORY, side: { name: 'картофельное пюре', swap: SWAP } });
  I('mains', 'mn_pork', 'Жареная свиная вырезка с картофелем по-деревенски', 'Roast pork tenderloin with potato wedges', 820, '330 г', { icons: '🐖🥔', mods: SAVORY, side: { name: 'картофель по-деревенски', swap: SWAP } });
  I('mains', 'mn_perlovka', 'Перловка с томлёной говядиной', 'Pearl barley with slow-cooked beef', 850, '300 г', { tags: ['new'], icons: '🍯🐄', mods: SAVORY });
  I('mains', 'mn_cutlets', 'Котлеты по-домашнему с макаронами в укропе', 'Homemade cutlets with pasta in dill', 595, '230 г', { icons: '🥩🍝', mods: SAVORY, side: { name: 'макароны в укропе', swap: SWAP } });
  I('mains', 'mn_kiev', 'Котлета по-киевски', 'Chicken Kiev', 690, '150/120/20/20 г', { icons: '🍗🧈', mods: SAVORY, sideUnknown: true });
  I('mains', 'mn_friedpot', 'Жареный картофель с луком и грибами', 'Fried potatoes with onions and mushrooms', 465, '220 г', { icons: '🥔🍄', mods: SAVORY });
  I('mains', 'mn_pikecut', 'Щучьи котлеты с овощным пюре «Оливье»', 'Pike cutlets with vegetable puree', 685, '300 г', { icons: '🐟', mods: SAVORY, side: { name: 'овощное пюре «Оливье»', swap: SWAP } });
  I('mains', 'mn_friedpotpork', 'Жареный картофель со свиной вырезкой и грибами', 'Fried potatoes with pork tenderloin and mushrooms', 640, '220 г', { icons: '🥔🐖🍄', mods: SAVORY });
  I('mains', 'mn_liver', 'Запеканка из куриной печени', 'Chicken liver casserole', 750, '255 г', { tags: ['new'], icons: '🍗', mods: SAVORY });
  I('mains', 'mn_chickcut', 'Котлеты куриные с сыром', 'Chicken cutlets with cheese', 570, '110/120/20 г', { icons: '🍗🧀', mods: SAVORY, sideUnknown: true });
  I('mains', 'mn_zucchini', 'Драники из кабачков с куриным филе и соусом из шампиньонов', 'Zucchini pancakes with chicken fillet and champignon sauce', 740, '260 г', { icons: '🥒🍗🍄', mods: SAVORY });
  I('mains', 'mn_draniki', 'Картофельные драники', 'Potato draniki', 390, '185 г', { tags: ['new'], icons: '🥔', mods: SAVORY });

  // ===== Sides (ordered separately) =====
  I('sides', 'sd_rice', 'Рис с овощами', 'Rice with vegetables', 230, '150 г', { icons: '🍚' });
  I('sides', 'sd_mash', 'Картофельное пюре', 'Mashed potatoes', 210, '150 г', { icons: '🥔' });
  I('sides', 'sd_wedges', 'Картофель по-деревенски', 'Potatoes in a rustic style', 220, '150 г', { icons: '🥔' });
  I('sides', 'sd_buckwheat', 'Каша гречневая с грибами', 'Buckwheat porridge with mushrooms', 230, '150 г', { icons: '🌾🍄' });

  // ===== Desserts =====
  I('desserts', 'ds_medovik', 'Настоящий медовик', 'Traditional honey cake', 480, '110 г', { tags: ['new'], icons: '🍯🍰', mods: ['icecream'], suggest: ['i_van'] });
  I('desserts', 'ds_horn', 'Слоеные трубочки со сливочным кремом', 'Cream horn', 375, '100 г', { icons: '🥐', mods: ['icecream'], unverified: 'Weight hard to read on photo (looks like 100 г).' });
  I('desserts', 'ds_ptichka', 'Торт суфле «Птичка»', 'Birdie soufflé cake', 520, '110 г', { tags: ['new'], icons: '🍫🍰', mods: ['icecream'] });
  I('desserts', 'ds_smetannik', 'Бабушкин сметанник с вишней', 'Grandma’s sour cream cake with cherry', 530, '180 г', { icons: '🍒🍰', mods: ['icecream'] });
  I('desserts', 'ds_cheesecake', 'Маковый чизкейк', 'Poppy seed cheesecake', 495, '160 г', { icons: '⚫🍰', mods: ['icecream'] });
  I('desserts', 'ds_icecream', 'Мороженое на выбор', 'Ice cream of your choice', 190, '50 г', { icons: '🍨',
    options: [pick('flavor', 'Flavor', ['Клубничное', 'Ванильное', 'Шоколадное', 'Фисташковое'])] });

  // ===== Pancakes =====
  I('pancakes', 'pc_cherry', 'Блины с творогом, вишней и соленой карамелью', 'Pancakes with cottage cheese, cherries and salted caramel', 450, '180 г', { icons: '🥞🍒', mods: SWEET });

  // ===== Extras as standalone lines (sauce for the table etc.) =====
  Object.keys(MODS).forEach(function (k) {
    var m = MODS[k];
    if (m.group === 'savory' || m.group === 'sweet' || m.group === 'breakfast') {
      I('extras', 'x_' + m.id, m.ru, m.en + ' (separate)', m.price, m.group === 'breakfast' ? '50 г' : '40 г',
        { icons: m.group === 'sweet' ? '🍯' : '🥫', tags: m.spicy ? ['spicy'] : undefined, isExtra: true,
          note: m.group === 'breakfast' ? 'Printed as breakfast additive.' : undefined });
    }
  });

  // ===== Coffee =====
  var COFFEE = ['coffee'];
  I('coffee', 'cf_espresso', 'Эспрессо', 'Espresso', 195, '30 мл', { icons: '☕', mods: COFFEE });
  I('coffee', 'cf_doubleesp', 'Двойной эспрессо', 'Double espresso', 295, '60 мл', { icons: '☕☕', mods: COFFEE });
  I('coffee', 'cf_americano', 'Американо', 'Americano', 215, '150 мл', { icons: '☕', mods: COFFEE });
  I('coffee', 'cf_capp', 'Капучино', 'Cappuccino', 275, '200 мл', { icons: '☕🥛', mods: COFFEE });
  I('coffee', 'cf_doublecapp', 'Двойной капучино', 'Double cappuccino', 490, '400 мл', { icons: '☕🥛', mods: COFFEE,
    unverified: 'Price column on photo is not aligned with names — 400 мл/490 ₽ is the best reading.' });
  var COFFEE_ALIGN = 'Price column on the coffee photo is misaligned; this pairing is the best reading — check once.';
  I('coffee', 'cf_latte', 'Латте', 'Latte', 280, '200 мл', { icons: '☕🥛', mods: COFFEE, unverified: COFFEE_ALIGN });
  I('coffee', 'cf_hotchoc', 'Горячий шоколад', 'Hot chocolate', 310, '125 мл', { icons: '🍫', mods: COFFEE, unverified: COFFEE_ALIGN });
  I('coffee', 'cf_mishka', 'Мишка на севере', 'Mishka in the north', 350, '200 мл', { icons: '🐻☕', desc: 'Эспрессо, сливки, молоко, шоколад, топпинг карамель', descEn: 'Espresso, cream, milk, chocolate, topping caramel', mods: COFFEE, unverified: COFFEE_ALIGN });
  I('coffee', 'cf_snickers', 'Сникерс', 'Snickers', 350, '200 мл', { icons: '🥜☕', desc: 'Эспрессо, сливки, молоко, арахисовая паста, сироп соленая карамель', descEn: 'Espresso, cream, milk, peanut butter, salted caramel syrup', mods: COFFEE });
  I('coffee', 'cf_drummer', 'Сырный ударник', 'Cheese drummer', 350, '200 мл', { icons: '🧀☕', desc: 'Эспрессо, сливки, молоко, сырная основа, мед', descEn: 'Espresso, cream, milk, cheese base, honey', mods: COFFEE, unverified: COFFEE_ALIGN });
  I('coffee', 'cf_cacao', 'Какао', 'Cacao', 280, '200 мл', { icons: '🍫🥛', mods: COFFEE, unverified: COFFEE_ALIGN });
  I('coffee', 'cf_coco_capp', 'Капучино', 'Cappuccino on coconut milk', 330, '200 мл', { icons: '🥥☕', mods: COFFEE });
  I('coffee', 'cf_coco_latte', 'Латте', 'Latte on coconut milk', 330, '200 мл', { icons: '🥥☕', mods: COFFEE });

  // ===== Tea with berries & herbs (400 мл) =====
  var TEA = ['tea'];
  function TB(id, ru, en, desc, descEn) { I('teaberry', id, ru, en, 420, '400 мл', { icons: '🫖', desc: desc, descEn: descEn, mods: TEA }); }
  TB('tb_grandma', 'Бабушкин чай', 'Grandma’s tea', 'Черный чай, земляничное и малиновое пюре, лимон, апельсин, малиновый сироп', 'Black tea, strawberry and raspberry puree, lemon, orange, raspberry syrup');
  TB('tb_ginger', 'Имбирно-облепиховый', 'Ginger-sea-buckthorn', 'Облепиховое пюре, имбирь, черный чай', 'Sea-buckthorn puree, ginger, black tea');
  TB('tb_bergamot', 'Бергамот с малиной и мятой', 'Bergamot with raspberries and mint', 'Эрл Грей, малиновое пюре собственного приготовления, сироп из ежевики, мята, цедра апельсина', 'Earl Grey, home-made raspberry puree, blackberry syrup, mint, orange zest');
  TB('tb_strawberry', 'Земляничный с красной смородиной', 'Strawberry and red currant', 'Пюре из ягод земляники и красной смородины, апельсин, ассам', 'Puree of strawberries and red currants, orange, assam');
  TB('tb_lingon', 'Брусничный с травами', 'Lingonberry with herbs', 'Бруснично-медовое пюре, тимьян, иван чай, бадьян', 'Lingonberry honey puree, thyme, ivan tea, badyan');
  TB('tb_mulled', 'Безалкогольный глинтвейн', 'Non-alcoholic mulled wine', 'Каркаде, яблоко, лимон, апельсин, мед, специи, вишневый сок', 'Hibiscus, apple, lemon, orange, honey, spices, cherry juice');
  TB('tb_lavender', 'Лаванда - Черная смородина', 'Lavender - Black currant', 'Сушеная лаванда, пюре из черной смородины, сироп', 'Dried lavender, blackcurrant puree, syrup');
  TB('tb_altai', 'Алтайский успокаивающий', 'Altai soothing', 'Шиповник сушеный, тимьян, мята, листья смородины, сироп из крапивы, цедра апельсина, травяной сбор', 'Dried rosehip, thyme, mint, currant leaves, nettle syrup, orange peel, herbal collection');

  // ===== Leaf tea (400 мл, 299) =====
  [['Ассам', 'Assam'], ['Сенча', 'Sencha'], ['С бергамотом', 'With bergamot'], ['Жасминовый', 'Jasmine'], ['Травяной', 'Herbal'],
    ['Ромашка', 'Chamomile'], ['Липа', 'Lipa (linden)'], ['Лесные ягоды', 'Berries'], ['Мятный', 'Minty'], ['Молочный Улун', 'Milk Oolong'],
    ['Каркаде', 'Karkade (hibiscus)'], ['Иван-чай', 'Ivan-tea']].forEach(function (t, i) {
    I('tealeaf', 'tl_' + i, t[0], 'Leaf tea ' + t[1], 299, '400 мл', { icons: '🍵', mods: TEA, short: t[0] });
  });

  // ===== Warming berry drinks (200 мл, 260) =====
  I('morse', 'mr_mandarin', 'Мандариновый с корицей', 'Mandarin orange with cinnamon (warm)', 260, '200 мл', { icons: '🍊🔥', desc: 'Пюре из плодов мандарина, апельсин, корица', descEn: 'Puree of mandarin oranges, orange, cinnamon' });
  I('morse', 'mr_currant', 'Смородина-мята-лимон', 'Currant-mint-lemon (warm)', 260, '200 мл', { icons: '⚫🌿🔥', desc: 'Пюре из черной смородины, лимон, мята', descEn: 'Mashed black currant, lemon, mint' });
  I('morse', 'mr_lingon', 'Брусника-черника', 'Lingonberry-blueberry (warm)', 260, '200 мл', { icons: '🫐🔥', desc: 'Брусничное пюре, сироп из ягод черники, апельсин, тимьян', descEn: 'Lingonberry puree, blueberry syrup, orange, thyme' });

  // ===== Lemonades / non-alc cocktails =====
  var LEM = sizes([['350', '350 мл', 295], ['1000', '1 л', 795]]);
  I('lemonade', 'lm_rasp', 'Малина-мандарин', 'Raspberry-tangerine lemonade', 295, '350/1000 мл', { icons: '🍋🍊', options: [LEM], desc: 'Пюре из плодов мандаринов и малины, газ вода, сироп, лимон', descEn: 'Tangerines & raspberries puree, sparkling water, syrup, lemon' });
  I('lemonade', 'lm_tarragon', 'Яблочный тархун', 'Apple tarragon lemonade', 295, '350/1000 мл', { icons: '🍋🍏', options: [LEM], desc: 'Тархун, яблочное пюре, лимон, газ вода', descEn: 'Homemade tarragon syrup, sour apple syrup, lemon juice, sparkling water, ice' });
  I('lemonade', 'lm_peach', 'Персик-клубника', 'Peach-strawberry lemonade', 295, '350/1000 мл', { icons: '🍋🍑🍓', options: [LEM], desc: 'Клубничное пюре, персиковый конфитюр, сок лимона, сироп клубника, газ вода, лед', descEn: 'Strawberry puree, peach jam, lemon juice, strawberry syrup, sparkling water, ice' });
  I('lemonade', 'lm_passion', 'Маракуйя-груша', 'Passion fruit-pear lemonade', 295, '350/1000 мл', { icons: '🍋🍐', options: [LEM], desc: 'Пюре из плодов маракуйи, дюшес, лимон', descEn: 'Passion fruit puree, duchess, lemon' });
  I('lemonade', 'lm_mojito', 'Мохито', 'Mojito (NON-alcoholic)', 360, '350 мл', { icons: '🌿🚫🍸', form: 'БЕЗ АЛКОГОЛЯ', desc: 'Лайм, мята, сахарный сироп, содовая, лед', descEn: 'Lime, mint, soda, sugar syrup, ice', alias: ['мохито'] });
  I('lemonade', 'lm_mojito_rasp', 'Мохито малиновый', 'Raspberry mojito (non-alc)', 395, '350 мл', { icons: '🌿🍓🚫', form: 'БЕЗ АЛКОГОЛЯ', desc: 'Лайм, мята, сироп и пюре из малины, газ вода, лед', descEn: 'Lime, mint, raspberry syrup and puree, sparkling water, ice' });
  I('lemonade', 'lm_mojito_cur', 'Мохито на черной смородине', 'Black currant mojito (non-alc)', 395, '350 мл', { icons: '🌿⚫🚫', form: 'БЕЗ АЛКОГОЛЯ', desc: 'Лайм, мята, пюре черной смородины, сироп, газ вода, лед', descEn: 'Lime, mint, blackcurrant puree, syrup, sparkling water, ice' });

  // ===== Juices / freshes =====
  var JUICE = sizes([['200', '200 мл', 195], ['1000', '1 л', 820]]);
  [['orange', 'Апельсиновый', 'Orange', '🍊'], ['pine', 'Ананасовый', 'Pineapple', '🍍'], ['cherry', 'Вишневый', 'Cherry', '🍒'],
    ['tomato', 'Томатный', 'Tomato', '🍅'], ['apple', 'Яблочный', 'Apple', '🍏']].forEach(function (j) {
    I('juice', 'jc_' + j[0], 'Сок ' + j[1], j[2] + ' juice', 195, '200/1000 мл', { icons: '🧃' + j[3], options: [JUICE] });
  });
  I('juice', 'jc_3l', 'Сок 3 л (трехлитровая банка)', 'Juice 3 L (three-litre jar)', 990, '3000 мл', { icons: '🫙', options: [pick('kind', 'Kind', ['Яблочный', 'Томатный'])] });
  I('juice', 'fr_apple', 'Фреш яблочный', 'Apple fresh', 430, '200 мл', { icons: '🍏✨' });
  I('juice', 'fr_carrot', 'Фреш морковный', 'Carrot fresh', 330, '200 мл', { icons: '🥕✨' });
  I('juice', 'fr_orange', 'Фреш апельсиновый', 'Orange fresh', 430, '200 мл', { icons: '🍊✨' });
  I('juice', 'fr_grapefruit', 'Фреш грейпфрутовый', 'Grapefruit fresh', 430, '200 мл', { icons: '🍊✨' });

  // ===== Own production =====
  I('own', 'ow_dried', 'Компот из сухофруктов', 'Dried fruits compote', 195, '200/1000 мл', { icons: '🍑', options: [sizes([['200', '200 мл', 195], ['1000', '1 л', 695]])] });
  I('own', 'ow_kissel', 'Кисель вишневый', 'Cherry kissel', 195, '200 мл', { icons: '🍒' });
  I('own', 'ow_berry', 'Компот ягодный', 'Berry compote', 195, '200/1000 мл', { icons: '🫐', options: [sizes([['200', '200 мл', 195], ['1000', '1 л', 695]])] });
  I('own', 'ow_cranberry', 'Морс клюквенный', 'Cranberry mors', 220, '200/1000 мл', { icons: '🔴', options: [sizes([['200', '200 мл', 220], ['1000', '1 л', 895]])] });

  // ===== Soda / water =====
  I('soda', 'so_machine', 'Газ вода из аппарата', 'Soda water from the machine', 195, '200/350/1000 мл', { icons: '🥤',
    options: [pick('flavor', 'Flavor', ['Дюшес', 'Тархун', 'Кола']), sizes([['200', '200 мл', 195], ['350', '350 мл', 280], ['1000', '1 л', 695]])] });
  I('soda', 'wt_narzan', 'Нарзан', 'Narzan', 350, '450 мл', { icons: '💧', options: [pick('gas', 'Gas', ['Газированный', 'Природной газации'])] });
  I('soda', 'wt_volzh', 'Волжанка', 'Volzhanka', 295, '330 мл', { icons: '💧', options: [pick('gas', 'Gas', ['С газом', 'Без газа'])] });
  I('soda', 'wt_baikal', 'Легенда Байкала', 'The Legend of Baikal', 390, '330/750 мл', { icons: '💧',
    options: [pick('gas', 'Gas', ['С газом', 'Без газа']), sizes([['330', '330 мл', 390], ['750', '750 мл', 690]])] });

  // ===== Milkshakes =====
  I('shake', 'sh_soviet', '«Советские традиции» с крем-брюле', '“Soviet traditions” with crème brûlée', 470, '350 мл', { icons: '🥛🍮', desc: 'Ванильное мороженое, молоко, сироп крем-брюле, черная смородина, зефир', descEn: 'Vanilla ice cream, milk, crème brûlée syrup, blackcurrant, marshmallow' });
  I('shake', 'sh_13', 'Молочный коктейль «13 копеек»', '“13 cents” milkshake', 370, '300 мл', { icons: '🥛', desc: 'Молоко, мороженое и сироп на выбор', descEn: 'Milk, ice cream and syrup',
    options: [sizes([['classic', 'Классический', 370], ['straw', 'Клубничный', 380]])] });
  I('shake', 'sh_key', '«Золотой ключик»', '“The Golden Key” milkshake', 390, '300 мл', { icons: '🥛🔑', desc: 'Ванильное мороженое, молоко, сироп ириска', descEn: 'Vanilla ice cream, milk, toffee syrup' });

  // ===== Beer / kvass =====
  function BEER(id, ru, en, small, big, extra) {
    I('beer', id, ru, en, small[1], small[0] + '/' + big[0] + ' мл', Object.assign({ icons: '🍺', tags: ['alc'],
      options: [sizes([[String(small[0]), small[0] + ' мл', small[1]], [String(big[0]), big[0] + ' мл', big[1]]])] }, extra || {}));
  }
  BEER('br_kvass', 'Квас домашний пьяный', 'Kvass homemade drunk (alcoholic)', [350, 250], [1000, 650], { icons: '🍺🍞' });
  I('beer', 'br_honey', 'Медовое пиво (собственного приготовления)', 'Honey beer (own production)', 550, '500 мл', { icons: '🍺🍯', tags: ['alc'] });
  BEER('br_lowdunkel', 'Ловенбрау Дункель', 'Löwenbräu Dunkel (dark)', [330, 360], [500, 560], { icons: '🍺🟤' });
  BEER('br_lowlight', 'Ловенбрау Светлое', 'Löwenbräu Light', [330, 360], [500, 560], { icons: '🍺🟡' });
  BEER('br_sibunf', 'Сибирская корона нефильтрованное', 'Siberian Crown non-filtered', [300, 350], [500, 550], { icons: '🍺🌫' });
  BEER('br_siblight', 'Сибирская корона светлое', 'Siberian Crown light', [300, 340], [500, 540], { icons: '🍺🟡' });
  I('beer', 'br_stella0', 'Стелла Артуа б/а (бутылка)', 'Stella Artois NON-alcoholic (bottle)', 520, '440 мл', { icons: '🍾🚫', form: 'БЕЗ АЛКОГОЛЯ' });
  I('beer', 'br_bud', 'Bud (бутылка)', 'Bud (bottle)', 390, '330 мл', { icons: '🍾', tags: ['alc'] });

  // ===== Wine =====
  function WINE(id, ru, en, glass, bottle, icons, extra) {
    I('wine', id, ru, en, glass, '125/750 мл', Object.assign({ icons: icons, tags: ['alc'],
      options: [sizes([['125', 'Бокал 125 мл', glass], ['750', 'Бутылка 750 мл', bottle]])] }, extra || {}));
  }
  WINE('wn_rosebrut', 'Шато Тамань Розе Брют (Россия) сухое', 'Chateau Tamagne Rose Brut (sparkling)', 440, 2640, '🍾🌸',
    { unverified: 'Russian says “сухое”, English says “demi sweet”.' });
  WINE('wn_blancbrut', 'Шато Тамань Селект Блан Брют (Россия) сухое', 'Chateau Tamagne Select Blanc Brut (sparkling, dry)', 440, 2640, '🍾⚪');
  I('wine', 'wn_mezhbrut', 'Междуморье Брют (Россия)', 'Mezhdumorie Brut (sparkling)', 2990, '750 мл', { icons: '🍾', tags: ['alc'], form: 'только бутылка' });
  WINE('wn_chardbianca', 'Макитра Шардоне-Бианка (Россия) сухое', 'Macitre Chardonnay-Bianca (white, dry)', 390, 2340, '🍷⚪');
  WINE('wn_riesling', 'Междуморье Рислинг (Россия) сухое', 'Mezhdumorie Riesling (white, dry)', 490, 2940, '🍷⚪');
  WINE('wn_selblanc', 'Шато Тамань Селект Блан (Россия) сухое', 'Chateau Tamagne Select Blanc (white, dry)', 440, 2640, '🍷⚪');
  WINE('wn_sauv', 'Коно Сур Совиньон Блан (Чили) полусухое', 'Cono Sur Sauvignon Blanc (white, Chile)', 550, 3300, '🍷⚪',
    { unverified: 'Russian says “полусухое”, English says “dry”.' });
  WINE('wn_pinot', 'Пино Гриджио Анима (Россия) сухое', 'Pinot Grigio Anima (white, dry)', 550, 3300, '🍷⚪');
  WINE('wn_selrose', 'Шато Тамань Селект Розе (Россия) сухое', 'Chateau Tamagne Select Rose (rosé, dry)', 440, 2640, '🍷🌸');
  WINE('wn_cabernet', 'Макитра Каберне Совиньон (Россия) сухое', 'Macitre Cabernet Sauvignon (red, dry)', 390, 2340, '🍷🔴');
  WINE('wn_kindz', 'Киндзмараули Дугладзе (Грузия) полусладкое', 'Kindzmarauli Dugladze (red, semi-sweet)', 550, 3300, '🍷🔴');
  WINE('wn_saperavi', 'Саперави Дугладзе (Грузия) сухое', 'Saperavi Dugladze (red, dry)', 520, 3120, '🍷🔴');
  WINE('wn_selrouge', 'Шато Тамань Селект Руж (Россия) сухое', 'Chateau Tamagne Select Rouge (red, dry)', 440, 2640, '🍷🔴');
  WINE('wn_carmenere', 'Коно Сур Карменер (Чили) полусухое', 'Cono Sur Carmenere (red, semi-dry)', 490, 2940, '🍷🔴');
  I('wine', 'wn_house', 'Домашнее вино', 'Homemade wine', 350, '125/500 мл', { icons: '🍷🏠', tags: ['alc'],
    options: [pick('color', 'Color', ['Белое', 'Красное']), sizes([['125', '125 мл', 350], ['500', '500 мл', 1350]])] });
  I('wine', 'wn_fruit', 'Плодовое вино (Армения) полусладкое', 'Fruit wine semi-sweet (Armenia)', 450, '125/750 мл', { icons: '🍷🫐', tags: ['alc'],
    options: [pick('kind', 'Kind', ['Ежевичное', 'Гранатовое']), sizes([['125', 'Бокал 125 мл', 450], ['750', 'Бутылка 750 мл', 2700]])] });
  I('wine', 'wn_port', 'Массандра. Портвейн красный Ливадия', 'Massandra red port wine Livadia', 450, '75 мл', { icons: '🍷', tags: ['alc'] });

  // ===== Cocktails =====
  function CK(id, ru, en, price, vol, desc, extra) { I('cocktails', id, ru, en, price, vol, Object.assign({ icons: '🍸', tags: ['alc'], desc: desc }, extra || {})); }
  CK('ck_var1', '«Вареничная №1»', '“Varenichnaya №1”', 580, '300 мл', 'Аперетив из дикой малины, Белуга ботаникалс, мандариновое пюре, игристое вино, газ вода, апельсин');
  CK('ck_artek', 'Артек', 'Artek', 550, '300 мл', 'Ежевичное вино, малиновый аперетив, сироп из ягод черники, лимон, апельсин, корица');
  CK('ck_passion', 'Лонг Пэшн Фрут', 'Long Passion fruit', 495, '350 мл', 'Джин, дынный ликер, пюре маракуйи, сок лимона, имбирь, сироп, газ вода');
  CK('ck_mimino', 'Мимино', 'Mimino', 495, '300 мл', 'Аперитив на основе фейхоа и эстрагона, джин, тархун, лимон');
  CK('ck_spritz', 'Аперитиво Спритц', 'Aperitivo Spritz', 550, '300 мл', 'Лигаре аперитиво, игристое вино, газ вода, апельсин');
  CK('ck_negroni', 'Город Горький (Негрони)', 'Negroni', 550, '200 мл', 'Джин, красный вермут, кампари, цедра апельсина');
  CK('ck_mojito', 'Мохито', 'Mojito (WITH rum)', 550, '400 мл', 'Светлый ром, лайм, мята, сироп, содовая', { icons: '🌿🍸🥃', form: 'С РОМОМ', alias: ['мохито'] });
  CK('ck_spiv', 'Мечта фарцовщика', 'Spivs dream', 550, '300 мл', 'Виски, аперитив на основе манго и хурмы, дюшес, лимон');
  CK('ck_longisland', 'Лонг Айленд', 'Long Island', 650, '400 мл', 'Водка, светлый ром, текила, апельсиновый ликер, джин, кола, лимон');
  CK('ck_evmoscow', 'Вечерняя Москва', 'Evening Moscow', 520, '300 мл', 'Ром, миндальный ликер, вишневый сок, сиропы из корицы и яблока, сок лимона');
  CK('ck_rumcola', 'Ром-кола / Виски-кола', 'Rum-Cola / Whiskey-Cola', 440, '200 мл', '', { options: [pick('base', 'Base', ['Ром-кола', 'Виски-кола'])] });

  // ===== Hot cocktails (200 мл) =====
  function HC(id, ru, en, price, desc) { I('hotcock', id, ru, en, price, '200 мл', { icons: '🔥🍷', tags: ['alc'], desc: desc }); }
  HC('hc_seabuck', 'Облепиховый глинтвейн', 'Sea buckthorn mulled wine', 450, 'Белое вино, апельсиновый ликер, облепиховое пюре, сироп манго, апельсин, корица, гвоздика, цедра лимона');
  HC('hc_hunter', 'Глинтвейн Охотничий', 'Mulled Hunters Wine', 490, 'Ликер Белуга Ягодный, красное вино, мед, чернослив, апельсин, корица');
  HC('hc_tangerine', 'Мандариновый глинтвейн', 'Tangerine mulled wine', 490, 'Белое вино, мандариновое пюре, аперетив на основе хурмы и манго, специи, апельсин');
  HC('hc_peach', 'Горячее персиковое вино', 'Hot peach wine', 490, 'Персиковый конфитюр, белое вино, специи, апельсин, лимон');
  HC('hc_pomegranate', 'Гранатовый глинтвейн', 'Pomegranate mulled wine', 490, 'Гранатовое вино, апельсин, специи');
  HC('hc_classic', 'Глинтвейн', 'Mulled wine (classic, red)', 450, 'Красное вино, цедра апельсина, курага, мед, корица, гвоздика');

  // ===== Shots =====
  I('shots', 'st_berry', 'С ягодой / фруктом на выбор', 'Cocktail shot (berry/fruit)', 255, '40 мл', { icons: '🥃', tags: ['alc'],
    options: [pick('flavor', 'Flavor', ['Брусника', 'Облепиха', 'Малина', 'Смородина', 'Клюква', 'Вишня', 'Персик', 'Мандарин'])] });
  I('shots', 'st_horse', 'С ароматным хреном', 'Shot with horseradish', 275, '40 мл', { icons: '🥃🌶', tags: ['alc'] });
  I('shots', 'st_set', 'Дегустационный сет — 5 любых шотов', 'Tasting set — 5 any shots', 1100, '5×40 мл', { icons: '🥃×5', tags: ['alc'],
    options: [pick('flavor', 'Choose 5', ['Брусника', 'Облепиха', 'Малина', 'Смородина', 'Клюква', 'Вишня', 'Персик', 'Мандарин', 'Хрен'], { multi: true, want: 5 })],
    unverified: 'Menu has a “**” footnote on this set that is not legible on the photo.' });

  // ===== Vodka (40 мл) =====
  function VD(id, ru, en, price) { I('vodka', id, ru, en, price, '40 мл', { icons: '🥃', tags: ['alc'], ml: 40, vodka: true }); }
  VD('vd_myagkov', 'Мягков', 'Myagkov', 245);
  VD('vd_arkh', 'Архангельская Северная выдержка', 'Arkhangelsk Northern excerpt', 265);
  VD('vd_orthodox', 'Ортодокс', 'Orthodox', 295);
  VD('vd_belnoble', 'Белуга Нобл', 'Beluga Noble', 365);
  VD('vd_beltrans', 'Белуга Трансатлантик', 'Beluga Transatlantic', 405);

  // ===== Moonshine (40 мл, 295) =====
  [['apricot', 'Абрикосовый', 'with apricot'], ['mulberry', 'Тутовый', 'with mulberry'], ['no3', '№3', '№3'],
    ['no2', '№2 (Пшеница)', 'No. 2 (Wheat)'], ['grape', 'Виноградный', 'Grape']].forEach(function (s) {
    I('samogon', 'sm_' + s[0], 'Косогоров самогон ' + s[1], 'Kosogorov samogon ' + s[2], 295, '40 мл', { icons: '🥃', tags: ['alc'] });
  });
  I('samogon', 'sm_kit', 'Набор Самогонщика', 'Moonshiner’s Kit', 1295, '200 мл', { icons: '🥃×', tags: ['alc'], unverified: 'Composition of the kit is not printed.' });

  // ===== Gin / rum / tequila / whisky / cognac =====
  function SP(id, ru, en, price, extra) { I('spirits', id, ru, en, price, '40 мл', Object.assign({ icons: '🥃', tags: ['alc'] }, extra || {})); }
  SP('gn_baboon', 'Грин Бабун', 'Gin GreenBaboon', 250);
  SP('gn_ginster', 'Джинстер пломбир', 'Ginger sundae (gin)', 330);
  SP('rm_puntacana', 'Пунтакана Клаб Сильвер/Вьехо', 'Punta Cana Club rum', 470, { options: [pick('kind', 'Kind', ['Сильвер', 'Вьехо'])] });
  SP('rm_devils', 'Девилс Айленд Спайсед', 'Devils Island Spiced rum', 390);
  var TEQ = 'Price is cut off on the photo — fill it in (Menu tab → edit).';
  SP('tq_silver', 'Де Лос Дорадос Сильвер', 'Tequila De Los Dorados Silver', null, { unverified: TEQ });
  SP('tq_gold', 'Де Лос Дорадос Голд', 'Tequila De Los Dorados Gold', null, { unverified: TEQ });
  var WSK = 'Price partly cut off on both photos — best reading, please confirm.';
  SP('wk_jack', 'Джек Дэниелс', 'Jack Daniels', 550, { unverified: WSK });
  SP('wk_jameson', 'Джемесон', 'Jameson', 560, { unverified: WSK });
  SP('wk_chivas', 'Чивас Ригал 12', 'Chivas Regal 12', 850, { unverified: WSK });
  SP('wk_glen', 'Гленфиддик 12', 'Glenfiddich 12', 990, { unverified: WSK });
  SP('cg_noah', 'Ной 3*', 'Cognac Noah 3*', 420);
  SP('cg_tiflis', 'Сокровище Тифлиса 7 лет', 'Treasure of Tiflis 7', 400);
  SP('cg_batumi', 'Батуми 12 лет', 'Batumi 12', 620);

  // ===== Nalewka / liqueur / aperitif =====
  function LQ(id, ru, en, price, w) { I('liqueur', id, ru, en, price, w || '40 мл', { icons: '🥃', tags: ['alc'] }); }
  LQ('lq_7veg', 'Настойка 7 овощей', 'Nalewka 7 vegetables', 330);
  LQ('lq_baileys', 'Бейлис', 'Baileys', 490);
  LQ('lq_jager', 'Ягермейстер ледяной шот', 'Jagermeister ice shot', 420);
  LQ('lq_belberry', 'Белуга Хантинг Ягодный', 'Beluga Hunting Berry', 350);
  LQ('lq_belpear', 'Белуга Ботаникалс Груша&Липа', 'Beluga Botanicals Pear&Linden', 440);
  LQ('lq_limoncello', 'Лимончелло', 'Limoncello', 250);
  LQ('ap_bianco', 'Бьянко', 'Garrone Bianco', 450, '80 мл');
  LQ('ap_extradry', 'Экстра Драй', 'Garrone Extra Dry', 450, '80 мл');

  // ---- Section prefixes ----------------------------------------------------
  // `ru` stays exactly as printed; `pre` is the section it is printed under,
  // shown small above the name so “Мохито” (lemonade) ≠ “Мохито” (cocktail).
  var PRE = {
    lm_rasp: 'Лимонад', lm_tarragon: 'Лимонад', lm_peach: 'Лимонад', lm_passion: 'Лимонад',
    lm_mojito: 'Б/а коктейль', lm_mojito_rasp: 'Б/а коктейль', lm_mojito_cur: 'Б/а коктейль',
    mr_mandarin: 'Морс согревающий', mr_currant: 'Морс согревающий', mr_lingon: 'Морс согревающий',
    sh_soviet: 'Молочный коктейль', sh_key: 'Молочный коктейль',
    ck_mojito: 'Алк. коктейль',
    gn_baboon: 'Джин', gn_ginster: 'Джин', rm_puntacana: 'Ром', rm_devils: 'Ром',
    tq_silver: 'Текила', tq_gold: 'Текила', wk_jack: 'Виски', wk_jameson: 'Виски', wk_chivas: 'Виски', wk_glen: 'Виски',
    cg_noah: 'Коньяк', cg_tiflis: 'Коньяк', cg_batumi: 'Коньяк', ap_bianco: 'Аперитив', ap_extradry: 'Аперитив',
    set_veg: 'Набор вареников', set_sweet: 'Набор вареников', set_meat: 'Набор вареников',
    cf_coco_capp: 'На кокосовом молоке', cf_coco_latte: 'На кокосовом молоке',
    st_berry: 'Шот', st_horse: 'Шот', ch_parm: 'Сыр', ch_mozz: 'Сыр', ch_soviet: 'Сыр',
  };
  ITEMS.forEach(function (it) {
    if (PRE[it.id]) it.pre = PRE[it.id];
    else if (it.cat === 'tealeaf') it.pre = 'Листовой чай';
    else if (it.cat === 'extras') it.pre = 'Добавка';
    else if (it.cat === 'pot') it.pre = 'В горшочке';
  });

  // ---- Printed restaurant rules / promos ----------------------------------
  var RULES = {
    breakfastGift: 'Every day until 12:00 — espresso, americano or tea as a gift with any breakfast dish (printed on menu).',
    vodkaPromo: 'Order 1 L of any vodka → 3 L juice as a gift (apple or tomato) (printed on menu).',
    sideSwap: '“Заменить гарнир +35₽” is printed on the Main dishes page.',
    sideSwapPrice: 35,
  };

  // ---- Easily confused groups (differences stated from menu text) ---------
  var CONFUSABLES = [
    { title: 'Мохито: with rum or without?', ids: ['ck_mojito', 'lm_mojito'], diff: 'Cocktail = светлый ром, 400 мл, 550 ₽. Lemonade = no alcohol, 350 мл, 360 ₽. Always ask “с алкоголем?”.' },
    { title: 'Глинтвейн: alcoholic vs non-alcoholic', ids: ['hc_classic', 'tb_mulled', 'hc_hunter'], diff: 'Глинтвейн (red wine) 200 мл 450 ₽ · Безалкогольный глинтвейн is in the TEA section, 400 мл 420 ₽ · Охотничий 490 ₽.' },
    { title: 'Siberian pelmeni — four versions', ids: ['pl_sib', 'pl_sibmush', 'pl_bakedsmet', 'pl_bakedpepper'], diff: 'Plain 640 · in mushroom sauce 660 · baked with sour cream 660 · baked in pepper sauce 695 (all pork/veal/chicken).' },
    { title: 'Siberian vs Ural pelmeni', ids: ['pl_sib', 'pl_ural'], diff: 'Siberian = свинина, говядина, курица. Ural = говядина, баранина, курица + укроп. Both 640 ₽, both can take bouillon +35.' },
    { title: 'Belarusian vareniki: plate vs pot', ids: ['v_belarus', 'pot_belarus'], diff: 'Plate 460 ₽ (200/15 г). Pot with mushroom поджарка 510 ₽ (200/30 г). The pot is its own item — not “plate + поджарка”.' },
    { title: 'Lamb dishes', ids: ['v_lamb', 'pot_lamb', 'mn_perlovka'], diff: 'Vareniki with lamb 690 ₽ · lamb vareniki in pot with mushroom поджарка 750 ₽ · Перловка is BEEF (говядина), 850 ₽.' },
    { title: 'Cabbage vareniki', ids: ['v_cabchick', 'pot_cabchick', 'set_veg'], diff: 'Plate “с капустой и жареной курицей” 490 · pot with mushroom поджарка 550 · “с капустой и грибами” exists only in the Овощной set.' },
    { title: 'Potato vareniki', ids: ['v_potato', 'v_potmush', 'v_friedpotcheese', 'pot_potmeat', 'pot_potmushmeat'], diff: 'Potato 420 · potato+mushroom 460 · FRIED potato+cheese 490 · pot potato+meat поджарка 495 · pot potato+mushroom+meat поджарка 510.' },
    { title: 'Chicken & mushroom vareniki', ids: ['v_chickmush', 'pot_chickmeat'], diff: 'Plate 560 ₽ · pot with MEAT поджарка 640 ₽.' },
    { title: 'Sweet vareniki with cottage cheese', ids: ['sv_raisin', 'sv_poppy'], diff: 'Raisins 420 ₽ · poppy-seed dough with dried apricots 440 ₽.' },
    { title: 'Cherry: vareniki vs posikunchiki', ids: ['sv_cherry', 'sv_posik'], diff: 'Vareniki with cherry 540 ₽, 200 г · Посикунчики 450 ₽, 160 г. Both: warn about pits (косточки).' },
    { title: 'Pancakes', ids: ['blini', 'pc_cherry'], diff: 'With toppings of choice 390 ₽ (ask which topping) · with cottage cheese, cherry & salted caramel 450 ₽.' },
    { title: 'Fried potatoes vs pork', ids: ['mn_friedpot', 'mn_friedpotpork', 'mn_pork'], diff: 'Potatoes+onion+mushroom 465 · potatoes+pork+mushroom 640 · pork tenderloin with wedges 820.' },
    { title: 'Draniki', ids: ['mn_draniki', 'mn_zucchini'], diff: 'Potato draniki 390 ₽ · Zucchini draniki with chicken fillet & champignon sauce 740 ₽.' },
    { title: 'Cutlets', ids: ['mn_cutlets', 'mn_chickcut', 'mn_kiev', 'mn_pikecut'], diff: 'Homemade cutlets + pasta in dill 595 · chicken cutlets with cheese 570 · Chicken Kiev 690 · pike cutlets + vegetable puree 685.' },
    { title: 'Croutons / garlic bread', ids: ['sn_croutons', 'sn_borodino', 'br_pampushki'], diff: 'Garlic croutons 355 · Borodino croutons with herring & egg 520 · Pampushki with garlic sauce 145.' },
    { title: 'Cheese snacks', ids: ['sn_cheesefries', 'sn_beer'], diff: 'Cheese fries with honey sauce 520 · Beer platter 1390 (pelmeni, cheese sticks, onion rings, croutons, garlic sauce).' },
    { title: 'Coffee on regular vs coconut milk', ids: ['cf_capp', 'cf_coco_capp', 'cf_latte', 'cf_coco_latte'], diff: 'Cappuccino 275 / coconut 330 · Latte 280 / coconut 330.' },
    { title: 'Juice vs fresh', ids: ['jc_orange', 'fr_orange', 'jc_apple', 'fr_apple'], diff: 'Juice 200 мл 195 ₽ (or 1 л 820) · Fresh 200 мл 430 ₽ (carrot 330).' },
    { title: 'Berry drinks', ids: ['ow_cranberry', 'ow_berry', 'mr_lingon', 'tb_lingon'], diff: 'Cranberry mors 220/895 · berry compote 195/695 · WARM lingonberry-blueberry 260 · lingonberry TEA 420.' },
    { title: 'Tarragon', ids: ['so_machine', 'lm_tarragon', 'ck_mimino'], diff: 'Soda machine Тархун 195 · Apple-tarragon lemonade 295 · Mimino cocktail (alcohol) 495.' },
    { title: 'Same-price lookalike beers', ids: ['br_lowdunkel', 'br_lowlight', 'br_sibunf', 'br_siblight'], diff: 'Löwenbräu Dunkel = dark, Light = light (both 360/560). Сибирская корона нефильтрованное 350/550 vs светлое 340/540.' },
    { title: 'Tea: berry vs leaf', ids: ['tb_grandma', 'tl_0'], diff: 'Berry & herb teas 420 ₽ · leaf tea 299 ₽ (both 400 мл).' },
  ];

  var MENU = { GROUPS: GROUPS, CATS: CATS, ITEMS: ITEMS, MODS: MODS, MOD_GROUPS: MOD_GROUPS, RULES: RULES, CONFUSABLES: CONFUSABLES, VERSION: '2026-10-20' };
  if (typeof module !== 'undefined' && module.exports) module.exports = MENU;
  else root.MENU = MENU;
})(this);
