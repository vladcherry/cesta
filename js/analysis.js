// Reading the shape of the net-income curve.
//
// The question the dashboard exists to answer is not "what do I pay" but
// "where does paying get suddenly worse". Three things can happen as gross
// income rises:
//
//   step   a stretch where the marginal rate is flat — an ordinary bracket
//   spike  a stretch where it jumps well above its neighbours, usually because
//          something is being withdrawn (the art. 20 reduction) rather than
//          because a rate rose
//   trap   net income actually *falls* — crossing a RETA bracket edge costs a
//          fixed quota at once, so a small raise can leave you poorer
//
// All three are read off the sampled curve rather than derived from the law,
// so they stay correct when the parameters file changes.

(function (global) {
  'use strict';

  function round(value, digits) {
    var f = Math.pow(10, digits);
    return Math.round(value * f) / f;
  }

  // Flat-marginal-rate segments. Rates are binned to 0,5 points: the sampling
  // step makes exact equality meaningless, and a table of 200 rows nobody
  // reads is worse than a table of 12 rows that is right to half a point.
  function steps(curve, options) {
    var opts = options || {};
    var bin = opts.bin || 0.005;
    var out = [];
    for (var i = 0; i < curve.length - 1; i += 1) {
      var rate = Math.round(curve[i].marginal / bin) * bin;
      var last = out[out.length - 1];
      if (last && Math.abs(last.rate - rate) < 1e-9) {
        last.to = curve[i + 1].gross;
        last.points += 1;
      } else {
        out.push({ from: curve[i].gross, to: curve[i + 1].gross, rate: rate, points: 1 });
      }
    }
    return out;
  }

  // A trap is a drop in net income. It is measured by how much is lost and,
  // more usefully, by how much extra gross it takes to get back to where you
  // were before the raise.
  function traps(curve, options) {
    var opts = options || {};
    var tolerance = opts.tolerance || 1; // one euro: below that it is sampling noise
    var found = [];
    for (var i = 0; i < curve.length - 1; i += 1) {
      if (curve[i + 1].net >= curve[i].net - tolerance) continue;

      var start = curve[i];
      var bottomIndex = i + 1;
      var j = i + 1;
      while (j < curve.length && curve[j].net < start.net) {
        if (curve[j].net < curve[bottomIndex].net) bottomIndex = j;
        j += 1;
      }
      var recovery = j < curve.length ? curve[j] : null;
      found.push({
        from: start.gross,
        to: curve[bottomIndex].gross,
        recovery: recovery ? recovery.gross : null,
        loss: start.net - curve[bottomIndex].net,
        deadZone: recovery ? recovery.gross - start.gross : null,
        netBefore: start.net,
        netBottom: curve[bottomIndex].net,
        tramoReta: curve[bottomIndex].tramoReta,
      });
      i = Math.max(i, bottomIndex - 1);
    }
    return found;
  }

  // Stretches where the marginal rate sits well above the local norm. The
  // threshold is relative: on a curve whose ordinary marginal rate is 35 % a
  // 48 % stretch is the story, and hard-coding "above 50 %" would hide it.
  function spikes(curve, options) {
    var opts = options || {};
    var rates = curve.slice(0, -1).map(function (p) { return p.marginal; })
      .filter(function (r) { return r > 0 && r < 1; }).sort(function (a, b) { return a - b; });
    if (!rates.length) return [];
    var median = rates[Math.floor(rates.length / 2)];
    var threshold = opts.threshold != null ? opts.threshold : Math.max(median + 0.07, 0.45);

    var out = [];
    var open = null;
    for (var i = 0; i < curve.length - 1; i += 1) {
      var p = curve[i];
      var isSpike = p.marginal >= threshold && p.marginal < 1.5 && curve[i + 1].net >= p.net;
      if (isSpike) {
        if (!open) open = { from: p.gross, to: curve[i + 1].gross, peak: p.marginal, sum: 0, n: 0 };
        open.to = curve[i + 1].gross;
        open.peak = Math.max(open.peak, p.marginal);
        open.sum += p.marginal;
        open.n += 1;
      } else if (open) {
        out.push(close(open));
        open = null;
      }
    }
    if (open) out.push(close(open));

    function close(zone) {
      zone.average = zone.sum / zone.n;
      delete zone.sum;
      delete zone.n;
      return zone;
    }
    return out.filter(function (z) { return z.to > z.from; });
  }

  // The last income before things get worse: the euro amount at which a trap
  // or a spike starts. Earning exactly here is efficient; the stretch above it
  // is the part that is barely worth working for.
  function edges(curve, trapList, spikeList) {
    var marks = [];
    trapList.forEach(function (t) {
      marks.push({ gross: t.from, kind: 'trap', to: t.recovery, detail: t });
    });
    spikeList.forEach(function (s) {
      marks.push({ gross: s.from, kind: 'spike', to: s.to, detail: s });
    });
    marks.sort(function (a, b) { return a.gross - b.gross; });
    return marks.map(function (mark) {
      var point = nearest(curve, mark.gross);
      return {
        gross: mark.gross,
        kind: mark.kind,
        until: mark.to,
        net: point ? point.net : null,
        efficiency: point && point.gross > 0 ? point.net / point.gross : null,
        detail: mark.detail,
      };
    });
  }

  function nearest(curve, gross) {
    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < curve.length; i += 1) {
      var d = Math.abs(curve[i].gross - gross);
      if (d < bestDistance) {
        bestDistance = d;
        best = curve[i];
      }
    }
    return best;
  }

  // What one more slice of gross income is actually worth at a given point.
  function nextSlice(engine, input, gross, slice) {
    var amount = slice || 1000;
    var here = engine.compute(Object.assign({}, input, { gross: gross }));
    var there = engine.compute(Object.assign({}, input, {
      gross: gross + amount,
      gastosActividad: input.gastosPct != null ? (gross + amount) * input.gastosPct : input.gastosActividad,
    }));
    var keep = there.net - here.net;
    return { slice: amount, keep: keep, lost: amount - keep, rate: 1 - keep / amount };
  }

  function analyse(curve) {
    var trapList = traps(curve);
    var spikeList = spikes(curve);
    return {
      steps: steps(curve),
      traps: trapList,
      spikes: spikeList,
      edges: edges(curve, trapList, spikeList),
    };
  }

  var api = {
    steps: steps,
    traps: traps,
    spikes: spikes,
    edges: edges,
    analyse: analyse,
    nextSlice: nextSlice,
    nearest: nearest,
    round: round,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.IrpfAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
