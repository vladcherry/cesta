// The dashboard itself: inputs on top, one sampled curve underneath, and four
// views reading that same curve.
//
// State lives in one object, is mirrored into the URL (so a finding can be
// sent to someone) and into localStorage (so the page opens where you left
// it). Every render recomputes the curve from scratch — a few thousand
// closed-form evaluations, far below the cost of a repaint — which keeps the
// views from drifting apart.

(function (global) {
  'use strict';

  var T = global.TaxI18N;
  var PARAMS_URL = 'data/es-2026.json';
  var SETTINGS_KEY = 'irpf.settings';
  var ANIO_ACTUAL = new Date().getFullYear();

  var engine = null;
  var params = null;

  var state = {
    mode: 'empleado',
    region: 'madrid',
    gross: 35000,
    contrato: 'indefinido',
    hijos: 0,
    hijosMenores3: 0,
    compartidos: false,
    edad: 40, // years; the tax code only cares about 65 and 75, the bank does not
    pension: 0,
    ahorro: 40000,
    plazo: 30,
    anioInicio: null, // calendar year the career started; null -> at 23
    cotizados: null, // years contributed up to today; null -> every year since the start
    interes: null, // null -> the rate from the parameters file
    ratioCuota: null,
    gastosPct: 0.15,
    pagas: 12,
    max: 120000,
    view: 'overview',
    period: 'year', // every amount on the page reads per year or per month
    panelOpen: null, // null -> open on a wide screen, closed on a phone
    lang: null, // null -> follow the browser
    theme: 'system',
  };

  var curve = [];
  var analysis = null;

  // --- formatting ---------------------------------------------------------

  function euro(value, digits) {
    return new Intl.NumberFormat(T.locale(), {
      style: 'currency', currency: 'EUR', currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0,
    }).format(value || 0);
  }

  function euroShort(value) {
    if (Math.abs(value) >= 1000) {
      var thousands = value / 1000;
      // A half-step tick has to keep its half, or the axis repeats a label.
      var digits = Math.abs(thousands - Math.round(thousands)) < 0.05 ? 0 : 1;
      return new Intl.NumberFormat(T.locale(), { maximumFractionDigits: digits }).format(thousands) + 'k €';
    }
    return euro(value);
  }

  // Tax is settled on the year; a salary is recognised by the month. The whole
  // page reads in whichever the header switch is set to — amounts are held in
  // annual euros throughout and divided only on the way out — and the headline
  // figures carry the other one in brackets, so neither reading is ever a
  // mental division away.
  function divisor() {
    return state.period === 'month' ? 12 : 1;
  }

  function amount(value, digits) {
    return euro(value / divisor(), digits);
  }

  function amountShort(value) {
    return euroShort(value / divisor());
  }

  function periodSuffix() {
    return T.t(state.period === 'month' ? 'common.perMonth' : 'common.perYear');
  }

  function amountBoth(value) {
    var other = state.period === 'month'
      ? euro(value) + T.t('common.perYear')
      : euro(value / 12) + T.t('common.perMonth');
    return amount(value) + ' <small>(' + other + ')</small>';
  }

  function pct(value, digits) {
    return new Intl.NumberFormat(T.locale(), {
      style: 'percent', minimumFractionDigits: digits == null ? 1 : digits,
      maximumFractionDigits: digits == null ? 1 : digits,
    }).format(value || 0);
  }

  function color(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  }

  // --- state --------------------------------------------------------------

  function readUrl() {
    var query = new URLSearchParams(global.location.search);
    ['mode', 'region', 'contrato', 'view', 'period', 'lang'].forEach(function (key) {
      if (query.has(key)) state[key] = query.get(key);
    });
    ['gross', 'hijos', 'hijosMenores3', 'pension', 'max', 'pagas', 'edad', 'ahorro', 'plazo', 'anioInicio', 'cotizados'].forEach(function (key) {
      if (query.has(key)) state[key] = Number(query.get(key)) || 0;
    });
    if (query.has('gastosPct')) state.gastosPct = Number(query.get('gastosPct')) || 0;
    if (query.has('compartidos')) state.compartidos = query.get('compartidos') === '1';
  }

  function saveState() {
    try {
      global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
    } catch (error) {
      /* private window: the page still works, it just forgets */
    }
    try {
      var query = new URLSearchParams({
        mode: state.mode, region: state.region, gross: String(state.gross),
        view: state.view, period: state.period,
      });
      // Only once it has been chosen: an unset language keeps following the
      // browser, and writing it into the URL would silently freeze it.
      if (state.lang) query.set('lang', state.lang);
      history.replaceState(null, '', '?' + query.toString());
    } catch (error) {
      /* sandboxed frames refuse replaceState; the page does not depend on it */
    }
  }

  function loadState() {
    try {
      var raw = global.localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(state, JSON.parse(raw));
    } catch (error) {
      /* ignore */
    }
    // Age used to be a three-way choice; a mortgage needs the number.
    if (typeof state.edad === 'string') {
      state.edad = state.edad === 'over75' ? 78 : state.edad === 'over65' ? 68 : 40;
    }
    // The pension used to take a start age and a projected total; it now takes
    // the start year and the years so far, and projects the rest itself.
    if (state.anioInicio == null && typeof state.edadInicio === 'number') {
      state.anioInicio = ANIO_ACTUAL - state.edad + state.edadInicio;
    }
    delete state.edadInicio;
    delete state.anos;
    readUrl();
  }

  // --- the curve ----------------------------------------------------------

  function input() {
    return {
      mode: state.mode,
      region: state.region,
      contrato: state.contrato,
      hijos: state.hijos,
      hijosMenores3: state.hijosMenores3,
      descendientesCompartidos: state.compartidos,
      edad65: state.edad >= 65,
      edad75: state.edad >= 75,
      planPensiones: state.pension,
      gastosPct: state.mode === 'autonomo' ? state.gastosPct : null,
      gastosActividad: state.mode === 'autonomo' ? state.gross * state.gastosPct : 0,
    };
  }

  // A 100 EUR step is the point of the whole page: the RETA traps are a few
  // hundred euros wide, and a coarser sample would smooth them into nothing.
  var STEP = 100;

  function rebuild() {
    curve = engine.curve(input(), { from: 0, to: state.max, step: STEP });
    analysis = global.IrpfAnalysis.analyse(curve);
  }

  function at(gross) {
    var base = Object.assign({}, input(), { gross: gross });
    if (state.mode === 'autonomo') base.gastosActividad = gross * state.gastosPct;
    return engine.compute(base);
  }

  // --- inputs panel -------------------------------------------------------

  function field(label, control, note) {
    return '<label class="field"><span class="field-label">' + label + '</span>' + control +
      (note ? '<span class="field-note">' + note + '</span>' : '') + '</label>';
  }

  function options(list, selected) {
    return list.map(function (item) {
      return '<option value="' + item.value + '"' + (String(item.value) === String(selected) ? ' selected' : '') +
        '>' + item.label + '</option>';
    }).join('');
  }

  function renderPanel() {
    var host = document.getElementById('panel');
    var regions = params.regiones.map(function (r) {
      return { value: r.id, label: r.name + (r.verified ? '' : ' *') };
    });

    var html =
      field(T.t('in.mode'),
        '<select id="in-mode">' + options([
          { value: 'empleado', label: T.t('in.employee') },
          { value: 'autonomo', label: T.t('in.autonomo') },
        ], state.mode) + '</select>') +
      field(T.t('in.region'), '<select id="in-region">' + options(regions, state.region) + '</select>') +
      (state.mode === 'empleado'
        ? field(T.t('in.contract'),
          '<select id="in-contrato">' + options([
            { value: 'indefinido', label: T.t('in.indefinido') },
            { value: 'temporal', label: T.t('in.temporal') },
          ], state.contrato) + '</select>')
        : field(T.t('in.expenses'),
          '<span class="field-input"><input type="number" id="in-gastos" min="0" max="90" step="1" value="' +
          Math.round(state.gastosPct * 100) + '"><span class="unit">%</span></span>',
          T.t('in.expensesNote'))) +
      field(T.t('in.children'), '<input type="number" id="in-hijos" min="0" max="8" step="1" value="' + state.hijos + '">') +
      (state.hijos > 0
        ? field(T.t('in.under3'), '<input type="number" id="in-menores3" min="0" max="' + state.hijos +
          '" step="1" value="' + Math.min(state.hijosMenores3, state.hijos) + '">')
        : '') +
      field(T.t('in.age'), '<input type="number" id="in-edad" min="16" max="90" step="1" value="' + state.edad + '">') +
      field(T.t('in.pension'), '<span class="field-input"><input type="number" id="in-pension" min="0" max="1500" ' +
        'step="100" value="' + state.pension + '"><span class="unit">€</span></span>') +
      field(T.t('in.range'),
        '<select id="in-max">' + options([60000, 120000, 200000, 400000].map(function (value) {
          return { value: value, label: amountShort(value) + ' ' + periodSuffix() };
        }), state.max) + '</select>');

    host.innerHTML = html;

    bind('in-mode', 'change', function (event) { state.mode = event.target.value; render(true); });
    bind('in-region', 'change', function (event) { state.region = event.target.value; render(true); });
    bind('in-contrato', 'change', function (event) { state.contrato = event.target.value; render(true); });
    bind('in-gastos', 'change', function (event) {
      state.gastosPct = Math.min(0.9, Math.max(0, Number(event.target.value) / 100));
      rerender(true);
    });
    bind('in-hijos', 'change', function (event) {
      state.hijos = Math.max(0, Number(event.target.value) || 0);
      state.hijosMenores3 = Math.min(state.hijosMenores3, state.hijos);
      rerender(true);
    });
    bind('in-menores3', 'change', function (event) {
      state.hijosMenores3 = Math.max(0, Number(event.target.value) || 0);
      rerender(true);
    });
    bind('in-edad', 'change', function (event) {
      state.edad = Math.max(16, Math.min(90, Number(event.target.value) || 40));
      rerender(true);
    });
    bind('in-pension', 'change', function (event) {
      state.pension = Math.max(0, Number(event.target.value) || 0);
      rerender(true);
    });
    bind('in-max', 'change', function (event) {
      state.max = Number(event.target.value);
      if (state.gross > state.max) state.gross = state.max;
      render(true);
    });
  }

  // A change event fires while the field is still losing focus, and rebuilding
  // the panel from inside it makes the browser complain that the node it is
  // replacing has already moved. One tick later the blur is finished.
  function rerender(withPanel) {
    setTimeout(function () {
      render(withPanel);
    }, 0);
  }

  function bind(id, event, handler) {
    var node = document.getElementById(id);
    if (node) node.addEventListener(event, handler);
  }

  // On a phone the seven settings fields fill the screen and the dashboard
  // scrolls in the strip left underneath, so they collapse behind a button and
  // only the income itself stays pinned.
  function panelIsOpen() {
    if (state.panelOpen != null) return state.panelOpen;
    return global.innerWidth > 720;
  }

  function applyPanelState() {
    var controls = document.querySelector('.controls');
    var toggle = document.getElementById('panel-toggle');
    if (!controls) return;
    var open = panelIsOpen();
    controls.classList.toggle('collapsed', !open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }

  function otherPeriodLabel() {
    return state.period === 'month'
      ? '(' + euro(state.gross) + T.t('common.perYear') + ')'
      : '(' + euro(state.gross / 12) + T.t('common.perMonth') + ')';
  }

  function renderCursor() {
    var host = document.getElementById('cursor');
    var shown = Math.round(state.gross / divisor());
    host.innerHTML =
      '<div class="cursor-row">' +
      '<div class="cursor-value"><input type="number" id="in-gross" min="0" max="' +
      Math.round(state.max / divisor()) + '" step="' + (state.period === 'month' ? 50 : 500) +
      '" value="' + shown + '"><span class="unit">€<span class="per"> ' + periodSuffix() + '</span></span>' +
      '<span class="cursor-month">' + otherPeriodLabel() + '</span></div>' +
      '<label class="field grow"><span class="field-label">' +
      T.t(state.period === 'month' ? 'in.grossMonth' : 'in.gross') + '</span>' +
      '<input type="range" id="in-gross-range" min="0" max="' + state.max +
      '" step="' + (state.period === 'month' ? 600 : STEP) + '" value="' + state.gross + '">' +
      '</label>' +
      '<div class="period" role="group" aria-label="' + T.t('in.show') + '">' +
      ['year', 'month'].map(function (period) {
        return '<button type="button" class="chip" data-period="' + period + '" aria-pressed="' +
          (state.period === period) + '">' + T.t('in.' + period) + '</button>';
      }).join('') +
      '</div>' +
      '<button type="button" id="panel-toggle" class="chip" aria-controls="panel" aria-expanded="true">' +
      T.t('in.filters') + '</button>' +
      '</div>';

    Array.prototype.forEach.call(host.querySelectorAll('[data-period]'), function (button) {
      button.addEventListener('click', function () {
        state.period = button.getAttribute('data-period');
        render(true); // the settings panel labels its range in the period too
      });
    });

    bind('panel-toggle', 'click', function () {
      state.panelOpen = !panelIsOpen();
      applyPanelState();
    });
    applyPanelState();

    bind('in-gross-range', 'input', function (event) {
      state.gross = Number(event.target.value);
      var box = document.getElementById('in-gross');
      if (box) box.value = String(Math.round(state.gross / divisor()));
      var other = document.querySelector('.cursor-month');
      if (other) other.textContent = otherPeriodLabel();
      renderView();
      saveState();
    });
    bind('in-gross', 'change', function (event) {
      state.gross = Math.max(0, Math.min(state.max, (Number(event.target.value) || 0) * divisor()));
      rerender(false);
    });
  }

  // --- overview -----------------------------------------------------------

  function kpi(label, value, note, tone) {
    return '<div class="kpi' + (tone ? ' ' + tone : '') + '"><span class="kpi-label">' + label + '</span>' +
      '<b>' + value + '</b>' + (note ? '<span class="kpi-note">' + note + '</span>' : '') + '</div>';
  }

  function marginalAt(gross) {
    var index = Math.max(0, Math.min(curve.length - 2, Math.round(gross / STEP)));
    return curve[index].marginal;
  }

  function bands() {
    var out = [];
    (analysis.traps || []).forEach(function (trap) {
      out.push({ from: trap.from, to: trap.recovery || trap.to, kind: 'trap' });
    });
    (analysis.spikes || []).forEach(function (spike) {
      out.push({ from: spike.from, to: spike.to, kind: 'spike' });
    });
    return out;
  }

  function renderOverview(host) {
    var here = at(state.gross);
    // A round number in the period being read: 1.000 a year, or 100 a month.
    var sliceSize = state.period === 'month' ? 1200 : 1000;
    var slice = global.IrpfAnalysis.nextSlice(engine, input(), state.gross, sliceSize);
    var marginal = marginalAt(state.gross);
    var tone = marginal >= 0.5 ? 'bad' : marginal >= 0.42 ? 'warn' : '';

    var cards =
      kpi(T.t(state.period === 'month' ? 'kpi.netMonth' : 'kpi.net'), amountBoth(here.net),
        pct(1 - here.tipoEfectivo, 0) + ' ' + T.t('series.net').toLowerCase()) +
      // Spanish salaries are often paid in fourteen instalments, so "a month"
      // is ambiguous: this is the other reading of it.
      kpi(T.t('kpi.net14'), euro(here.net / 14), T.t('kpi.months', { n: 14 })) +
      kpi(T.t('kpi.effective'), pct(here.tipoEfectivo), T.t('kpi.effectiveNote')) +
      kpi(T.t('kpi.marginal'), pct(marginal), T.t('kpi.marginalNote'), tone) +
      kpi(T.t('kpi.next', { amount: amount(sliceSize) }), amount(slice.keep), pct(1 - slice.rate, 0) + ' · ' +
        amount(slice.lost) + ' → ' + T.t('kpi.ss') + '/' + T.t('kpi.irpf'), tone) +
      (state.mode === 'autonomo'
        ? kpi(T.t('kpi.reta'), amountBoth(here.ss), T.t('kpi.retaNote', {
          n: here.tramoReta.index + 1, amount: euro(here.tramoReta.tramo.cuotaMes),
        }))
        : kpi(T.t('kpi.employer'), amountBoth(here.costeEmpresa),
          '+' + pct(here.costeEmpresa / here.gross - 1, 1) + ' · ' + T.t('kpi.ss'))) +
      kpi(T.t('kpi.ss'), amountBoth(here.ss), pct(here.gross ? here.ss / here.gross : 0, 1)) +
      kpi(T.t('kpi.irpf'), amountBoth(here.irpf), pct(here.tipoIrpfEfectivo, 1));

    host.innerHTML =
      '<div class="kpis">' + cards + '</div>' +
      card(T.t('chart.netTitle'), T.t('chart.netSub'), '<div class="chart-box" id="chart-net"></div>' + legend([
        { label: T.t('series.net'), color: color('--series-3') },
        { label: T.t('series.gross'), color: color('--muted'), dashed: true },
      ])) +
      card(T.t('chart.ratesTitle'), T.t('chart.ratesSub'), '<div class="chart-box" id="chart-rates"></div>' + legend([
        { label: T.t('series.marginal'), color: color('--critical') },
        { label: T.t('series.effective'), color: color('--series-1') },
      ]) + bandLegend()) +
      card(T.t('chart.splitTitle'), T.t('chart.splitSub'), '<div class="chart-box" id="chart-split"></div>' + legend([
        { label: T.t('series.net'), color: color('--series-3') },
        { label: T.t('series.ss'), color: color('--series-4') },
        { label: T.t('series.irpfState'), color: color('--series-1') },
        { label: T.t('series.irpfRegion'), color: color('--series-5') },
      ].concat(state.mode === 'autonomo' ? [{ label: T.t('series.expenses'), color: color('--muted') }] : [])));

    drawNet();
    drawRates();
    drawSplit();
  }

  function card(title, sub, body) {
    return '<section class="card"><h2>' + title + '</h2>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '') + body + '</section>';
  }

  function legend(items) {
    return '<div class="legend">' + items.map(function (item) {
      return '<span class="legend-item"><i class="swatch' + (item.dashed ? ' dashed' : '') +
        '" style="background:' + item.color + '"></i>' + item.label + '</span>';
    }).join('') + '</div>';
  }

  function bandLegend() {
    return '<div class="legend"><span class="legend-item"><i class="swatch band-spike"></i>' +
      T.t('legend.spike') + '</span>' +
      '<span class="legend-item"><i class="swatch band-trap"></i>' + T.t('legend.trap') + '</span></div>';
  }

  function drawNet() {
    var host = document.getElementById('chart-net');
    if (!host) return;
    global.IrpfCharts.plot(host, {
      height: 280,
      bands: bands(),
      cursor: state.gross,
      series: [
        { id: 'gross', label: T.t('series.gross'), color: color('--muted'), dashed: true,
          points: curve.map(function (p) { return { x: p.gross, y: p.gross }; }) },
        { id: 'net', label: T.t('series.net'), color: color('--series-3'),
          points: curve.map(function (p) { return { x: p.gross, y: p.net }; }) },
      ],
      xFormat: amountShort,
      yFormat: amountShort,
      xTickUnit: divisor(),
      yTickUnit: divisor(),
      onPick: pick,
      tooltip: function (index) {
        var p = curve[index];
        return '<div class="tt-date">' + amount(p.gross) + '</div>' +
          row(T.t('series.net'), amount(p.net)) +
          row(T.t('kpi.marginal'), pct(p.marginal)) +
          row(T.t('kpi.effective'), pct(p.efectivo));
      },
    });
  }

  function drawRates() {
    var host = document.getElementById('chart-rates');
    if (!host) return;
    global.IrpfCharts.plot(host, {
      height: 260,
      bands: bands(),
      cursor: state.gross,
      yMax: Math.min(1, Math.max(0.6, Math.max.apply(null, curve.map(function (p) {
        return Math.min(p.marginal, 1.2);
      })) + 0.05)),
      series: [
        { id: 'marginal', label: T.t('series.marginal'), color: color('--critical'),
          points: curve.map(function (p) { return { x: p.gross, y: Math.max(0, Math.min(p.marginal, 1.2)) }; }) },
        { id: 'efectivo', label: T.t('series.effective'), color: color('--series-1'),
          points: curve.map(function (p) { return { x: p.gross, y: Math.max(0, p.efectivo) }; }) },
      ],
      xFormat: amountShort,
      xTickUnit: divisor(),
      yFormat: function (v) { return pct(v, 0); },
      onPick: pick,
      tooltip: function (index) {
        var p = curve[index];
        return '<div class="tt-date">' + amount(p.gross) + '</div>' +
          row(T.t('series.marginal'), pct(p.marginal)) +
          row(T.t('series.effective'), pct(p.efectivo));
      },
    });
  }

  function drawSplit() {
    var host = document.getElementById('chart-split');
    if (!host) return;
    var areas = [
      { id: 'net', color: color('--series-3'), points: curve.map(function (p) { return { x: p.gross, y: Math.max(0, p.net) }; }) },
      { id: 'ss', color: color('--series-4'), points: curve.map(function (p) { return { x: p.gross, y: p.ss }; }) },
      { id: 'estatal', color: color('--series-1'), points: curve.map(function (p) { return { x: p.gross, y: p.irpfEstatal }; }) },
      { id: 'auton', color: color('--series-5'), points: curve.map(function (p) { return { x: p.gross, y: p.irpfAutonomico }; }) },
    ];
    if (state.mode === 'autonomo') {
      areas.push({ id: 'gastos', color: color('--muted'), opacity: 0.5,
        points: curve.map(function (p) { return { x: p.gross, y: p.gastos }; }) });
    }
    global.IrpfCharts.plot(host, {
      height: 260,
      areas: areas,
      cursor: state.gross,
      xFormat: amountShort,
      yFormat: amountShort,
      xTickUnit: divisor(),
      yTickUnit: divisor(),
      onPick: pick,
      tooltip: function (index) {
        var p = curve[index];
        return '<div class="tt-date">' + amount(p.gross) + '</div>' +
          row(T.t('series.net'), amount(p.net)) +
          row(T.t('series.ss'), amount(p.ss)) +
          row(T.t('series.irpfState'), amount(p.irpfEstatal)) +
          row(T.t('series.irpfRegion'), amount(p.irpfAutonomico)) +
          (state.mode === 'autonomo' ? row(T.t('series.expenses'), amount(p.gastos)) : '');
      },
    });
  }

  function row(name, value) {
    return '<div class="tt-row"><span class="tt-name">' + name + '</span><span class="tt-value">' + value + '</span></div>';
  }

  function pick(x) {
    state.gross = Math.max(0, Math.min(state.max, Math.round(x / STEP) * STEP));
    render(false);
  }

  // --- bad stretches ------------------------------------------------------

  function renderZones(host) {
    var blocks = [];

    // Twelve identical cards say the same thing twelve times. One card with
    // the edges as rows says it once and stays readable.
    var trapTable = '';
    if (analysis.traps.length === 1) {
      var only = analysis.traps[0];
      blocks.push(
        '<article class="zone trap"><h3>' + T.t('zones.trap') + '</h3>' +
        '<p>' + T.t('zones.trapBody', {
          from: '<b>' + amount(only.from) + '</b>',
          to: '<b>' + amount(only.to) + '</b>',
          loss: '<b>' + amount(only.loss) + '</b>',
          recovery: only.recovery == null ? '—' : '<b>' + amount(only.recovery) + '</b>',
          dead: only.deadZone == null ? '—' : amount(only.deadZone),
        }) + '</p>' +
        '<p class="why">' + T.t('zones.trapWhy') + '</p>' +
        '<button type="button" class="chip" data-goto="' + only.from + '">' + amount(only.from) + ' →</button>' +
        '</article>');
    } else if (analysis.traps.length > 1) {
      trapTable = card(T.t('zones.trapsHeading'), T.t('zones.trapsIntro', { n: analysis.traps.length }),
        '<div class="table-wrap"><table class="steps"><thead><tr>' +
        '<th>' + T.t('zones.trapFrom') + '</th>' +
        '<th class="num">' + T.t('zones.trapLoss') + '</th>' +
        '<th class="num">' + T.t('zones.trapBack') + '</th>' +
        '<th class="num">' + T.t('zones.trapDead') + '</th><th></th>' +
        '</tr></thead><tbody>' + analysis.traps.map(function (trap) {
          return '<tr><td>' + amount(trap.from) + '</td>' +
            '<td class="num strong">−' + amount(trap.loss) + '</td>' +
            '<td class="num">' + (trap.recovery == null ? '—' : amount(trap.recovery)) + '</td>' +
            '<td class="num">' + (trap.deadZone == null ? '—' : amount(trap.deadZone)) + '</td>' +
            '<td class="num"><button type="button" class="chip small" data-goto="' + trap.from + '">→</button></td>' +
            '</tr>';
        }).join('') + '</tbody></table></div>');
    }

    analysis.spikes.forEach(function (spike) {
      blocks.push(
        '<article class="zone spike"><h3>' + T.t('zones.spike', { peak: pct(spike.peak, 0) }) + '</h3>' +
        '<p>' + T.t('zones.spikeBody', {
          from: '<b>' + amount(spike.from) + '</b>',
          to: '<b>' + amount(spike.to) + '</b>',
          keep: '<b>' + euro(1 - spike.average, 2) + '</b>',
          average: pct(spike.average),
        }) + '</p>' +
        '<p class="why">' + (isArt20(spike) ? T.t('zones.spikeWhy') : T.t('zones.spikeWhyGeneric')) + '</p>' +
        '<p class="why">' + T.t('zones.jump', {
          gross: '<b>' + amount(spike.to) + '</b>',
          rate: pct(marginalAt(spike.to + STEP * 2)),
        }) + '</p>' +
        '<button type="button" class="chip" data-goto="' + spike.from + '">' + amount(spike.from) + ' →</button>' +
        '</article>');
    });

    // Ranked by what the stretch above costs, then read back in income order:
    // a list of twenty edges is a list nobody reads.
    var sweet = analysis.edges.map(function (edge) {
      return { gross: edge.gross, rate: marginalAt(edge.gross + STEP) };
    }).sort(function (a, b) {
      return b.rate - a.rate;
    }).slice(0, 8).sort(function (a, b) {
      return a.gross - b.gross;
    }).map(function (edge) {
      return '<li>' + T.t('zones.sweetBody', {
        gross: '<b>' + amount(edge.gross) + '</b>',
        rate: pct(edge.rate),
      }) + '</li>';
    }).join('');

    host.innerHTML =
      card(T.t('zones.heading'), T.t('chart.ratesSub'),
        '<div class="chart-box" id="chart-rates"></div>' + legend([
          { label: T.t('series.marginal'), color: color('--critical') },
          { label: T.t('series.effective'), color: color('--series-1') },
        ]) + bandLegend()) +
      trapTable +
      (blocks.length ? '<div class="zones">' + blocks.join('') + '</div>'
        : trapTable ? '' : card('', '', '<p class="muted">' + T.t('zones.none') + '</p>')) +
      (sweet ? card(T.t('zones.sweet'), '', '<ul class="sweet">' + sweet + '</ul>') : '');

    drawRates();

    Array.prototype.forEach.call(host.querySelectorAll('[data-goto]'), function (button) {
      button.addEventListener('click', function () {
        state.gross = Number(button.getAttribute('data-goto'));
        state.view = 'overview';
        render(false);
      });
    });
  }

  // The art. 20 withdrawal is the only spike that can happen below the end of
  // the reduction, so its position identifies it without hard-coded euros.
  function isArt20(spike) {
    if (state.mode !== 'empleado') return false;
    var end = params.trabajo.reduccionArt20.techo;
    return spike.from <= end * 1.35;
  }

  // --- steps --------------------------------------------------------------

  function reasonFor(step) {
    var mid = (step.from + step.to) / 2;
    var here = at(Math.max(0, step.from));
    var next = at(Math.min(state.max, step.to));
    var dGross = Math.max(1, next.gross - here.gross);
    var dSS = (next.ss - here.ss) / dGross;
    var maxBase = params.seguridadSocial.baseMaxMes * 12;

    if (state.mode === 'autonomo' && dSS > 0.25) return T.t('reason.reta');
    if (here.irpf <= 0 && next.irpf <= 0) return T.t('reason.ssFloor');
    if (state.mode === 'empleado' && here.reduccion > 0 && next.reduccion < here.reduccion) return T.t('reason.art20');
    if (mid > maxBase) return T.t('reason.ssCap');
    if (state.mode === 'empleado' && dSS > 0.01) return T.t('reason.mix');
    return T.t('reason.bracket');
  }

  function renderSteps(host) {
    // One-sample segments are the trap edges; they belong to the zones view,
    // not to a table of stretches, so fold anything narrower than 2 samples.
    var rows = analysis.steps.filter(function (step) {
      return step.to - step.from >= STEP * 2;
    }).map(function (step) {
      var tone = step.rate >= 0.5 ? ' class="bad"' : step.rate >= 0.42 ? ' class="warn"' : '';
      return '<tr' + tone + '>' +
        '<td>' + amount(step.from) + '</td>' +
        '<td>' + amount(step.to) + '</td>' +
        '<td class="num">' + amount(step.to - step.from) + '</td>' +
        '<td class="num strong">' + pct(step.rate) + '</td>' +
        '<td class="num">' + euro(1 - step.rate, 2) + '</td>' +
        '<td class="reason">' + reasonFor(step) + '</td>' +
        '</tr>';
    }).join('');

    host.innerHTML = card(T.t('steps.heading'), T.t('steps.sub'),
      '<div class="table-wrap"><table class="steps"><thead><tr>' +
      '<th>' + T.t('steps.from') + '</th><th>' + T.t('steps.to') + '</th>' +
      '<th class="num">' + T.t('steps.width') + '</th>' +
      '<th class="num">' + T.t('steps.marginal') + '</th>' +
      '<th class="num">' + T.t('steps.keep') + '</th>' +
      '<th>' + T.t('steps.reason') + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }

  // --- compare ------------------------------------------------------------

  var COMPARE_COLORS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5'];

  function renderCompare(host) {
    var regionSeries = params.regiones.map(function (region, index) {
      var points = engine.curve(Object.assign({}, input(), { region: region.id }),
        { from: 0, to: state.max, step: STEP * 5 });
      return {
        id: region.id,
        label: region.name,
        color: color(COMPARE_COLORS[index % COMPARE_COLORS.length]),
        points: points.map(function (p) { return { x: p.gross, y: p.efectivo }; }),
        net: points,
      };
    });

    var modeSeries = ['empleado', 'autonomo'].map(function (mode, index) {
      var points = engine.curve(Object.assign({}, input(), {
        mode: mode,
        gastosPct: mode === 'autonomo' ? state.gastosPct : null,
      }), { from: 0, to: state.max, step: STEP * 5 });
      return {
        id: mode,
        label: T.t(mode === 'empleado' ? 'in.employee' : 'in.autonomo'),
        color: color(index ? '--series-2' : '--series-1'),
        points: points.map(function (p) { return { x: p.gross, y: p.net }; }),
      };
    });

    var here = state.gross;
    var rows = params.regiones.map(function (region) {
      var base = Object.assign({}, input(), { region: region.id, gross: here });
      if (state.mode === 'autonomo') base.gastosActividad = here * state.gastosPct;
      return { region: region, result: engine.compute(base) };
    }).sort(function (a, b) { return b.result.net - a.result.net; });
    var best = rows.length ? rows[0].result.net : 0;

    host.innerHTML =
      card(T.t('chart.compareTitle'), T.t('chart.compareSub'),
        '<div class="chart-box" id="chart-regions"></div>' +
        legend(regionSeries.map(function (s) { return { label: s.label, color: s.color }; }))) +
      card(T.t('compare.table', { gross: amount(here) }), '',
        '<div class="table-wrap"><table class="steps"><thead><tr>' +
        '<th>' + T.t('in.region') + '</th><th class="num">' + T.t('kpi.net') + '</th>' +
        '<th class="num">' + T.t('kpi.irpf') + '</th><th class="num">' + T.t('kpi.effective') + '</th><th></th>' +
        '</tr></thead><tbody>' + rows.map(function (entry, index) {
          var diff = best - entry.result.net;
          return '<tr><td>' + entry.region.name + (entry.region.verified ? '' : ' <span class="tiny">*</span>') + '</td>' +
            '<td class="num strong">' + amountBoth(entry.result.net) + '</td>' +
            '<td class="num">' + amount(entry.result.irpf) + '</td>' +
            '<td class="num">' + pct(entry.result.tipoEfectivo) + '</td>' +
            '<td class="num tiny">' + (index === 0 ? '<span class="badge good">' + T.t('compare.best') + '</span>'
              : T.t('compare.diff', { amount: amount(diff) })) + '</td></tr>';
        }).join('') + '</tbody></table></div>') +
      card(T.t('chart.modesTitle'), T.t('chart.modesSub'),
        '<div class="chart-box" id="chart-modes"></div>' +
        legend(modeSeries.map(function (s) { return { label: s.label, color: s.color }; })));

    global.IrpfCharts.plot(document.getElementById('chart-regions'), {
      height: 260,
      cursor: state.gross,
      series: regionSeries,
      xFormat: amountShort,
      xTickUnit: divisor(),
      yFormat: function (v) { return pct(v, 0); },
      onPick: pick,
      tooltip: function (index, x) {
        return '<div class="tt-date">' + amount(x) + '</div>' + regionSeries.map(function (s) {
          return row(s.label, pct(s.points[index].y));
        }).join('');
      },
    });

    global.IrpfCharts.plot(document.getElementById('chart-modes'), {
      height: 260,
      cursor: state.gross,
      series: modeSeries,
      xFormat: amountShort,
      yFormat: amountShort,
      xTickUnit: divisor(),
      yTickUnit: divisor(),
      onPick: pick,
      tooltip: function (index, x) {
        return '<div class="tt-date">' + amount(x) + '</div>' + modeSeries.map(function (s) {
          return row(s.label, amount(s.points[index].y));
        }).join('');
      },
    });
  }

  // --- housing ------------------------------------------------------------

  function mortgageOptions(years) {
    return {
      years: years,
      ahorro: state.ahorro,
      rate: state.interes == null ? params.hipoteca.tipoInteres : state.interes,
      ratio: state.ratioCuota == null ? params.hipoteca.ratioCuotaSobreNeto : state.ratioCuota,
    };
  }

  function renderHousing(host) {
    var maxTerm = engine.plazoMaximo(state.edad);
    var terms = params.hipoteca.plazosHabituales.filter(function (years) {
      return years <= maxTerm;
    });
    if (!terms.length) terms = [maxTerm];
    var term = Math.min(state.plazo, maxTerm);

    var here = at(state.gross);
    var deal = engine.hipoteca(here.net / 12, mortgageOptions(term));
    var byIncome = deal.limitadoPor === 'renta';
    var rate = state.interes == null ? params.hipoteca.tipoInteres : state.interes;
    var ratio = state.ratioCuota == null ? params.hipoteca.ratioCuotaSobreNeto : state.ratioCuota;

    var settings =
      field(T.t('house.savings'),
        '<span class="field-input"><input type="number" id="in-ahorro" min="0" max="2000000" step="5000" value="' +
        Math.round(state.ahorro) + '"><span class="unit">€</span></span>') +
      field(T.t('house.term'),
        '<select id="in-plazo">' + options(terms.map(function (years) {
          return { value: years, label: T.t('house.years', { n: years }) };
        }), term) + '</select>',
        T.t('house.ageNote', { age: params.hipoteca.edadFinMax, years: maxTerm })) +
      field(T.t('house.rate'),
        '<span class="field-input"><input type="number" id="in-interes" min="0" max="15" step="0.1" value="' +
        (rate * 100).toFixed(1) + '"><span class="unit">%</span></span>') +
      field(T.t('house.ratio'),
        '<span class="field-input"><input type="number" id="in-ratio" min="10" max="60" step="1" value="' +
        Math.round(ratio * 100) + '"><span class="unit">%</span></span>',
        T.t('house.ratioNote'));

    var cards =
      kpi(T.t('house.price'), euro(deal.precio), T.t('house.loan') + ' ' + euro(deal.prestamo)) +
      kpi(T.t('house.payment'), euro(deal.cuota),
        T.t('house.paymentNote', { share: pct(deal.ratioCuota, 0) })) +
      kpi(T.t('house.ownMoney'), euro(deal.entrada + deal.gastos),
        T.t('house.ownMoneyNote', { down: euro(deal.entrada), costs: euro(deal.gastos) })) +
      kpi(T.t('house.limited'), T.t(byIncome ? 'house.limitedIncome' : 'house.limitedSavings'),
        byIncome ? T.t('house.limitedIncomeNote')
          : T.t('house.limitedSavingsNote', {
            amount: euro(deal.ahorroNecesario),
            price: euro(deal.precioPorRenta),
          }),
        byIncome ? '' : 'warn') +
      kpi(T.t('house.interest'), euro(deal.totalIntereses), T.t('house.years', { n: term }));

    var lines = terms.map(function (years, index) {
      return {
        id: 'term' + years,
        label: T.t('house.years', { n: years }),
        color: color(COMPARE_COLORS[index % COMPARE_COLORS.length]),
        width: years === term ? 2.4 : 1.6,
        points: curve.map(function (point) {
          return { x: point.gross, y: engine.hipoteca(point.net / 12, mortgageOptions(years)).precio };
        }),
      };
    });
    var ceiling = state.ahorro / (1 - params.hipoteca.ltvMax + params.hipoteca.gastosCompraPct);

    host.innerHTML =
      card(T.t('house.heading'), T.t('house.sub'),
        '<div class="panel housing-settings">' + settings + '</div>' +
        '<div class="kpis">' + cards + '</div>') +
      card(T.t('house.chartTitle'), T.t('house.chartSub'),
        '<div class="chart-box" id="chart-housing"></div>' +
        legend(lines.map(function (line) { return { label: line.label, color: line.color }; })
          .concat([{ label: T.t('house.ceiling'), color: color('--muted'), dashed: true }])) +
        '<p class="tiny">' + T.t('house.assumptions') + '</p>');

    global.IrpfCharts.plot(document.getElementById('chart-housing'), {
      height: 280,
      cursor: state.gross,
      series: lines.concat([{
        id: 'ceiling',
        label: T.t('house.ceiling'),
        color: color('--muted'),
        dashed: true,
        points: curve.map(function (point) { return { x: point.gross, y: ceiling }; }),
      }]),
      xFormat: amountShort,
      xTickUnit: divisor(),
      yFormat: euroShort,
      onPick: pick,
      tooltip: function (index, x) {
        return '<div class="tt-date">' + amount(x) + '</div>' + lines.map(function (line) {
          return row(line.label, euro(line.points[index].y));
        }).join('') + row(T.t('house.ceiling'), euro(ceiling));
      },
    });

    bind('in-ahorro', 'change', function (event) {
      state.ahorro = Math.max(0, Number(event.target.value) || 0);
      rerender(false);
    });
    bind('in-plazo', 'change', function (event) {
      state.plazo = Number(event.target.value);
      render(false);
    });
    bind('in-interes', 'change', function (event) {
      state.interes = Math.max(0, Math.min(0.15, (Number(event.target.value) || 0) / 100));
      rerender(false);
    });
    bind('in-ratio', 'change', function (event) {
      state.ratioCuota = Math.max(0.1, Math.min(0.6, (Number(event.target.value) || 0) / 100));
      rerender(false);
    });
  }

  // --- pension ------------------------------------------------------------

  var PENSION_MAX_YEARS = 45;

  // What is true today — age, the year the career started, the years
  // contributed so far — and everything else follows from it. The start year
  // is a fact and stays put when the age changes; the years so far can never
  // exceed the years since the start, and are less when there were gaps.
  function birthYear() {
    return ANIO_ACTUAL - state.edad;
  }

  function startAge() {
    return state.anioInicio - birthYear();
  }

  function maxDone() {
    return Math.max(0, ANIO_ACTUAL - state.anioInicio);
  }

  function clampPension() {
    var earliest = birthYear() + 14;
    if (state.anioInicio == null) state.anioInicio = birthYear() + 23;
    state.anioInicio = Math.max(earliest, Math.min(ANIO_ACTUAL, Math.round(state.anioInicio)));
    if (state.cotizados == null) state.cotizados = maxDone();
    state.cotizados = Math.max(0, Math.min(maxDone(), Math.round(state.cotizados)));
  }

  function career() {
    return engine.calendarioJubilacion(state.edad, state.cotizados, ANIO_ACTUAL);
  }

  function pensionInput(gross, retireAge) {
    var base = Object.assign({}, input(), { gross: gross, edadJubilacion: retireAge });
    if (state.mode === 'autonomo') base.gastosActividad = gross * state.gastosPct;
    return base;
  }

  // Years of contributions at a given age: the past spread evenly over the
  // years since the start (gaps are not guessed at), then one a year from
  // today until the pension starts, flat after that.
  function stageAt(age, c) {
    var now = state.edad;
    var from = startAge();
    if (age <= from) return 0;
    if (age <= now) return now > from ? state.cotizados * (age - from) / (now - from) : state.cotizados;
    return Math.min(c.anos, state.cotizados + (age - now));
  }

  // Label and value on top, the note under the slider where it can wrap.
  function sliderRow(id, label, min, max, value) {
    return '<div class="slider-row">' +
      '<div class="slider-head"><label for="' + id + '" class="field-label">' + label + '</label>' +
      '<b class="slider-value" id="' + id + '-value"></b></div>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="1" value="' + value + '">' +
      '<span class="tiny slider-note" id="' + id + '-note"></span>' +
      '</div>';
  }

  // The sliders live inside the view they drive, so dragging one must not
  // rebuild it: the view is laid out once, and only bounds, labels, cards and
  // charts change while the thumb moves.
  function renderPension(host) {
    clampPension();
    host.innerHTML =
      card(T.t('pen.heading'), T.t('pen.sub'),
        '<div class="pension-controls">' +
        sliderRow('pen-age', T.t('pen.nowAge'), 18, 75, state.edad) +
        sliderRow('pen-start', T.t('pen.startYear'), birthYear() + 14, ANIO_ACTUAL, state.anioInicio) +
        sliderRow('pen-done', T.t('pen.done'), 0, maxDone(), state.cotizados) +
        '</div>' +
        '<p class="career-note" id="pen-reason"></p>' +
        '<div class="kpis" id="pen-kpis"></div>') +
      card(T.t('pen.chartWhen'), T.t('pen.chartWhenSub'),
        '<div class="chart-box" id="chart-pension-when"></div>' +
        legend([
          { label: T.t('pen.seriesStage'), color: color('--series-1') },
          { label: T.t('pen.seriesMin'), color: color('--critical'), dashed: true },
          { label: T.t('pen.seriesEarly'), color: color('--series-3'), dashed: true },
        ]) +
        '<div class="legend"><span class="legend-item"><i class="swatch band-flat"></i>' + T.t('pen.bandPast') +
        '</span><span class="legend-item"><i class="swatch band-paid"></i>' + T.t('pen.bandPaid') + '</span></div>') +
      card(T.t('pen.chartYears'), T.t('pen.chartYearsSub'),
        '<div class="chart-box" id="chart-pension-years"></div>' +
        legend([
          { label: T.t('pen.seriesGross'), color: color('--series-1') },
          { label: T.t('pen.seriesNet'), color: color('--series-3') },
        ]) +
        '<div class="legend"><span class="legend-item"><i class="swatch band-trap"></i>' + T.t('pen.bandNone') +
        '</span><span class="legend-item"><i class="swatch band-flat"></i>' + T.t('pen.bandFull') + '</span></div>') +
      card(T.t('pen.chartLife'), T.t('pen.chartLifeSub'),
        '<div class="chart-box" id="chart-pension-life"></div>' +
        legend([
          { label: T.t('pen.seriesPaid'), color: color('--series-2') },
          { label: T.t('pen.seriesReceived'), color: color('--series-1') },
        ])) +
      card(T.t('pen.chartIncome'), T.t('pen.chartIncomeSub'),
        '<div class="chart-box" id="chart-pension-income"></div>' +
        legend([
          { label: T.t('pen.seriesGross'), color: color('--series-1') },
          { label: T.t('pen.seriesNet'), color: color('--series-3') },
          { label: T.t('pen.seriesCap'), color: color('--muted'), dashed: true },
        ]) +
        '<p class="tiny">' + T.t('pen.assumptions') + '</p>');

    function commit() {
      saveState();
      // The age is shared with the tax settings, which read it for the
      // 65 and 75 allowances.
      var ageBox = document.getElementById('in-edad');
      if (ageBox) ageBox.value = String(state.edad);
    }

    function on(id, apply) {
      var node = document.getElementById(id);
      if (!node) return;
      node.addEventListener('input', function () {
        apply(Number(node.value));
        syncPensionControls();
        updatePension();
      });
      node.addEventListener('change', commit);
    }

    on('pen-age', function (value) {
      state.edad = value;
      clampPension();
    });
    on('pen-start', function (value) {
      // An unbroken career stays unbroken when its start moves.
      var full = state.cotizados >= maxDone();
      state.anioInicio = value;
      if (full) state.cotizados = maxDone();
      clampPension();
    });
    on('pen-done', function (value) {
      state.cotizados = value;
      clampPension();
    });

    syncPensionControls();
    updatePension();
  }

  function syncPensionControls() {
    var set = function (id, min, max, value, shown, note) {
      var node = document.getElementById(id);
      if (!node) return;
      node.min = String(min);
      node.max = String(max);
      if (String(node.value) !== String(value)) node.value = String(value);
      document.getElementById(id + '-value').textContent = shown;
      document.getElementById(id + '-note').textContent = note || '';
    };
    set('pen-age', 18, 75, state.edad, String(state.edad), '');
    set('pen-start', birthYear() + 14, ANIO_ACTUAL, state.anioInicio, String(state.anioInicio),
      T.t('pen.startYearNote', { age: startAge() }));
    set('pen-done', 0, maxDone(), state.cotizados, yearsText(state.cotizados),
      T.t('pen.doneNote', { max: yearsText(maxDone()) }));
  }

  function updatePension() {
    var p = params.pension;
    var c = career();
    var j = engine.jubilacion(pensionInput(state.gross, c.edad), c.anos);
    var self = state.mode === 'autonomo';

    var at65 = state.cotizados + Math.max(0, p.edadTemprana - state.edad);
    var at67 = state.cotizados + Math.max(0, p.edadOrdinaria - state.edad);
    var reason = document.getElementById('pen-reason');
    if (reason) {
      reason.textContent = {
        early: T.t('pen.reasonEarly', { years: yearsText(at65), year: c.anio }),
        ordinary: T.t('pen.reasonOrdinary', { years65: yearsText(at65), year: c.anio }),
        minimum: T.t('pen.reasonMinimum', { years67: yearsText(at67), age: c.edad, year: c.anio }),
        now: T.t('pen.reasonNow', { years: yearsText(c.anos) }),
      }[c.razon];
      reason.className = 'career-note' + (c.razon === 'minimum' ? ' bad' : '');
    }

    var paidNote = self ? T.t('pen.paidOwn')
      : T.t('pen.paidNote', { own: euro(j.cotizadoTrabajador), employer: euro(j.cotizadoEmpresa) });

    var cards =
      kpi(T.t('pen.when'), c.razon === 'now' ? T.t('pen.whenNowValue') : String(c.anio),
        c.razon === 'now'
          ? T.t('pen.whenNowNote', { age: c.edad, life: yearsText(j.anosCobro) })
          : T.t('pen.whenNote', { age: c.edad, wait: yearsText(c.espera), life: yearsText(j.anosCobro) }),
        c.razon === 'minimum' ? 'bad' : '') +
      (j.mensual > 0
        ? kpi(T.t('pen.monthly'),
          euro(j.mensual) + ' <small>(' + T.t('pen.net', { amount: euro(j.netaMensual) }) + ')</small>',
          T.t('pen.monthlyNote', { n: p.pagas, annual: euro(j.anual) }))
        : kpi(T.t('pen.monthly'), T.t('pen.none'), T.t('pen.noneNote', { n: p.anosMinimos }), 'bad')) +
      kpi(T.t('pen.totalYears'), yearsText(c.anos), T.t('pen.totalYearsNote')) +
      kpi(T.t('pen.share'), pct(j.porcentaje, 1),
        j.topada ? T.t('pen.capped', { max: euro(p.pensionMaximaMes) })
          : T.t('pen.shareNote', { base: euro(j.baseReguladora) }),
        j.topada ? 'warn' : '') +
      kpi(T.t('pen.paid'), euro(j.cotizado), paidNote) +
      kpi(T.t('pen.payback'),
        j.anosRecuperacion == null ? T.t('pen.never')
          : yearsText(Math.round(j.anosRecuperacion * 10) / 10),
        T.t('pen.paybackNote', { life: yearsText(j.anosCobro) }),
        j.anosRecuperacion != null && j.anosRecuperacion > j.anosCobro ? 'bad' : '') +
      kpi(T.t('pen.replacement'), pct(j.sustitucion, 0),
        T.t('pen.replacementNote', { net: euro(j.netaMensual) })) +
      kpi(T.t('pen.lifetime'), euro(j.totalCobrado), T.t('pen.lifetimeNote', { years: yearsText(j.anosCobro) }));
    var kpiHost = document.getElementById('pen-kpis');
    if (kpiHost) kpiHost.innerHTML = cards;

    drawPensionWhen(c, j);
    drawPensionYears(c);
    drawPensionLife(c, j);
    drawPensionIncome(c);
  }

  function yearsText(n) {
    var shown = Math.abs(n % 1) > 0.001 ? fixed(n, 1) : fixed(n, 0);
    return shown + ' ' + T.yearsWord(n);
  }

  function fixed(value, digits) {
    return new Intl.NumberFormat(T.locale(), {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(value);
  }

  // The career on a calendar: years of contributions against the year, with
  // the two thresholds that decide the start — 15 years at all, 38,5 by 65.
  function drawPensionWhen(c, j) {
    var hostChart = document.getElementById('chart-pension-when');
    if (!hostChart) return;
    var p = params.pension;
    var first = state.anioInicio;
    var last = Math.max(c.anio + 6, ANIO_ACTUAL + 6);
    var points = [];
    for (var year = first; year <= last; year += 1) {
      var age = year - birthYear();
      points.push({ year: year, age: age, y: stageAt(age, c) });
    }
    var marks = [{ x: c.anio, label: T.t('pen.markPension') }];
    if (c.anio - ANIO_ACTUAL >= 3) marks.unshift({ x: ANIO_ACTUAL, label: T.t('pen.markNow') });
    global.IrpfCharts.plot(hostChart, {
      height: 260,
      yMax: Math.max(p.anosParaEdadTemprana, c.anos) * 1.12,
      cursor: c.anio,
      bands: [
        { from: first, to: ANIO_ACTUAL, kind: 'flat' },
        { from: c.anio, to: last, kind: 'paid' },
      ],
      marks: marks,
      series: [
        { id: 'stage', color: color('--series-1'), width: 2.4, points: points.map(function (pt) { return { x: pt.year, y: pt.y }; }) },
        { id: 'min', color: color('--critical'), dashed: true, points: points.map(function (pt) { return { x: pt.year, y: p.anosMinimos }; }) },
        { id: 'early', color: color('--series-3'), dashed: true, points: points.map(function (pt) { return { x: pt.year, y: p.anosParaEdadTemprana }; }) },
      ],
      xFormat: function (v) { return String(Math.round(v)); },
      yFormat: function (v) { return T.t('pen.yearsShort', { n: Math.round(v) }); },
      tooltip: function (index) {
        var pt = points[index];
        return '<div class="tt-date">' + T.t('pen.ttYear', { year: pt.year, age: pt.age }) + '</div>' +
          row(pt.year <= ANIO_ACTUAL ? T.t('pen.seriesDone') : T.t('pen.totalYears'), yearsText(Math.round(pt.y * 10) / 10)) +
          (pt.year >= c.anio && j.mensual > 0 ? row(T.t('pen.bandPaid'), euro(j.mensual)) : '');
      },
    });
  }

  function drawPensionYears(c) {
    var hostChart = document.getElementById('chart-pension-years');
    if (!hostChart) return;
    var p = params.pension;
    var fullAt = p.anosMinimos + p.tramos.reduce(function (sum, t) { return sum + t.meses; }, 0) / 12;
    var points = [];
    for (var y = 0; y <= PENSION_MAX_YEARS + 1e-9; y += 0.5) {
      points.push({ years: y, result: engine.jubilacion(pensionInput(state.gross, c.edad), y) });
    }
    var current = engine.jubilacion(pensionInput(state.gross, c.edad), c.anos);
    global.IrpfCharts.plot(hostChart, {
      height: 260,
      yMax: Math.max(p.pensionMaximaMes, current.baseReguladora) * 1.08,
      cursor: Math.min(PENSION_MAX_YEARS, c.anos),
      bands: [
        { from: 0, to: p.anosMinimos, kind: 'trap' },
        { from: fullAt, to: PENSION_MAX_YEARS, kind: 'flat' },
      ],
      marks: [
        { x: p.anosMinimos, label: T.t('pen.yearsShort', { n: p.anosMinimos }) },
        { x: fullAt, label: T.t('pen.markFull') },
      ],
      series: [
        { id: 'gross', color: color('--series-1'), points: points.map(function (pt) { return { x: pt.years, y: pt.result.mensual }; }) },
        { id: 'net', color: color('--series-3'), points: points.map(function (pt) { return { x: pt.years, y: pt.result.netaMensual }; }) },
      ],
      xFormat: function (v) { return T.t('pen.yearsShort', { n: Math.round(v) }); },
      yFormat: euroShort,
      tooltip: function (index) {
        var pt = points[index];
        return '<div class="tt-date">' + yearsText(pt.years) + '</div>' +
          row(T.t('pen.share'), pct(pt.result.porcentaje, 1)) +
          row(T.t('pen.seriesGross'), euro(pt.result.mensual)) +
          row(T.t('pen.seriesNet'), euro(pt.result.netaMensual));
      },
    });
  }

  // Cumulative euros across a life: what the career pays in, rising with the
  // years of contributions, and what the pension pays out from its start.
  function drawPensionLife(c, j) {
    var hostChart = document.getElementById('chart-pension-life');
    if (!hostChart) return;
    var from = startAge();
    var end = Math.max(c.edad + j.anosCobro + 6, 90);
    var perYear = c.anos > 0 ? j.cotizado / c.anos : 0;
    var paid = [];
    var received = [];
    for (var age = from; age <= end; age += 1) {
      paid.push({ x: age, y: perYear * stageAt(age, c) });
      received.push({ x: age, y: Math.max(0, age - c.edad) * j.anual });
    }
    global.IrpfCharts.plot(hostChart, {
      height: 260,
      cursor: j.anosRecuperacion != null ? c.edad + j.anosRecuperacion : null,
      marks: [{ x: c.edad, label: String(c.edad) }, { x: c.edad + j.anosCobro, label: T.t('pen.markLife') }],
      series: [
        { id: 'paid', color: color('--series-2'), points: paid },
        { id: 'received', color: color('--series-1'), points: received },
      ],
      xFormat: function (v) { return String(Math.round(v)); },
      yFormat: euroShort,
      tooltip: function (index, x) {
        return '<div class="tt-date">' + T.t('pen.age0', { n: Math.round(x) }) + '</div>' +
          row(T.t('pen.seriesPaid'), euro(paid[index].y)) +
          row(T.t('pen.seriesReceived'), euro(received[index].y));
      },
    });
  }

  function drawPensionIncome(c) {
    var hostChart = document.getElementById('chart-pension-income');
    if (!hostChart) return;
    var p = params.pension;
    var step = Math.max(STEP, Math.round(state.max / 240 / STEP) * STEP);
    var points = [];
    for (var g = 0; g <= state.max + 1e-9; g += step) {
      points.push({ gross: g, result: engine.jubilacion(pensionInput(g, c.edad), c.anos) });
    }
    global.IrpfCharts.plot(hostChart, {
      height: 260,
      yMax: p.pensionMaximaMes * 1.12,
      cursor: state.gross,
      series: [
        { id: 'gross', color: color('--series-1'), points: points.map(function (pt) { return { x: pt.gross, y: pt.result.mensual }; }) },
        { id: 'net', color: color('--series-3'), points: points.map(function (pt) { return { x: pt.gross, y: pt.result.netaMensual }; }) },
        { id: 'cap', color: color('--muted'), dashed: true,
          points: points.map(function (pt) { return { x: pt.gross, y: p.pensionMaximaMes }; }) },
      ],
      xFormat: amountShort,
      xTickUnit: divisor(),
      yFormat: euroShort,
      onPick: pick,
      tooltip: function (index) {
        var pt = points[index];
        return '<div class="tt-date">' + amount(pt.gross) + '</div>' +
          row(T.t('pen.seriesGross'), euro(pt.result.mensual)) +
          row(T.t('pen.seriesNet'), euro(pt.result.netaMensual)) +
          row(T.t('pen.paid'), euro(pt.result.cotizado));
      },
    });
  }

  // --- about --------------------------------------------------------------

  function renderAbout() {
    var host = document.getElementById('about');
    var scales = [params.escalaEstatal].concat(params.regiones).map(function (item) {
      return '<li><b>' + (item.label || item.name) + '</b> ' +
        '<span class="badge ' + (item.verified ? 'good' : 'warn') + '">' +
        T.t(item.verified ? 'about.verified' : 'about.unverified') + '</span>' +
        '<span class="tiny block">' + item.source + '</span></li>';
    }).join('');

    host.innerHTML = card(T.t('about.heading'), '',
      '<p class="muted">' + T.t('about.body', { step: amount(STEP) }) + '</p>' +
      '<h3>' + T.t('about.assumptions') + '</h3>' +
      '<p class="muted">' + T.t('about.assumptionsBody') + '</p>' +
      '<h3>' + T.t('about.params') + '</h3>' +
      '<ul class="sources">' + scales +
      [
        { name: 'Seguridad Social', item: params.seguridadSocial },
        { name: 'RETA', item: params.autonomos },
        { name: T.t('nav.pension'), item: params.pension },
        { name: T.t('nav.housing'), item: params.hipoteca },
      ].map(function (entry) {
        return '<li><b>' + entry.name + '</b> <span class="badge ' + (entry.item.verified ? 'good' : 'warn') + '">' +
          T.t(entry.item.verified ? 'about.verified' : 'about.unverified') + '</span>' +
          '<span class="tiny block">' + entry.item.source + '</span></li>';
      }).join('') +
      '</ul>' +
      '<p class="tiny">' + T.t('about.year', { year: params.year, date: params.checked }) + ' ' +
      T.t('about.edit', { year: params.year }) + '</p>' +
      '<p class="disclaimer">' + T.t('about.disclaimer') + '</p>');
  }

  // --- shell --------------------------------------------------------------

  function renderView() {
    var host = document.getElementById('view');
    if (state.view === 'pension') renderPension(host);
    else if (state.view === 'housing') renderHousing(host);
    else if (state.view === 'zones') renderZones(host);
    else if (state.view === 'steps') renderSteps(host);
    else if (state.view === 'compare') renderCompare(host);
    else renderOverview(host);
  }

  function render(withPanel) {
    rebuild();
    if (withPanel) renderPanel();
    renderCursor();
    renderTabs();
    renderView();
    renderAbout();
    saveState();
  }

  function renderTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var view = tab.getAttribute('data-view');
      tab.setAttribute('aria-selected', String(view === state.view));
      tab.textContent = T.t('nav.' + view);
    });
  }

  function applyStaticStrings() {
    document.documentElement.lang = T.lang();
    document.title = T.t('tax.title');
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = T.t(node.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-title]'), function (node) {
      node.title = T.t(node.getAttribute('data-i18n-title'));
    });
    var langButton = document.getElementById('lang-btn');
    if (langButton) langButton.textContent = T.label();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'system' ? '' : theme);
  }

  var THEMES = ['system', 'light', 'dark'];

  function boot() {
    loadState();
    T.set(T.detect(state.lang));
    applyTheme(state.theme);
    applyStaticStrings();

    document.getElementById('lang-btn').addEventListener('click', function () {
      state.lang = T.set(T.next());
      applyStaticStrings();
      render(true);
    });

    document.getElementById('theme-btn').addEventListener('click', function () {
      state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
      applyTheme(state.theme);
      render(false);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        state.view = tab.getAttribute('data-view');
        render(false);
      });
    });

    var redraw = null;
    global.addEventListener('resize', function () {
      clearTimeout(redraw);
      redraw = setTimeout(function () {
        applyPanelState();
        renderView();
      }, 150);
    });

    // A single-file build of this page carries the parameters inline; the site
    // fetches them. Same engine either way.
    var inline = document.getElementById('tax-params');
    if (inline) {
      params = JSON.parse(inline.textContent);
      engine = global.IrpfEngine.create(params);
      render(true);
      return;
    }

    fetch(PARAMS_URL, { cache: 'no-cache' })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        params = data;
        engine = global.IrpfEngine.create(params);
        render(true);
      })
      .catch(function () {
        document.getElementById('view').innerHTML =
          '<section class="card"><p class="muted">' + PARAMS_URL + '</p></section>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
