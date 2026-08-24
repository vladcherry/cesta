// Number, money and date formatting. One place, so the locale switch is total.

(function (global) {
  'use strict';

  var moneyCache = {};
  var numberCache = {};

  function money(value, options) {
    if (value === null || value === undefined || !isFinite(value)) return I18N.t('common.na');
    var digits = (options && options.digits) !== undefined ? options.digits : 2;
    var key = I18N.locale() + ':' + digits;
    if (!moneyCache[key]) {
      moneyCache[key] = new Intl.NumberFormat(I18N.locale(), {
        style: 'currency',
        currency: 'EUR',
        // uk-UA would otherwise print "46,26 EUR"; the symbol is shorter and
        // reads the same in all three locales.
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }
    return moneyCache[key].format(value);
  }

  function number(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return I18N.t('common.na');
    var key = I18N.locale() + ':' + digits;
    if (!numberCache[key]) {
      numberCache[key] = new Intl.NumberFormat(I18N.locale(), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }
    return numberCache[key].format(value);
  }

  function percent(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return I18N.t('common.na');
    var sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return sign + number(Math.abs(value), digits === undefined ? 1 : digits) + '%';
  }

  function unit(code) {
    if (!code) return '';
    var key = 'unit.' + String(code).toLowerCase();
    var label = I18N.t(key);
    return label === key ? code : label;
  }

  function date(iso, options) {
    if (!iso) return I18N.t('info.never');
    var parsed = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
    if (isNaN(parsed)) return iso;
    return new Intl.DateTimeFormat(
      I18N.locale(),
      options || { day: 'numeric', month: 'short', year: 'numeric' },
    ).format(parsed);
  }

  function shortDate(iso) {
    return date(iso, { day: 'numeric', month: 'short' });
  }

  function daysAgo(iso, from) {
    if (!iso) return null;
    var a = Date.parse(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
    var b = from ? Date.parse(from.length === 10 ? from + 'T12:00:00Z' : from) : Date.now();
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  global.Fmt = {
    money: money,
    number: number,
    percent: percent,
    unit: unit,
    date: date,
    shortDate: shortDate,
    daysAgo: daysAgo,
  };
})(window);
