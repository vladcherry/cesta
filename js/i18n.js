// All user-facing strings live here. English is the base, Spanish and
// Ukrainian are overlays. The language comes from the browser, can be forced
// with the header button, and the choice is remembered.

(function (global) {
  'use strict';

  var LOCALES = { en: 'en-IE', es: 'es-ES', uk: 'uk-UA' };

  var STRINGS = {
    en: {
      'app.name': 'Cesta',
      'app.tagline': 'Home grocery price tracker',
      'nav.basket': 'Basket',
      'nav.items': 'Items',
      'nav.info': 'Info',

      'basket.heading': 'Where the whole basket is cheaper',
      'basket.cheapest': 'Cheapest',
      'basket.total': 'Comparable basket',
      'basket.fullTotal': 'All priced items',
      'basket.coverage': '{covered} of {total} items priced',
      'basket.vsCheapest': '{delta} more than {store}',
      'basket.comparableNote':
        'Ranking uses the {count} items priced by every shop. The second figure counts everything each shop prices, so it is not comparable between shops.',
      'basket.noComparable':
        'No item is priced by every shop yet, so there is nothing fair to rank. The figures below count what each shop does price.',
      'basket.trend': 'Basket total over time',
      'basket.trendNote': 'Same fixed quantities, recomputed for every day with data.',
      'basket.week': 'This week',

      'items.heading': 'Price per item',
      'items.search': 'Filter items',
      'items.allCategories': 'All categories',
      'items.compare': 'Compare by',
      'items.perUnit': 'Unit price',
      'items.pack': 'Pack price',
      'items.item': 'Item',
      'items.none': 'Nothing matches the filter.',
      'items.cheapestHere': 'cheapest',
      'items.noPrice': 'not sold / no id',
      'items.showing': '{shown} of {total} items',
      'items.packShort': 'pack',

      'detail.history': 'Price history',
      'detail.range': 'Range',
      'detail.days': '{n} days',
      'detail.min': 'Min',
      'detail.max': 'Max',
      'detail.avg': 'Average',
      'detail.latest': 'Latest',
      'detail.noHistory': 'No history yet. The first useful chart needs a couple of weeks of daily runs.',
      'detail.close': 'Close',
      'detail.packNote': 'Pack {size} {unit} · {qty} per basket',

      'info.heading': 'About this app',
      'info.source': 'Data source',
      'info.sourceText':
        'A fixed basket of {items} items. Mercadona and Consum are read once a day from their online shops by a GitHub Action. Lidl and Aldi have no online grocery catalogue in Spain, so their prices are typed in by hand from the folleto and carry the date they were seen.',
      'info.updated': 'Snapshot',
      'info.never': 'never',
      'info.storesHeading': 'Shops',
      'info.errors': 'Collection errors',
      'info.deadIds': '{n} dead ids',
      'info.settings': 'Settings',
      'info.language': 'Language',
      'info.theme': 'Theme',
      'info.theme.system': 'System',
      'info.theme.light': 'Light',
      'info.theme.dark': 'Dark',
      'info.refresh': 'Refresh data',
      'info.bgSync': 'Daily background check',
      'info.bgSyncText':
        'Chromium only, and only for an installed app: checks once a day whether a new snapshot appeared and notifies you.',
      'info.bgSyncOn': 'Enabled',
      'info.bgSyncOff': 'Enable',
      'info.bgSyncUnsupported': 'Not supported by this browser',
      'info.demoOn': 'Demo data is on. Reload without ?demo=1 for the real thing.',
      'info.cache': 'Offline copy',
      'info.cacheText': 'The last snapshot is kept in this browser, so the app opens with data without a network.',

      'common.updated': 'Updated {date}',
      'common.offline': 'Offline — showing the last saved copy',
      'common.demo': 'Demo data',
      'common.loading': 'Loading…',
      'common.retry': 'Retry',
      'common.error': 'Could not load data',
      'common.na': '—',
      'common.manual': 'typed by hand',
      'common.stale': 'seen {days} days ago',
      'common.seen': 'seen {date}',
      'common.perUnitShort': 'per {unit}',
      'common.up': 'up',
      'common.down': 'down',
      'common.flat': 'unchanged',
      'common.vs30': 'vs 30 days ago',
      'common.language': 'Language',
      'common.themeToggle': 'Theme',

      'empty.heading': 'No prices yet',
      'empty.text':
        'basket.json has no shop ids yet, or the collector has not run. Fill in the ids and let the daily action run once — or look at the demo.',
      'empty.demo': 'Open the demo',

      'unit.l': 'l',
      'unit.kg': 'kg',
      'unit.unit': 'pc',

      'cat.dairy': 'Dairy & eggs',
      'cat.bakery': 'Bread & cereal',
      'cat.produce': 'Fruit & veg',
      'cat.meat': 'Meat',
      'cat.fish': 'Fish',
      'cat.pantry': 'Pantry',
      'cat.frozen': 'Frozen',
      'cat.drinks': 'Drinks',
      'cat.household': 'Household',
      'cat.personal': 'Personal care',
    },

    es: {
      'app.tagline': 'Seguimiento casero de precios',
      'nav.basket': 'Cesta',
      'nav.items': 'Productos',
      'nav.info': 'Info',

      'basket.heading': 'Dónde sale más barata la cesta entera',
      'basket.cheapest': 'Más barato',
      'basket.total': 'Cesta comparable',
      'basket.fullTotal': 'Todo lo que tiene precio',
      'basket.coverage': '{covered} de {total} productos con precio',
      'basket.vsCheapest': '{delta} más que {store}',
      'basket.comparableNote':
        'La comparación usa los {count} productos con precio en todas las tiendas. La segunda cifra cuenta todo lo que cada tienda tiene, así que no es comparable entre tiendas.',
      'basket.noComparable':
        'Todavía no hay ningún producto con precio en todas las tiendas, así que no hay nada que comparar de forma justa. Abajo, lo que cada tienda sí tiene.',
      'basket.trend': 'Total de la cesta en el tiempo',
      'basket.trendNote': 'Las mismas cantidades fijas, recalculadas cada día con datos.',
      'basket.week': 'Esta semana',

      'items.heading': 'Precio por producto',
      'items.search': 'Filtrar productos',
      'items.allCategories': 'Todas las categorías',
      'items.compare': 'Comparar por',
      'items.perUnit': 'Precio por unidad',
      'items.pack': 'Precio del envase',
      'items.item': 'Producto',
      'items.none': 'Nada coincide con el filtro.',
      'items.cheapestHere': 'más barato',
      'items.noPrice': 'no lo venden / sin id',
      'items.showing': '{shown} de {total} productos',
      'items.packShort': 'envase',

      'detail.history': 'Histórico de precios',
      'detail.range': 'Periodo',
      'detail.days': '{n} días',
      'detail.min': 'Mín',
      'detail.max': 'Máx',
      'detail.avg': 'Media',
      'detail.latest': 'Último',
      'detail.noHistory': 'Aún no hay histórico. El primer gráfico útil necesita un par de semanas.',
      'detail.close': 'Cerrar',
      'detail.packNote': 'Envase {size} {unit} · {qty} por cesta',

      'info.heading': 'Sobre esta app',
      'info.source': 'Origen de los datos',
      'info.sourceText':
        'Una cesta fija de {items} productos. Mercadona y Consum se leen una vez al día de su tienda online con una GitHub Action. Lidl y Aldi no tienen catálogo de alimentación online en España: sus precios se escriben a mano desde el folleto y llevan la fecha en que se vieron.',
      'info.updated': 'Instantánea',
      'info.never': 'nunca',
      'info.storesHeading': 'Tiendas',
      'info.errors': 'Errores de recogida',
      'info.deadIds': '{n} ids muertos',
      'info.settings': 'Ajustes',
      'info.language': 'Idioma',
      'info.theme': 'Tema',
      'info.theme.system': 'Sistema',
      'info.theme.light': 'Claro',
      'info.theme.dark': 'Oscuro',
      'info.refresh': 'Actualizar datos',
      'info.bgSync': 'Comprobación diaria en segundo plano',
      'info.bgSyncText':
        'Solo Chromium y solo con la app instalada: comprueba una vez al día si hay datos nuevos y avisa.',
      'info.bgSyncOn': 'Activado',
      'info.bgSyncOff': 'Activar',
      'info.bgSyncUnsupported': 'No compatible con este navegador',
      'info.demoOn': 'Datos de demostración. Recarga sin ?demo=1 para ver los reales.',
      'info.cache': 'Copia sin conexión',
      'info.cacheText': 'La última instantánea se guarda en este navegador, así la app abre con datos sin red.',

      'common.updated': 'Actualizado {date}',
      'common.offline': 'Sin conexión — se muestra la última copia',
      'common.demo': 'Datos de demo',
      'common.loading': 'Cargando…',
      'common.retry': 'Reintentar',
      'common.error': 'No se pudieron cargar los datos',
      'common.manual': 'a mano',
      'common.stale': 'visto hace {days} días',
      'common.seen': 'visto el {date}',
      'common.perUnitShort': 'por {unit}',
      'common.up': 'sube',
      'common.down': 'baja',
      'common.flat': 'igual',
      'common.vs30': 'frente a hace 30 días',
      'common.language': 'Idioma',
      'common.themeToggle': 'Tema',

      'empty.heading': 'Todavía no hay precios',
      'empty.text':
        'basket.json aún no tiene ids de tienda, o el recolector no se ha ejecutado. Rellena los ids y deja correr la acción diaria — o mira la demo.',
      'empty.demo': 'Abrir la demo',

      'unit.unit': 'ud',

      'cat.dairy': 'Lácteos y huevos',
      'cat.bakery': 'Pan y cereales',
      'cat.produce': 'Fruta y verdura',
      'cat.meat': 'Carne',
      'cat.fish': 'Pescado',
      'cat.pantry': 'Despensa',
      'cat.frozen': 'Congelados',
      'cat.drinks': 'Bebidas',
      'cat.household': 'Hogar',
      'cat.personal': 'Higiene',
    },

    uk: {
      'app.tagline': 'Домашній трекер цін на продукти',
      'nav.basket': 'Кошик',
      'nav.items': 'Товари',
      'nav.info': 'Інфо',

      'basket.heading': 'Де дешевша вся закупка',
      'basket.cheapest': 'Найдешевше',
      'basket.total': 'Порівнянний кошик',
      'basket.fullTotal': 'Усе, що має ціну',
      'basket.coverage': '{covered} з {total} позицій з цінами',
      'basket.vsCheapest': 'на {delta} дорожче за {store}',
      'basket.comparableNote':
        'Рейтинг рахується по {count} позиціях, які мають ціну в усіх мережах. Друга цифра — усе, що мережа взагалі оцінює, тож між мережами вона не порівнюється.',
      'basket.noComparable':
        'Поки жодна позиція не має ціни в усіх мережах, тому чесно ранжувати нічого. Нижче — те, що має ціну в кожній.',
      'basket.trend': 'Сума кошика в часі',
      'basket.trendNote': 'Ті самі фіксовані кількості, перерахунок на кожен день з даними.',
      'basket.week': 'Цього тижня',

      'items.heading': 'Ціна по кожному товару',
      'items.search': 'Фільтр товарів',
      'items.allCategories': 'Усі категорії',
      'items.compare': 'Порівнювати за',
      'items.perUnit': 'Ціна за одиницю',
      'items.pack': 'Ціна за упаковку',
      'items.item': 'Товар',
      'items.none': 'Нічого не знайшлося.',
      'items.cheapestHere': 'найдешевше',
      'items.noPrice': 'немає / не вказано id',
      'items.showing': '{shown} з {total} позицій',
      'items.packShort': 'уп.',

      'detail.history': 'Історія ціни',
      'detail.range': 'Період',
      'detail.days': '{n} днів',
      'detail.min': 'Мін',
      'detail.max': 'Макс',
      'detail.avg': 'Середнє',
      'detail.latest': 'Останнє',
      'detail.noHistory': 'Історії ще немає. Перший корисний графік з’явиться за пару тижнів щоденних запусків.',
      'detail.close': 'Закрити',
      'detail.packNote': 'Упаковка {size} {unit} · {qty} на кошик',

      'info.heading': 'Про застосунок',
      'info.source': 'Джерело даних',
      'info.sourceText':
        'Фіксований кошик із {items} позицій. Mercadona і Consum раз на добу читає GitHub Action з їхніх онлайн-магазинів. У Lidl та Aldi в Іспанії немає онлайн-каталогу продуктів, тож їхні ціни вносяться руками з фольєта і зберігають дату, коли їх бачили.',
      'info.updated': 'Знімок',
      'info.never': 'ніколи',
      'info.storesHeading': 'Мережі',
      'info.errors': 'Помилки збору',
      'info.deadIds': '{n} мертвих id',
      'info.settings': 'Налаштування',
      'info.language': 'Мова',
      'info.theme': 'Тема',
      'info.theme.system': 'Системна',
      'info.theme.light': 'Світла',
      'info.theme.dark': 'Темна',
      'info.refresh': 'Оновити дані',
      'info.bgSync': 'Щоденна фонова перевірка',
      'info.bgSyncText':
        'Лише Chromium і лише для встановленого застосунку: раз на добу перевіряє, чи з’явився новий знімок, і надсилає сповіщення.',
      'info.bgSyncOn': 'Увімкнено',
      'info.bgSyncOff': 'Увімкнути',
      'info.bgSyncUnsupported': 'Браузер не підтримує',
      'info.demoOn': 'Показані демо-дані. Перезавантажте без ?demo=1, щоб побачити справжні.',
      'info.cache': 'Офлайн-копія',
      'info.cacheText': 'Останній знімок зберігається у браузері, тому застосунок відкривається з даними без мережі.',

      'common.updated': 'Оновлено {date}',
      'common.offline': 'Немає мережі — показано збережену копію',
      'common.demo': 'Демо-дані',
      'common.loading': 'Завантаження…',
      'common.retry': 'Спробувати ще',
      'common.error': 'Не вдалося завантажити дані',
      'common.manual': 'внесено руками',
      'common.stale': 'бачили {days} дн. тому',
      'common.seen': 'бачили {date}',
      'common.perUnitShort': 'за {unit}',
      'common.up': 'зросла',
      'common.down': 'впала',
      'common.flat': 'без змін',
      'common.vs30': 'проти 30 днів тому',
      'common.language': 'Мова',
      'common.themeToggle': 'Тема',

      'empty.heading': 'Цін ще немає',
      'empty.text':
        'У basket.json ще немає id мереж, або збирач не запускався. Впишіть id і дайте щоденній дії відпрацювати — або подивіться демо.',
      'empty.demo': 'Відкрити демо',

      'unit.l': 'л',
      'unit.kg': 'кг',
      'unit.unit': 'шт',

      'cat.dairy': 'Молочне і яйця',
      'cat.bakery': 'Хліб і крупи',
      'cat.produce': 'Овочі і фрукти',
      'cat.meat': 'М’ясо',
      'cat.fish': 'Риба',
      'cat.pantry': 'Бакалія',
      'cat.frozen': 'Заморожене',
      'cat.drinks': 'Напої',
      'cat.household': 'Побутове',
      'cat.personal': 'Гігієна',
    },
  };

  var ORDER = ['en', 'es', 'uk'];
  var LABELS = { en: 'EN', es: 'ES', uk: 'UK' };
  var current = 'en';

  function detect(stored) {
    if (stored && STRINGS[stored]) return stored;
    var candidates = (global.navigator && (navigator.languages || [navigator.language])) || [];
    for (var i = 0; i < candidates.length; i += 1) {
      var code = String(candidates[i] || '').slice(0, 2).toLowerCase();
      if (STRINGS[code]) return code;
      if (code === 'ru') return 'uk'; // no Russian overlay; Ukrainian is the closest one shipped
      if (code === 'ca' || code === 'gl') return 'es';
    }
    return 'en';
  }

  function t(key, params) {
    var table = STRINGS[current] || STRINGS.en;
    var value = table[key];
    if (value === undefined) value = STRINGS.en[key];
    if (value === undefined) return key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, function (match, name) {
      return params[name] === undefined ? match : params[name];
    });
  }

  global.I18N = {
    order: ORDER,
    labels: LABELS,
    detect: detect,
    t: t,
    get lang() {
      return current;
    },
    set: function (lang) {
      current = STRINGS[lang] ? lang : 'en';
      return current;
    },
    locale: function () {
      return LOCALES[current] || 'en-IE';
    },
    next: function () {
      return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    },
  };
})(window);
