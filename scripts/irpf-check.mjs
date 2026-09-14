// Self-test for the tax engine. No framework: a handful of invariants and a
// few worked figures, run with `node scripts/irpf-check.mjs`.
//
// The point is not to re-derive the law — it is to catch the two failures that
// would make the dashboard lie: a curve that no longer adds up (net + what is
// withheld must equal gross) and the disappearance of the shapes the page is
// built to show (the art. 20 withdrawal, the RETA steps).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const Engine = require(path.join(root, 'js/irpf/engine.js'));
const Analysis = require(path.join(root, 'js/irpf/analysis.js'));
const params = require(path.join(root, 'data/tax/es-2026.json'));

const engine = Engine.create(params);

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log('  ok   ' + name);
  } else {
    failures += 1;
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}
function near(a, b, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance;
}

console.log('scale');
{
  const brackets = params.escalaEstatal.brackets;
  check('empty base pays nothing', Engine.escala(0, brackets) === 0);
  check('first bracket is linear', near(Engine.escala(10000, brackets), 10000 * 0.095));
  check('second bracket stacks on the first',
    near(Engine.escala(20000, brackets), 12450 * 0.095 + 7550 * 0.12));
  let previous = -1;
  for (let base = 0; base <= 400000; base += 1000) {
    const tax = Engine.escala(base, brackets);
    if (tax < previous) { previous = -2; break; }
    previous = tax;
  }
  check('tax never falls as the base rises', previous !== -2);
}

console.log('art. 20 reduction');
{
  const r = params.trabajo.reduccionArt20;
  check('full below the first edge', engine.reduccionTrabajo(14000, 0) === r.base);
  check('nothing above the ceiling', engine.reduccionTrabajo(r.techo + 1, 0) === 0);
  check('continuous at the first edge',
    near(engine.reduccionTrabajo(r.tramo1Hasta, 0), engine.reduccionTrabajo(r.tramo1Hasta + 0.01, 0), 0.05));
  check('continuous at the second edge',
    near(engine.reduccionTrabajo(r.tramo2Hasta, 0), engine.reduccionTrabajo(r.tramo2Hasta + 0.01, 0), 0.05));
  check('reaches zero at the ceiling', near(engine.reduccionTrabajo(r.techo, 0), 0, 1));
  check('other income above the limit blocks it', engine.reduccionTrabajo(14000, 7000) === 0);
}

console.log('employee');
{
  for (const gross of [0, 8000, 16000, 19000, 22000, 35000, 61214.4, 90000, 250000]) {
    const r = engine.compute({ gross, mode: 'empleado', region: 'madrid', contrato: 'indefinido' });
    check('gross ' + gross + ' adds up', near(r.net + r.ss + r.irpf, gross, 0.01),
      `${r.net} + ${r.ss} + ${r.irpf} != ${gross}`);
    check('gross ' + gross + ' pays no negative tax', r.irpf >= 0 && r.ss >= 0);
  }

  const low = engine.compute({ gross: 15000, mode: 'empleado', region: 'madrid' });
  check('a 15.000 salary pays little or no income tax', low.irpf < 200, String(low.irpf));

  const cap = params.seguridadSocial.baseMaxMes * 12;
  const under = engine.compute({ gross: cap - 1000, mode: 'empleado', region: 'madrid' });
  const over = engine.compute({ gross: cap + 20000, mode: 'empleado', region: 'madrid' });
  check('contributions stop growing with the ordinary rate above the cap',
    over.ssDetail.ordinaria - under.ssDetail.ordinaria < 1000);
  check('the solidarity quota takes over above the cap', over.ssDetail.solidaridad > 0);

  const madrid = engine.compute({ gross: 60000, mode: 'empleado', region: 'madrid' });
  const catalonia = engine.compute({ gross: 60000, mode: 'empleado', region: 'cataluna' });
  check('Madrid taxes 60k less than Catalonia', madrid.irpf < catalonia.irpf,
    `${madrid.irpf.toFixed(0)} vs ${catalonia.irpf.toFixed(0)}`);

  const childless = engine.compute({ gross: 40000, mode: 'empleado', region: 'madrid' });
  const withKids = engine.compute({ gross: 40000, mode: 'empleado', region: 'madrid', hijos: 2, hijosMenores3: 1 });
  check('children lower the bill', withKids.irpf < childless.irpf);
}

console.log('self-employed');
{
  for (const gross of [12000, 30000, 45000, 80000]) {
    const r = engine.compute({ gross, mode: 'autonomo', region: 'madrid', gastosActividad: gross * 0.15 });
    check('gross ' + gross + ' adds up',
      near(r.net + r.ss + r.irpf + r.gastosActividad, gross, 0.01));
    check('gross ' + gross + ' sits in a real RETA bracket',
      r.tramoReta.index >= 0 && r.tramoReta.index < params.autonomos.tramos.length);
  }
  const first = engine.compute({ gross: 8000, mode: 'autonomo', region: 'madrid', gastosActividad: 0 });
  const last = engine.compute({ gross: 200000, mode: 'autonomo', region: 'madrid', gastosActividad: 30000 });
  check('the quota rises with income', last.ss > first.ss);
}

console.log('curve and analysis');
{
  const employee = engine.curve({ mode: 'empleado', region: 'madrid', contrato: 'indefinido' },
    { from: 0, to: 120000, step: 100 });
  const a = Analysis.analyse(employee);

  check('the curve covers the range', employee.length === 1201);
  check('an employee never loses money by earning more', a.traps.length === 0,
    JSON.stringify(a.traps.slice(0, 2)));
  check('the art. 20 withdrawal shows up as a spike', a.spikes.length > 0);
  if (a.spikes.length) {
    const spike = a.spikes[0];
    check('the spike sits below the reduction ceiling', spike.from < params.trabajo.reduccionArt20.techo * 1.35,
      String(spike.from));
    check('the spike is worse than the top ordinary rate', spike.peak > 0.5, String(spike.peak));
  }
  check('the steps cover the whole range',
    near(a.steps[0].from, 0) && near(a.steps[a.steps.length - 1].to, 120000, 100));

  const freelancer = engine.curve({ mode: 'autonomo', region: 'madrid', gastosPct: 0.15 },
    { from: 0, to: 100000, step: 100 });
  const b = Analysis.analyse(freelancer);
  check('the RETA brackets do produce traps', b.traps.length > 0);
  check('every trap recovers inside the range', b.traps.every((t) => t.recovery !== null));
  check('every trap loses a real amount', b.traps.every((t) => t.loss > 0));

  const slice = Analysis.nextSlice(engine, { mode: 'empleado', region: 'madrid' }, 21000, 1000);
  check('the next 1.000 EUR is worth less than 1.000 EUR', slice.keep < 1000 && slice.keep > 0);
  check('the worst stretch keeps less than half', slice.keep < 500, String(slice.keep));
}

console.log('mortgage');
{
  const h = params.hipoteca;
  const net = engine.compute({ gross: 45000, mode: 'empleado', region: 'madrid' }).net / 12;

  // With savings out of the way, the income ceiling is the one that binds and
  // the payment should sit exactly on the allowed share of net income.
  const rich = engine.hipoteca(net, { years: 30, ahorro: 1000000 });
  check('the payment uses the whole allowed share', near(rich.ratioCuota, h.ratioCuotaSobreNeto, 0.001));
  check('income is the limit when savings are ample', rich.limitadoPor === 'renta');
  check('the loan respects the LTV', near(rich.prestamo, rich.precio * h.ltvMax, 1));

  // The annuity itself, against the textbook formula.
  const i = h.tipoInteres / 12;
  const expected = rich.prestamo * i / (1 - Math.pow(1 + i, -360));
  check('the payment matches the annuity formula', near(rich.cuota, expected, 0.5));

  // With little saved, the price is what the down payment and the costs allow.
  const poor = engine.hipoteca(net, { years: 30, ahorro: 30000 });
  check('savings are the limit when they are small', poor.limitadoPor === 'ahorro');
  check('own money equals what is saved', near(poor.entrada + poor.gastos, 30000, 1));
  check('a tight buyer pays less than the ceiling', poor.ratioCuota < h.ratioCuotaSobreNeto);
  check('the page can say what would lift the savings limit',
    poor.ahorroNecesario > 30000 && near(poor.precioPorRenta, rich.precio, 1));

  // A longer term buys more house and costs more interest.
  const short = engine.hipoteca(net, { years: 15, ahorro: 1000000 });
  check('a longer term lends more', rich.prestamo > short.prestamo);
  check('a longer term pays more interest', rich.totalIntereses > short.totalIntereses);
  check('no income buys nothing', engine.hipoteca(0, { years: 30, ahorro: 50000 }).precio === 0);

  check('the term is capped by the repayment age',
    engine.plazoMaximo(30) === h.plazoMaxAnios &&
    engine.plazoMaximo(60) === h.edadFinMax - 60 &&
    engine.plazoMaximo(80) === 1);
}

console.log(failures ? `\n${failures} failing check(s)` : '\nall checks pass');
process.exit(failures ? 1 : 0);
