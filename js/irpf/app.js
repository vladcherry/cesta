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
  var PARAMS_URL = 'data/tax/es-2026.json';
  var SETTINGS_KEY = 'cesta.tax';

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
    edad: 'under65',
    pension: 0,
    gastosPct: 0.15,
    pagas: 12,
    max: 120000,
    view: 'overview',
    panelOpen: null, // null -> open on a wide screen, closed on a phone
  };

  var curve = [];
  var analysis = null;

  // --- formatting ---------------------------------------------------------

  function euro(value, digits) {
    return new Intl.NumberFormat(T.locale(), {
      style: 'currency', currency: 'EUR',
      minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0,
    }).format(value || 0);
  }

  function euroShort(value) {
    if (Math.abs(value) >= 1000) {
      return new Intl.NumberFormat(T.locale(), { maximumFractionDigits: 0 }).format(Math.round(value / 1000)) + 'k €';
    }
    return euro(value);
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
    ['mode', 'region', 'contrato', 'edad', 'view'].forEach(function (key) {
      if (query.has(key)) state[key] = query.get(key);
    });
    ['gross', 'hijos', 'hijosMenores3', 'pension', 'max', 'pagas'].forEach(function (key) {
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
        mode: state.mode, region: state.region, gross: String(state.gross), view: state.view,
      });
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
      edad65: state.edad === 'over65' || state.edad === 'over75',
      edad75: state.edad === 'over75',
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
      field(T.t('in.age'),
        '<select id="in-edad">' + options([
          { value: 'under65', label: T.t('in.under65') },
          { value: 'over65', label: T.t('in.over65') },
          { value: 'over75', label: T.t('in.over75') },
        ], state.edad) + '</select>') +
      field(T.t('in.pension'), '<span class="field-input"><input type="number" id="in-pension" min="0" max="1500" ' +
        'step="100" value="' + state.pension + '"><span class="unit">€</span></span>') +
      field(T.t('in.range'),
        '<select id="in-max">' + options([
          { value: 60000, label: '60k' }, { value: 120000, label: '120k' },
          { value: 200000, label: '200k' }, { value: 400000, label: '400k' },
        ], state.max) + '</select>');

    host.innerHTML = html;

    bind('in-mode', 'change', function (event) { state.mode = event.target.value; render(true); });
    bind('in-region', 'change', function (event) { state.region = event.target.value; render(true); });
    bind('in-contrato', 'change', function (event) { state.contrato = event.target.value; render(true); });
    bind('in-gastos', 'change', function (event) {
      state.gastosPct = Math.min(0.9, Math.max(0, Number(event.target.value) / 100));
      render(true);
    });
    bind('in-hijos', 'change', function (event) {
      state.hijos = Math.max(0, Number(event.target.value) || 0);
      state.hijosMenores3 = Math.min(state.hijosMenores3, state.hijos);
      render(true);
    });
    bind('in-menores3', 'change', function (event) {
      state.hijosMenores3 = Math.max(0, Number(event.target.value) || 0);
      render(true);
    });
    bind('in-edad', 'change', function (event) { state.edad = event.target.value; render(true); });
    bind('in-pension', 'change', function (event) {
      state.pension = Math.max(0, Number(event.target.value) || 0);
      render(true);
    });
    bind('in-max', 'change', function (event) {
      state.max = Number(event.target.value);
      if (state.gross > state.max) state.gross = state.max;
      render(true);
    });
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

  function renderCursor() {
    var host = document.getElementById('cursor');
    host.innerHTML =
      '<div class="cursor-row">' +
      '<div class="cursor-value"><input type="number" id="in-gross" min="0" max="' + state.max +
      '" step="500" value="' + Math.round(state.gross) + '"><span class="unit">€<span class="per"> ' +
      T.t('common.perYear') + '</span></span></div>' +
      '<label class="field grow"><span class="field-label">' + T.t('in.gross') + '</span>' +
      '<input type="range" id="in-gross-range" min="0" max="' + state.max + '" step="' + STEP + '" value="' + state.gross + '">' +
      '</label>' +
      '<button type="button" id="panel-toggle" class="chip" aria-controls="panel" aria-expanded="true">' +
      T.t('in.filters') + '</button>' +
      '</div>';

    bind('panel-toggle', 'click', function () {
      state.panelOpen = !panelIsOpen();
      applyPanelState();
    });
    applyPanelState();

    bind('in-gross-range', 'input', function (event) {
      state.gross = Number(event.target.value);
      var box = document.getElementById('in-gross');
      if (box) box.value = String(Math.round(state.gross));
      renderView();
      saveState();
    });
    bind('in-gross', 'change', function (event) {
      state.gross = Math.max(0, Math.min(state.max, Number(event.target.value) || 0));
      render(false);
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
    var slice = global.IrpfAnalysis.nextSlice(engine, input(), state.gross, 1000);
    var marginal = marginalAt(state.gross);
    var tone = marginal >= 0.5 ? 'bad' : marginal >= 0.42 ? 'warn' : '';

    var cards =
      kpi(T.t('kpi.net'), euro(here.net), pct(1 - here.tipoEfectivo, 0) + ' ' + T.t('series.net').toLowerCase()) +
      kpi(T.t('kpi.netMonth'), euro(here.net / 12), T.t('kpi.months', { n: 12 }) + ' · ' +
        euro(here.net / 14) + ' ' + T.t('kpi.months', { n: 14 })) +
      kpi(T.t('kpi.effective'), pct(here.tipoEfectivo), T.t('kpi.effectiveNote')) +
      kpi(T.t('kpi.marginal'), pct(marginal), T.t('kpi.marginalNote'), tone) +
      kpi(T.t('kpi.next', { amount: euro(1000) }), euro(slice.keep), pct(1 - slice.rate, 0) + ' · ' +
        euro(slice.lost) + ' → ' + T.t('kpi.ss') + '/' + T.t('kpi.irpf'), tone) +
      (state.mode === 'autonomo'
        ? kpi(T.t('kpi.reta'), euro(here.ss), T.t('kpi.retaNote', {
          n: here.tramoReta.index + 1, amount: euro(here.tramoReta.tramo.cuotaMes),
        }))
        : kpi(T.t('kpi.employer'), euro(here.costeEmpresa),
          '+' + pct(here.costeEmpresa / here.gross - 1, 1) + ' · ' + T.t('kpi.ss'))) +
      kpi(T.t('kpi.ss'), euro(here.ss), pct(here.gross ? here.ss / here.gross : 0, 1)) +
      kpi(T.t('kpi.irpf'), euro(here.irpf), pct(here.tipoIrpfEfectivo, 1));

    host.innerHTML =
      '<div class="kpis">' + cards + '</div>' +
      card(T.t('chart.netTitle'), T.t('chart.netSub'), '<div class="chart-box" id="chart-net"></div>' + legend([
        { label: T.t('series.net'), color: color('--store-consum') },
        { label: T.t('series.gross'), color: color('--muted'), dashed: true },
      ])) +
      card(T.t('chart.ratesTitle'), T.t('chart.ratesSub'), '<div class="chart-box" id="chart-rates"></div>' + legend([
        { label: T.t('series.marginal'), color: color('--critical') },
        { label: T.t('series.effective'), color: color('--store-mercadona') },
      ]) + bandLegend()) +
      card(T.t('chart.splitTitle'), T.t('chart.splitSub'), '<div class="chart-box" id="chart-split"></div>' + legend([
        { label: T.t('series.net'), color: color('--store-consum') },
        { label: T.t('series.ss'), color: color('--store-aldi') },
        { label: T.t('series.irpfState'), color: color('--store-mercadona') },
        { label: T.t('series.irpfRegion'), color: color('--store-other') },
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
        { id: 'net', label: T.t('series.net'), color: color('--store-consum'),
          points: curve.map(function (p) { return { x: p.gross, y: p.net }; }) },
      ],
      xFormat: euroShort,
      yFormat: euroShort,
      onPick: pick,
      tooltip: function (index) {
        var p = curve[index];
        return '<div class="tt-date">' + euro(p.gross) + '</div>' +
          row(T.t('series.net'), euro(p.net)) +
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
        { id: 'efectivo', label: T.t('series.effective'), color: color('--store-mercadona'),
          points: curve.map(function (p) { return { x: p.gross, y: Math.max(0, p.efectivo) }; }) },
      ],
      xFormat: euroShort,
      yFormat: function (v) { return pct(v, 0); },
      onPick: pick,
      tooltip: function (index) {
        var p = curve[index];
        return '<div class="tt-date">' + euro(p.gross) + '</div>' +
          row(T.t('series.marginal'), pct(p.marginal)) +
          row(T.t('series.effective'), pct(p.efectivo));
      },
    });
  }

  function drawSplit() {
    var host = document.getElementById('chart-split');
    if (!host) return;
    var areas = [
      { id: 'net', color: color('--store-consum'), points: curve.map(function (p) { return { x: p.gross, y: Math.max(0, p.net) }; }) },
      { id: 'ss', color: color('--store-aldi'), points: curve.map(function (p) { return { x: p.gross, y: p.ss }; }) },
      { id: 'estatal', color: color('--store-mercadona'), points: curve.map(function (p) { return { x: p.gross, y: p.irpfEstatal }; }) },
      { id: 'auton', color: color('--store-other'), points: curve.map(function (p) { return { x: p.gross, y: p.irpfAutonomico }; }) },
    ];
    if (state.mode === 'autonomo') {
      areas.push({ id: 'gastos', color: color('--muted'), opacity: 0.5,
        points: curve.map(function (p) { return { x: p.gross, y: p.gastos }; }) });
    }
    global.IrpfCharts.plot(host, {
      height: 260,
      areas: areas,
      cursor: state.gross,
      xFormat: euroShort,
      yFormat: euroShort,
      onPick: pick,
      tooltip: function (index) {
        var p = curve[index];
        return '<div class="tt-date">' + euro(p.gross) + '</div>' +
          row(T.t('series.net'), euro(p.net)) +
          row(T.t('series.ss'), euro(p.ss)) +
          row(T.t('series.irpfState'), euro(p.irpfEstatal)) +
          row(T.t('series.irpfRegion'), euro(p.irpfAutonomico)) +
          (state.mode === 'autonomo' ? row(T.t('series.expenses'), euro(p.gastos)) : '');
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
          from: '<b>' + euro(only.from) + '</b>',
          to: '<b>' + euro(only.to) + '</b>',
          loss: '<b>' + euro(only.loss) + '</b>',
          recovery: only.recovery == null ? '—' : '<b>' + euro(only.recovery) + '</b>',
          dead: only.deadZone == null ? '—' : euro(only.deadZone),
        }) + '</p>' +
        '<p class="why">' + T.t('zones.trapWhy') + '</p>' +
        '<button type="button" class="chip" data-goto="' + only.from + '">' + euro(only.from) + ' →</button>' +
        '</article>');
    } else if (analysis.traps.length > 1) {
      trapTable = card(T.t('zones.trapsHeading'), T.t('zones.trapsIntro', { n: analysis.traps.length }),
        '<div class="table-wrap"><table class="steps"><thead><tr>' +
        '<th>' + T.t('zones.trapFrom') + '</th>' +
        '<th class="num">' + T.t('zones.trapLoss') + '</th>' +
        '<th class="num">' + T.t('zones.trapBack') + '</th>' +
        '<th class="num">' + T.t('zones.trapDead') + '</th><th></th>' +
        '</tr></thead><tbody>' + analysis.traps.map(function (trap) {
          return '<tr><td>' + euro(trap.from) + '</td>' +
            '<td class="num strong">−' + euro(trap.loss) + '</td>' +
            '<td class="num">' + (trap.recovery == null ? '—' : euro(trap.recovery)) + '</td>' +
            '<td class="num">' + (trap.deadZone == null ? '—' : euro(trap.deadZone)) + '</td>' +
            '<td class="num"><button type="button" class="chip small" data-goto="' + trap.from + '">→</button></td>' +
            '</tr>';
        }).join('') + '</tbody></table></div>');
    }

    analysis.spikes.forEach(function (spike) {
      blocks.push(
        '<article class="zone spike"><h3>' + T.t('zones.spike', { peak: pct(spike.peak, 0) }) + '</h3>' +
        '<p>' + T.t('zones.spikeBody', {
          from: '<b>' + euro(spike.from) + '</b>',
          to: '<b>' + euro(spike.to) + '</b>',
          keep: '<b>' + euro(1 - spike.average, 2) + '</b>',
          average: pct(spike.average),
        }) + '</p>' +
        '<p class="why">' + (isArt20(spike) ? T.t('zones.spikeWhy') : T.t('zones.spikeWhyGeneric')) + '</p>' +
        '<p class="why">' + T.t('zones.jump', {
          gross: '<b>' + euro(spike.to) + '</b>',
          rate: pct(marginalAt(spike.to + STEP * 2)),
        }) + '</p>' +
        '<button type="button" class="chip" data-goto="' + spike.from + '">' + euro(spike.from) + ' →</button>' +
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
        gross: '<b>' + euro(edge.gross) + '</b>',
        rate: pct(edge.rate),
      }) + '</li>';
    }).join('');

    host.innerHTML =
      card(T.t('zones.heading'), T.t('chart.ratesSub'),
        '<div class="chart-box" id="chart-rates"></div>' + legend([
          { label: T.t('series.marginal'), color: color('--critical') },
          { label: T.t('series.effective'), color: color('--store-mercadona') },
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
        '<td>' + euro(step.from) + '</td>' +
        '<td>' + euro(step.to) + '</td>' +
        '<td class="num">' + euro(step.to - step.from) + '</td>' +
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

  var COMPARE_COLORS = ['--store-mercadona', '--store-lidl', '--store-consum', '--store-aldi', '--store-other'];

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
        color: color(index ? '--store-lidl' : '--store-mercadona'),
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
      card(T.t('compare.table', { gross: euro(here) }), '',
        '<div class="table-wrap"><table class="steps"><thead><tr>' +
        '<th>' + T.t('in.region') + '</th><th class="num">' + T.t('kpi.net') + '</th>' +
        '<th class="num">' + T.t('kpi.irpf') + '</th><th class="num">' + T.t('kpi.effective') + '</th><th></th>' +
        '</tr></thead><tbody>' + rows.map(function (entry, index) {
          var diff = best - entry.result.net;
          return '<tr><td>' + entry.region.name + (entry.region.verified ? '' : ' <span class="tiny">*</span>') + '</td>' +
            '<td class="num strong">' + euro(entry.result.net) + '</td>' +
            '<td class="num">' + euro(entry.result.irpf) + '</td>' +
            '<td class="num">' + pct(entry.result.tipoEfectivo) + '</td>' +
            '<td class="num tiny">' + (index === 0 ? '<span class="badge good">' + T.t('compare.best') + '</span>'
              : T.t('compare.diff', { amount: euro(diff) })) + '</td></tr>';
        }).join('') + '</tbody></table></div>') +
      card(T.t('chart.modesTitle'), T.t('chart.modesSub'),
        '<div class="chart-box" id="chart-modes"></div>' +
        legend(modeSeries.map(function (s) { return { label: s.label, color: s.color }; })));

    global.IrpfCharts.plot(document.getElementById('chart-regions'), {
      height: 260,
      cursor: state.gross,
      series: regionSeries,
      xFormat: euroShort,
      yFormat: function (v) { return pct(v, 0); },
      onPick: pick,
      tooltip: function (index, x) {
        return '<div class="tt-date">' + euro(x) + '</div>' + regionSeries.map(function (s) {
          return row(s.label, pct(s.points[index].y));
        }).join('');
      },
    });

    global.IrpfCharts.plot(document.getElementById('chart-modes'), {
      height: 260,
      cursor: state.gross,
      series: modeSeries,
      xFormat: euroShort,
      yFormat: euroShort,
      onPick: pick,
      tooltip: function (index, x) {
        return '<div class="tt-date">' + euro(x) + '</div>' + modeSeries.map(function (s) {
          return row(s.label, euro(s.points[index].y));
        }).join('');
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
      '<p class="muted">' + T.t('about.body', { step: euro(STEP) }) + '</p>' +
      '<h3>' + T.t('about.assumptions') + '</h3>' +
      '<p class="muted">' + T.t('about.assumptionsBody') + '</p>' +
      '<h3>' + T.t('about.params') + '</h3>' +
      '<ul class="sources">' + scales +
      '<li><b>Seguridad Social</b> <span class="badge good">' + T.t('about.verified') + '</span>' +
      '<span class="tiny block">' + params.seguridadSocial.source + '</span></li>' +
      '<li><b>RETA</b> <span class="badge warn">' + T.t('about.unverified') + '</span>' +
      '<span class="tiny block">' + params.autonomos.source + '</span></li>' +
      '</ul>' +
      '<p class="tiny">' + T.t('about.year', { year: params.year, date: params.checked }) + ' ' +
      T.t('about.edit', { year: params.year }) + '</p>' +
      '<p class="disclaimer">' + T.t('about.disclaimer') + '</p>');
  }

  // --- shell --------------------------------------------------------------

  function renderView() {
    var host = document.getElementById('view');
    if (state.view === 'zones') renderZones(host);
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
    document.title = T.t('tax.title') + ' · Cesta';
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

  function boot() {
    loadState();
    var stored = null;
    try {
      stored = JSON.parse(global.localStorage.getItem('cesta.settings') || '{}');
    } catch (error) {
      stored = {};
    }
    T.set(T.detect(stored && stored.lang));
    applyTheme((stored && stored.theme) || 'system');
    applyStaticStrings();

    document.getElementById('lang-btn').addEventListener('click', function () {
      T.set(T.next());
      try {
        var settings = JSON.parse(global.localStorage.getItem('cesta.settings') || '{}');
        settings.lang = T.lang();
        global.localStorage.setItem('cesta.settings', JSON.stringify(settings));
      } catch (error) {
        /* ignore */
      }
      applyStaticStrings();
      render(true);
    });

    document.getElementById('theme-btn').addEventListener('click', function () {
      var order = ['system', 'light', 'dark'];
      var settings = {};
      try {
        settings = JSON.parse(global.localStorage.getItem('cesta.settings') || '{}');
      } catch (error) {
        settings = {};
      }
      var next = order[(order.indexOf(settings.theme || 'system') + 1) % order.length];
      settings.theme = next;
      try {
        global.localStorage.setItem('cesta.settings', JSON.stringify(settings));
      } catch (error) {
        /* ignore */
      }
      applyTheme(next);
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
