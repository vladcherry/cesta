// Spanish IRPF, from gross income to what is left in hand.
//
// Everything here is annual. A payslip is monthly and its retención is only a
// prepayment, so the monthly view answers the wrong question: what decides
// whether one more euro of income is worth earning is the annual settlement.
//
// The chain, for an employee (art. 17-20, 56-63 LIRPF):
//
//   bruto
//     - cotizaciones del trabajador        (capped at the maximum base, plus
//                                           the solidarity quota above it)
//     - 2.000 EUR otros gastos             (art. 19.2.f)
//     = rendimiento neto del trabajo
//     - reducción art. 20                  (only below 19.747,50, and it phases
//                                           out steeply - this is where the
//                                           worst marginal rates in the whole
//                                           system live)
//     = base imponible general
//     - aportaciones a planes de pensiones
//     = base liquidable
//   cuota = escala(BL) - escala(mínimo personal y familiar), state and regional
//           scales applied separately over the same base
//
// For a self-employed worker the RETA quota replaces the payroll contribution
// and it is a *step* function of net income: crossing a bracket edge costs a
// fixed amount at once, which is what makes some incomes strictly worse than a
// lower one. That is not a rounding artefact, it is how the table is written.
//
// No rounding to cents anywhere in the middle: the dashboard reads differences
// between two nearby incomes, and cent-rounding would show up as fake steps.

(function (global) {
  'use strict';

  function escala(base, brackets) {
    if (!(base > 0)) return 0;
    var tax = 0;
    var floor = 0;
    for (var i = 0; i < brackets.length; i += 1) {
      var top = brackets[i].upTo === null ? Infinity : brackets[i].upTo;
      var slice = Math.min(base, top) - floor;
      if (slice <= 0) break;
      tax += slice * brackets[i].rate;
      floor = top;
      if (base <= top) break;
    }
    return tax;
  }

  // Marginal rate of a scale at a given base — used for the threshold table.
  function marginalOf(base, brackets) {
    for (var i = 0; i < brackets.length; i += 1) {
      var top = brackets[i].upTo === null ? Infinity : brackets[i].upTo;
      if (base < top) return brackets[i].rate;
    }
    return brackets[brackets.length - 1].rate;
  }

  function create(params) {
    var P = params;

    function region(id) {
      var list = P.regiones;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].id === id) return list[i];
      }
      return list[0];
    }

    // --- Seguridad Social, employee ---------------------------------------

    function cotizacionesTrabajador(gross, contrato) {
      var t = P.seguridadSocial.trabajador;
      var minAnnual = P.seguridadSocial.baseMinMes * 12;
      var maxAnnual = P.seguridadSocial.baseMaxMes * 12;
      var base = Math.min(Math.max(gross, Math.min(gross, minAnnual)), maxAnnual);
      var desempleo = contrato === 'temporal' ? t.desempleoTemporal : t.desempleoIndefinido;
      var rate = t.contingenciasComunes + desempleo + t.formacion + t.mei;
      var cotizacion = base * rate;
      return {
        base: base,
        rate: rate,
        ordinaria: cotizacion,
        solidaridad: solidaridad(gross, maxAnnual),
        get total() {
          return this.ordinaria + this.solidaridad;
        },
      };
    }

    // Above the maximum base the payroll contribution stops, which is why the
    // marginal rate visibly *drops* around 61.000 EUR. The solidarity quota
    // (DA 42 LGSS) claws a little of that back, in three slices of its own.
    function solidaridad(gross, maxAnnual) {
      var s = P.seguridadSocial.solidaridad;
      var exceso = gross - maxAnnual;
      if (exceso <= 0) return 0;
      var paid = 0;
      var floor = 0;
      for (var i = 0; i < s.tramos.length; i += 1) {
        var pct = s.tramos[i].hastaPctSobreMax;
        var top = pct === null ? Infinity : maxAnnual * pct;
        var slice = Math.min(exceso, top) - floor;
        if (slice <= 0) break;
        paid += slice * s.tramos[i].rate;
        floor = top;
        if (exceso <= top) break;
      }
      return paid * s.cuotaTrabajadorPct;
    }

    function costeEmpresa(gross, contrato) {
      var e = P.seguridadSocial.empresa;
      var maxAnnual = P.seguridadSocial.baseMaxMes * 12;
      var base = Math.min(gross, maxAnnual);
      var desempleo = contrato === 'temporal' ? e.desempleoTemporal : e.desempleoIndefinido;
      var rate = e.contingenciasComunes + desempleo + e.fogasa + e.formacion + e.accidentes + e.mei;
      var s = P.seguridadSocial.solidaridad;
      var sol = solidaridad(gross, maxAnnual) / s.cuotaTrabajadorPct * (1 - s.cuotaTrabajadorPct);
      return gross + base * rate + sol;
    }

    // --- reducción por rendimientos del trabajo (art. 20) ------------------

    function reduccionTrabajo(rendimientoNeto, otrasRentas) {
      var r = P.trabajo.reduccionArt20;
      if (rendimientoNeto > r.techo) return 0;
      if ((otrasRentas || 0) > r.otrasRentasMax) return 0;
      if (rendimientoNeto <= r.tramo1Hasta) return r.base;
      if (rendimientoNeto <= r.tramo2Hasta) {
        return Math.max(0, r.base - r.tramo1Pendiente * (rendimientoNeto - r.tramo1Hasta));
      }
      return Math.max(0, r.tramo2Base - r.tramo2Pendiente * (rendimientoNeto - r.tramo2Hasta));
    }

    // --- mínimo personal y familiar ---------------------------------------

    function minimoPersonal(input) {
      var m = P.minimos;
      var total = m.personal;
      if (input.edad75) total += m.mas75;
      else if (input.edad65) total += m.mas65;

      var hijos = Math.max(0, input.hijos || 0);
      var porHijos = 0;
      for (var i = 0; i < hijos; i += 1) {
        porHijos += i < m.descendientes.length ? m.descendientes[i] : m.descendientes[m.descendientes.length - 1];
      }
      porHijos += m.menor3 * Math.min(hijos, Math.max(0, input.hijosMenores3 || 0));
      // Shared custody or two parents both declaring: each takes half.
      if (input.descendientesCompartidos) porHijos /= 2;

      if (input.ascendiente75) total += m.ascendiente75;
      else if (input.ascendiente65) total += m.ascendiente65;

      return total + porHijos;
    }

    // --- RETA ---------------------------------------------------------------

    // The bracket is chosen on net income *before* the quota itself, less the
    // 7 % generic expenses allowance, so there is no circular dependency.
    function tramoReta(rendimientoNetoPrevio) {
      var computable = rendimientoNetoPrevio * (1 - P.autonomos.gastosGenericosPct);
      var mes = computable / 12;
      var tramos = P.autonomos.tramos;
      for (var i = 0; i < tramos.length; i += 1) {
        var top = tramos[i].hastaMes === null ? Infinity : tramos[i].hastaMes;
        if (mes <= top) return { index: i, tramo: tramos[i], rendimientoMes: mes };
      }
      var last = tramos.length - 1;
      return { index: last, tramo: tramos[last], rendimientoMes: mes };
    }

    // --- the whole thing ---------------------------------------------------

    function compute(input) {
      var gross = Math.max(0, input.gross || 0);
      var reg = region(input.region);
      var out = {
        gross: gross,
        mode: input.mode === 'autonomo' ? 'autonomo' : 'empleado',
        region: reg,
      };

      var rendimientoNeto;
      var otrasRentas = input.otrasRentas || 0;

      if (out.mode === 'autonomo') {
        var gastos = Math.max(0, input.gastosActividad || 0);
        var previo = Math.max(0, gross - gastos);
        var t = tramoReta(previo);
        out.tramoReta = t;
        out.ss = t.tramo.cuotaMes * 12;
        out.ssDetail = { ordinaria: out.ss, solidaridad: 0, base: t.tramo.baseMinMes * 12 };
        var netoActividad = Math.max(0, previo - out.ss);
        var dificil = Math.min(netoActividad * P.autonomos.gastosDificilJustificacion.pct,
          P.autonomos.gastosDificilJustificacion.limite);
        out.gastosActividad = gastos;
        out.gastosDificilJustificacion = dificil;
        rendimientoNeto = Math.max(0, netoActividad - dificil);
        out.reduccion = 0; // art. 32.2.1º has its own conditions; not assumed here
      } else {
        var cot = cotizacionesTrabajador(gross, input.contrato);
        out.ss = cot.total;
        out.ssDetail = cot;
        rendimientoNeto = gross - cot.total - P.trabajo.otrosGastos;
        out.reduccion = reduccionTrabajo(rendimientoNeto, otrasRentas);
        rendimientoNeto -= out.reduccion;
        out.costeEmpresa = costeEmpresa(gross, input.contrato);
      }

      out.rendimientoNeto = rendimientoNeto;
      var baseImponible = Math.max(0, rendimientoNeto);

      var aportacion = Math.min(
        Math.max(0, input.planPensiones || 0),
        P.trabajo.planPensiones.limiteIndividual,
        Math.max(0, baseImponible) * P.trabajo.planPensiones.limiteRentaPct,
      );
      out.planPensiones = aportacion;

      var baseLiquidable = Math.max(0, baseImponible - aportacion);
      out.baseImponible = baseImponible;
      out.baseLiquidable = baseLiquidable;

      var minimo = minimoPersonal(input);
      out.minimo = minimo;
      var minimoAplicado = Math.min(minimo, baseLiquidable);

      out.irpfEstatal = Math.max(0,
        escala(baseLiquidable, P.escalaEstatal.brackets) - escala(minimoAplicado, P.escalaEstatal.brackets));
      out.irpfAutonomico = Math.max(0,
        escala(baseLiquidable, reg.brackets) - escala(minimoAplicado, reg.brackets));
      out.irpf = out.irpfEstatal + out.irpfAutonomico;

      out.net = gross - (out.mode === 'autonomo' ? out.gastosActividad : 0) - out.ss - out.irpf;
      out.totalRetenido = out.ss + out.irpf;
      out.tipoEfectivo = gross > 0 ? out.totalRetenido / gross : 0;
      out.tipoIrpfEfectivo = gross > 0 ? out.irpf / gross : 0;
      out.tipoMarginalEscala = marginalOf(baseLiquidable, P.escalaEstatal.brackets) + marginalOf(baseLiquidable, reg.brackets);
      return out;
    }

    // --- the curve the dashboard is really about ---------------------------

    // Net income sampled across a range. Everything downstream (marginal rate,
    // steps, traps) is read off this one array, so what the charts show and
    // what the tables claim can never disagree.
    function curve(input, options) {
      var opts = options || {};
      var from = opts.from || 0;
      var to = opts.to || 150000;
      var step = opts.step || 250;
      var points = [];
      for (var g = from; g <= to + 1e-9; g += step) {
        var base = Object.assign({}, input, { gross: g });
        // For the self-employed the expense assumption follows income, so a
        // fixed euro figure would distort the far end of the curve.
        if (input.mode === 'autonomo' && input.gastosPct != null) {
          base.gastosActividad = g * input.gastosPct;
        }
        var r = compute(base);
        points.push({
          gross: g,
          net: r.net,
          ss: r.ss,
          irpf: r.irpf,
          irpfEstatal: r.irpfEstatal,
          irpfAutonomico: r.irpfAutonomico,
          gastos: r.gastosActividad || 0,
          efectivo: r.tipoEfectivo,
          tramoReta: r.tramoReta ? r.tramoReta.index : null,
        });
      }
      // Marginal rate: the share of the *next* euro that does not reach you.
      for (var i = 0; i < points.length - 1; i += 1) {
        var a = points[i];
        var b = points[i + 1];
        var dg = b.gross - a.gross;
        a.marginal = dg > 0 ? 1 - (b.net - a.net) / dg : 0;
      }
      // The last sample has no next one. Carrying the previous rate forward is
      // the honest reading; a zero there would draw a cliff that is not real.
      if (points.length > 1) points[points.length - 1].marginal = points[points.length - 2].marginal;
      else if (points.length === 1) points[0].marginal = 0;
      return points;
    }

    return {
      params: P,
      compute: compute,
      curve: curve,
      escala: escala,
      region: region,
      tramoReta: tramoReta,
      reduccionTrabajo: reduccionTrabajo,
      minimoPersonal: minimoPersonal,
    };
  }

  var api = { create: create, escala: escala, marginalOf: marginalOf };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.IrpfEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
