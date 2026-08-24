// Charts, drawn as inline SVG. No libraries.
//
// Two forms only, because the data asks two questions:
//   sparkline  — "is this drifting up or down?" inside a table cell
//   lines      — "what happened to this price / this basket over time?"
// Series colours come from the store palette in css/app.css and are read from
// CSS custom properties, so light and dark are one definition each.

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

  function extent(values) {
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    if (min === Infinity) return [0, 1];
    if (min === max) return [min * 0.98, max * 1.02 || 1];
    return [min, max];
  }

  var DAY = 86400000;
  function time(iso) {
    return Date.parse(iso + 'T12:00:00Z');
  }

  // --- sparkline ----------------------------------------------------------

  function sparkline(points, options) {
    var opts = options || {};
    var width = opts.width || 64;
    var height = opts.height || 20;
    var pad = 3;
    if (!points || points.length < 2) return '';

    var xs = points.map(function (p) {
      return time(p.d);
    });
    var ys = points.map(function (p) {
      return p.v;
    });
    var xr = extent(xs);
    var yr = extent(ys);
    var sx = function (v) {
      return pad + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (width - pad * 2);
    };
    var sy = function (v) {
      return height - pad - ((v - yr[0]) / (yr[1] - yr[0] || 1)) * (height - pad * 2);
    };

    var d = '';
    for (var i = 0; i < points.length; i += 1) {
      d += (i ? 'L' : 'M') + sx(xs[i]).toFixed(1) + ' ' + sy(ys[i]).toFixed(1);
    }
    var last = points[points.length - 1];
    return (
      '<svg class="spark" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height +
      '" aria-hidden="true" focusable="false">' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>' +
      '<circle cx="' + sx(time(last.d)).toFixed(1) + '" cy="' + sy(last.v).toFixed(1) +
      '" r="2" fill="currentColor"/>' +
      '</svg>'
    );
  }

  // --- line chart ---------------------------------------------------------

  // config: { series: [{ id, label, color, points:[{d,v}] }], format, height }
  function lines(container, config) {
    var series = (config.series || []).filter(function (s) {
      return s.points && s.points.length;
    });
    container.innerHTML = '';
    if (!series.length) return;

    var format = config.format || function (v) {
      return String(v);
    };
    var width = Math.max(280, container.clientWidth || 320);
    var height = config.height || 240;
    var padL = 52;
    var padR = 64; // room for the direct labels at the line ends
    var padT = 12;
    var padB = 26;

    var allX = [];
    var allY = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) {
        allX.push(time(p.d));
        allY.push(p.v);
      });
    });
    var xr = extent(allX);
    var yr = extent(allY);
    // A little headroom so the top line is not glued to the frame.
    var span = yr[1] - yr[0] || 1;
    yr = [Math.max(0, yr[0] - span * 0.08), yr[1] + span * 0.08];

    var sx = function (v) {
      return padL + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (width - padL - padR);
    };
    var sy = function (v) {
      return height - padB - ((v - yr[0]) / (yr[1] - yr[0] || 1)) * (height - padT - padB);
    };

    var svg = el('svg', {
      class: 'chart',
      width: width,
      height: height,
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': config.label || '',
    });

    // Recessive grid + y ticks.
    var ticks = 4;
    for (var t = 0; t <= ticks; t += 1) {
      var value = yr[0] + ((yr[1] - yr[0]) * t) / ticks;
      var y = sy(value);
      svg.appendChild(
        el('line', { x1: padL, y1: y.toFixed(1), x2: width - padR, y2: y.toFixed(1), class: 'grid' }),
      );
      var label = el('text', { x: padL - 8, y: (y + 4).toFixed(1), class: 'axis', 'text-anchor': 'end' });
      label.textContent = format(value);
      svg.appendChild(label);
    }

    // x ticks: first, last and a couple in between.
    var xTicks = Math.min(4, Math.max(2, Math.round(width / 110)));
    for (var i = 0; i <= xTicks; i += 1) {
      var xv = xr[0] + ((xr[1] - xr[0]) * i) / xTicks;
      var xText = el('text', {
        x: sx(xv).toFixed(1),
        y: height - 8,
        class: 'axis',
        'text-anchor': i === 0 ? 'start' : i === xTicks ? 'end' : 'middle',
      });
      xText.textContent = Fmt.shortDate(new Date(xv).toISOString().slice(0, 10));
      svg.appendChild(xText);
    }
    svg.appendChild(
      el('line', {
        x1: padL, y1: sy(yr[0]).toFixed(1), x2: width - padR, y2: sy(yr[0]).toFixed(1), class: 'baseline',
      }),
    );

    // Series: 2px lines, a 2px surface ring under each so overlaps stay readable.
    var endLabels = [];
    series.forEach(function (s) {
      var d = '';
      s.points.forEach(function (p, index) {
        d += (index ? 'L' : 'M') + sx(time(p.d)).toFixed(1) + ' ' + sy(p.v).toFixed(1);
      });
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: 'var(--surface-1)', 'stroke-width': 4,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.9 }));
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

      // Direct label at the end of the line: coloured dot carries identity,
      // the text itself stays in ink.
      var last = s.points[s.points.length - 1];
      var lx = sx(time(last.d));
      var ly = sy(last.v);
      svg.appendChild(el('circle', { cx: lx.toFixed(1), cy: ly.toFixed(1), r: 3, fill: s.color }));
      endLabels.push({ x: lx + 7, y: ly, text: s.label });
    });

    // Two lines that end close together would print their labels on top of
    // each other, so push them apart before drawing.
    endLabels.sort(function (a, b) {
      return a.y - b.y;
    });
    var minGap = 13;
    for (var li = 1; li < endLabels.length; li += 1) {
      var gap = endLabels[li].y - endLabels[li - 1].y;
      if (gap < minGap) endLabels[li].y = endLabels[li - 1].y + minGap;
    }
    var overflow = endLabels.length ? endLabels[endLabels.length - 1].y - (height - padB) : 0;
    if (overflow > 0) {
      endLabels.forEach(function (label) {
        label.y -= overflow;
      });
    }
    endLabels.forEach(function (label) {
      var tag = el('text', { x: label.x.toFixed(1), y: (label.y + 4).toFixed(1), class: 'series-label' });
      tag.textContent = label.text;
      svg.appendChild(tag);
    });

    // --- hover layer ---
    var crosshair = el('line', { class: 'crosshair', y1: padT, y2: height - padB, x1: -10, x2: -10 });
    crosshair.style.display = 'none';
    svg.appendChild(crosshair);

    var markers = series.map(function (s) {
      var dot = el('circle', { r: 4.5, fill: s.color, stroke: 'var(--surface-1)', 'stroke-width': 2 });
      dot.style.display = 'none';
      svg.appendChild(dot);
      return dot;
    });

    container.appendChild(svg);

    var tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.hidden = true;
    container.appendChild(tooltip);

    // Every distinct date across all series, so the crosshair snaps to data.
    var dates = {};
    series.forEach(function (s) {
      s.points.forEach(function (p) {
        dates[p.d] = true;
      });
    });
    var dateList = Object.keys(dates).sort();

    function nearest(clientX) {
      var box = svg.getBoundingClientRect();
      var xValue = xr[0] + ((clientX - box.left - padL) / (width - padL - padR)) * (xr[1] - xr[0]);
      var best = dateList[0];
      var bestDistance = Infinity;
      for (var i = 0; i < dateList.length; i += 1) {
        var distance = Math.abs(time(dateList[i]) - xValue);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = dateList[i];
        }
      }
      return bestDistance <= 10 * DAY ? best : null;
    }

    function show(event) {
      var date = nearest(event.clientX);
      if (!date) return hide();
      var x = sx(time(date));
      crosshair.setAttribute('x1', x.toFixed(1));
      crosshair.setAttribute('x2', x.toFixed(1));
      crosshair.style.display = '';

      var rows = '';
      series.forEach(function (s, index) {
        var point = null;
        for (var i = 0; i < s.points.length; i += 1) {
          if (s.points[i].d === date) point = s.points[i];
        }
        var dot = markers[index];
        if (point) {
          dot.setAttribute('cx', x.toFixed(1));
          dot.setAttribute('cy', sy(point.v).toFixed(1));
          dot.style.display = '';
          rows +=
            '<div class="tt-row"><span class="dot" style="background:' + s.color + '"></span>' +
            '<span class="tt-name">' + s.label + '</span>' +
            '<span class="tt-value">' + format(point.v) + '</span></div>';
        } else {
          dot.style.display = 'none';
        }
      });

      tooltip.innerHTML = '<div class="tt-date">' + Fmt.date(date) + '</div>' + rows;
      tooltip.hidden = false;
      var offset = x > width / 2 ? -tooltip.offsetWidth - 14 : 14;
      tooltip.style.left = Math.max(4, x + offset) + 'px';
      tooltip.style.top = padT + 'px';
    }

    function hide() {
      crosshair.style.display = 'none';
      markers.forEach(function (dot) {
        dot.style.display = 'none';
      });
      tooltip.hidden = true;
    }

    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }

  global.Charts = { sparkline: sparkline, lines: lines };
})(window);
