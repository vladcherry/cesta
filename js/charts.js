// Charts with income on the x axis, drawn as inline SVG. No libraries.
//
// The project's other chart module plots dates; this one plots euros, and it
// needs two things that one does not: shaded bands (the bad stretches) and a
// cursor the rest of the page follows. Colours come from CSS custom
// properties, so light and dark stay one definition each.

(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(name, attributes) {
    var node = document.createElementNS(SVG_NS, name);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, attributes[key]);
    });
    return node;
  }

  function niceStep(span, target) {
    var raw = span / (target || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1;
    return step * mag;
  }

  // config:
  //   series  [{ id, label, color, points:[{x,y}], dashed, fill }]
  //   areas   [{ id, label, color, points:[{x,y}] }]  stacked bottom-up
  //   bands   [{ from, to, kind, label }]
  //   marks   [{ x, label }]
  //   yMax, yFormat, xFormat, height, cursor, onCursor, tooltip(pointIndex)
  function plot(container, config) {
    var series = (config.series || []).filter(function (s) { return s.points && s.points.length > 1; });
    var areas = (config.areas || []).filter(function (s) { return s.points && s.points.length > 1; });
    container.innerHTML = '';
    if (!series.length && !areas.length) return null;

    var reference = (areas[0] || series[0]).points;
    var width = Math.max(300, container.clientWidth || 360);
    var height = config.height || 260;
    var padL = 56;
    var padR = 14;
    var padT = 10;
    var padB = 28;

    var xMin = reference[0].x;
    var xMax = reference[reference.length - 1].x;

    var yMax = config.yMax;
    if (yMax == null) {
      yMax = 0;
      series.forEach(function (s) {
        s.points.forEach(function (p) { if (p.y > yMax) yMax = p.y; });
      });
      if (areas.length) {
        for (var i = 0; i < reference.length; i += 1) {
          var sum = 0;
          areas.forEach(function (a) { sum += (a.points[i] || {}).y || 0; });
          if (sum > yMax) yMax = sum;
        }
      }
      yMax *= 1.05;
    }
    var yMin = config.yMin != null ? config.yMin : 0;

    var sx = function (v) { return padL + ((v - xMin) / (xMax - xMin || 1)) * (width - padL - padR); };
    // Clamped on purpose: a marginal rate of 900 % at a trap edge is real, but
    // drawing it would either flatten every other line or spill outside the
    // frame. The series is cut at the top of the scale instead.
    var sy = function (v) {
      var clamped = Math.max(yMin, Math.min(yMax, v));
      return height - padB - ((clamped - yMin) / (yMax - yMin || 1)) * (height - padT - padB);
    };

    var svg = el('svg', {
      class: 'chart',
      width: width,
      height: height,
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': config.label || '',
    });

    // Bands first: they are background, and anything drawn later must read on
    // top of them.
    (config.bands || []).forEach(function (band) {
      var x1 = sx(Math.max(band.from, xMin));
      var x2 = sx(Math.min(band.to == null ? xMax : band.to, xMax));
      if (x2 - x1 < 1.2) x2 = x1 + 1.2; // a one-step trap must still be visible
      svg.appendChild(el('rect', {
        x: x1.toFixed(1), y: padT, width: (x2 - x1).toFixed(1), height: height - padT - padB,
        class: 'band band-' + (band.kind || 'spike'),
      }));
    });

    var yStep = niceStep(yMax - yMin, 5);
    for (var v = yMin; v <= yMax + 1e-9; v += yStep) {
      var y = sy(v);
      svg.appendChild(el('line', { x1: padL, y1: y.toFixed(1), x2: width - padR, y2: y.toFixed(1), class: 'grid' }));
      var label = el('text', { x: padL - 8, y: (y + 4).toFixed(1), class: 'axis', 'text-anchor': 'end' });
      label.textContent = (config.yFormat || String)(v);
      svg.appendChild(label);
    }

    var xStep = niceStep(xMax - xMin, Math.max(2, Math.round(width / 120)));
    for (var xv = xMin; xv <= xMax + 1e-9; xv += xStep) {
      var tx = sx(xv);
      svg.appendChild(el('line', { x1: tx.toFixed(1), y1: padT, x2: tx.toFixed(1), y2: height - padB, class: 'grid faint' }));
      var xLabel = el('text', {
        x: tx.toFixed(1), y: height - 8, class: 'axis',
        'text-anchor': xv === xMin ? 'start' : xv + xStep > xMax ? 'end' : 'middle',
      });
      xLabel.textContent = (config.xFormat || String)(xv);
      svg.appendChild(xLabel);
    }

    // Stacked areas, bottom-up.
    if (areas.length) {
      var running = reference.map(function () { return 0; });
      areas.forEach(function (area) {
        var top = [];
        var bottom = [];
        for (var i = 0; i < reference.length; i += 1) {
          bottom.push(running[i]);
          running[i] += (area.points[i] || {}).y || 0;
          top.push(running[i]);
        }
        var d = '';
        for (var j = 0; j < reference.length; j += 1) {
          d += (j ? 'L' : 'M') + sx(reference[j].x).toFixed(1) + ' ' + sy(top[j]).toFixed(1);
        }
        for (var k = reference.length - 1; k >= 0; k -= 1) {
          d += 'L' + sx(reference[k].x).toFixed(1) + ' ' + sy(bottom[k]).toFixed(1);
        }
        d += 'Z';
        svg.appendChild(el('path', { d: d, fill: area.color, opacity: area.opacity || 0.85, class: 'area' }));
      });
    }

    svg.appendChild(el('line', {
      x1: padL, y1: sy(yMin).toFixed(1), x2: width - padR, y2: sy(yMin).toFixed(1), class: 'baseline',
    }));

    series.forEach(function (s) {
      var d = '';
      s.points.forEach(function (p, index) {
        d += (index ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1);
      });
      if (!s.dashed) {
        svg.appendChild(el('path', {
          d: d, fill: 'none', stroke: 'var(--surface-1)', 'stroke-width': 4,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.85,
        }));
      }
      var line = el('path', {
        d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      });
      if (s.dashed) line.setAttribute('stroke-dasharray', '4 4');
      svg.appendChild(line);
    });

    // Threshold marks: thin verticals with a tick label at the top.
    (config.marks || []).forEach(function (mark) {
      if (mark.x < xMin || mark.x > xMax) return;
      var mx = sx(mark.x);
      svg.appendChild(el('line', {
        x1: mx.toFixed(1), y1: padT, x2: mx.toFixed(1), y2: height - padB, class: 'mark-line',
      }));
      if (mark.label) {
        var tag = el('text', { x: (mx + 3).toFixed(1), y: padT + 10, class: 'mark-label' });
        tag.textContent = mark.label;
        svg.appendChild(tag);
      }
    });

    var cursor = el('line', { class: 'crosshair', y1: padT, y2: height - padB, x1: -10, x2: -10 });
    cursor.style.display = 'none';
    svg.appendChild(cursor);
    var dots = (series.length ? series : areas).map(function (s) {
      var dot = el('circle', { r: 4, fill: s.color, stroke: 'var(--surface-1)', 'stroke-width': 2 });
      dot.style.display = 'none';
      svg.appendChild(dot);
      return dot;
    });

    container.appendChild(svg);

    var tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.hidden = true;
    container.appendChild(tooltip);

    function indexFor(x) {
      var ratio = (x - xMin) / (xMax - xMin || 1);
      return Math.max(0, Math.min(reference.length - 1, Math.round(ratio * (reference.length - 1))));
    }

    function draw(x) {
      var index = indexFor(x);
      var px = sx(reference[index].x);
      cursor.setAttribute('x1', px.toFixed(1));
      cursor.setAttribute('x2', px.toFixed(1));
      cursor.style.display = '';
      (series.length ? series : []).forEach(function (s, i) {
        var point = s.points[index];
        if (!point) { dots[i].style.display = 'none'; return; }
        dots[i].setAttribute('cx', px.toFixed(1));
        dots[i].setAttribute('cy', sy(point.y).toFixed(1));
        dots[i].style.display = '';
      });
      if (config.tooltip) {
        tooltip.innerHTML = config.tooltip(index, reference[index].x);
        tooltip.hidden = false;
        var offset = px > width / 2 ? -tooltip.offsetWidth - 14 : 14;
        tooltip.style.left = Math.max(4, Math.min(width - 8, px + offset)) + 'px';
        tooltip.style.top = padT + 'px';
      }
      return reference[index].x;
    }

    function fromEvent(event) {
      var box = svg.getBoundingClientRect();
      var scale = (xMax - xMin) / (width - padL - padR);
      return xMin + (event.clientX - box.left - padL) * scale;
    }

    svg.addEventListener('pointermove', function (event) {
      var x = draw(fromEvent(event));
      if (config.onHover) config.onHover(x);
    });
    svg.addEventListener('pointerleave', function () {
      if (config.cursor != null) draw(config.cursor);
      else {
        cursor.style.display = 'none';
        dots.forEach(function (d) { d.style.display = 'none'; });
        tooltip.hidden = true;
      }
    });
    svg.addEventListener('pointerdown', function (event) {
      var x = draw(fromEvent(event));
      if (config.onPick) config.onPick(x);
    });

    if (config.cursor != null) draw(config.cursor);
    return { draw: draw };
  }

  global.IrpfCharts = { plot: plot };
})(window);
