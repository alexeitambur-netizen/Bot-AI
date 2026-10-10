/* Scanner only. Quotes come from the same Pocket Option gateway as SLV VIP Community. */
(function () {
  var PO_API = '';
  var scanCategory = 'forex';
  var scanTf = 1;
  var liveCats = null;
  var liveTotal = 0;
  var scanPriceTimer = null;
  var scanExpiryTimer = null;
  var wired = false;

  function $(id) { return document.getElementById(id); }

  function apiBase() {
    if (location.origin && location.origin.indexOf('http') === 0 && location.hostname !== 'github.com') return location.origin;
    if (window.SERVER_URL) return String(window.SERVER_URL).replace(/\/$/, '');
    return PO_API;
  }

  function norm(name) {
    return String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function digitsFor(price) {
    return price >= 100 ? 2 : (price >= 10 ? 3 : 5);
  }

  function medianOf(arr) {
    if (!arr || !arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function sanitizeCandles(raw) {
    var src = Array.isArray(raw) ? raw : [];
    var rows = [];
    for (var i = 0; i < src.length; i++) {
      var c = src[i] || {};
      var open = Number(c.open), close = Number(c.close);
      if (!isFinite(open) || !isFinite(close) || open <= 0 || close <= 0) continue;
      var high = Number(c.high), low = Number(c.low);
      if (!isFinite(high)) high = Math.max(open, close);
      if (!isFinite(low)) low = Math.min(open, close);
      rows.push({
        t: c.t || 0,
        open: open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close: close
      });
    }
    return rows.map(function (c) {
      return {
        t: c.t,
        open: c.open,
        close: c.close,
        high: Math.max(c.high, c.open, c.close),
        low: Math.min(c.low, c.open, c.close)
      };
    });
  }

  function isPocketHistory(rows, source) {
    var src = String(source || '');
    if (!rows || rows.length < 8) return false;
    if (/pocketoption/i.test(src)) return true;
    if (/fallback|synth|yahoo|market/i.test(src)) return false;
    var ranged = 0;
    rows.forEach(function (c) {
      var scale = Math.abs(c.close) || 1;
      if ((c.high - c.low) > scale * 0.000008) ranged += 1;
    });
    return ranged / rows.length >= 0.25;
  }

  function sma(arr, n) {
    var slice = arr.slice(-Math.min(n, arr.length));
    return slice.reduce(function (a, b) { return a + b; }, 0) / (slice.length || 1);
  }

  function rsi(closes, period) {
    period = period || 14;
    if (!closes || closes.length < period + 1) return 50;
    var gains = 0, losses = 0, start = closes.length - period;
    for (var i = start; i < closes.length; i++) {
      var d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    var ag = gains / period, al = losses / period;
    if (al === 0) return 100;
    if (ag === 0) return 0;
    return 100 - (100 / (1 + ag / al));
  }

  function swingLevels(candles) {
    var slice = (candles || []).slice(-20);
    if (slice.length < 5) return { support: 0, resistance: 0 };
    var lows = slice.map(function (c) { return c.low; }).sort(function (a, b) { return a - b; });
    var highs = slice.map(function (c) { return c.high; }).sort(function (a, b) { return a - b; });
    return {
      support: medianOf(lows.slice(0, Math.max(3, Math.floor(lows.length * 0.25)))),
      resistance: medianOf(highs.slice(Math.floor(highs.length * 0.75)))
    };
  }

  function detectPattern(candles) {
    if (!candles || candles.length < 3) return { name: 'Нет формации', bias: 0 };
    var a = candles[candles.length - 2], b = candles[candles.length - 1];
    var bodyA = Math.abs(a.close - a.open), bodyB = Math.abs(b.close - b.open);
    var rangeB = Math.max(b.high - b.low, 1e-12);
    var upper = b.high - Math.max(b.open, b.close);
    var lower = Math.min(b.open, b.close) - b.low;
    var bullA = a.close >= a.open, bullB = b.close >= b.open;
    if (!bullA && bullB && b.close > a.open && b.open < a.close && bodyB > bodyA * 0.9) return { name: 'Бычье поглощение', bias: 2 };
    if (bullA && !bullB && b.close < a.open && b.open > a.close && bodyB > bodyA * 0.9) return { name: 'Медвежье поглощение', bias: -2 };
    if (lower > bodyB * 2 && upper < bodyB * 0.6 && bullB) return { name: 'Молот у поддержки', bias: 2 };
    if (upper > bodyB * 2 && lower < bodyB * 0.6 && !bullB) return { name: 'Падающая звезда', bias: -2 };
    if (bodyB / rangeB < 0.18) return { name: 'Доджи', bias: 0 };
    if (bullB && b.close > a.high) return { name: 'Импульс вверх', bias: 1 };
    if (!bullB && b.close < a.low) return { name: 'Импульс вниз', bias: -1 };
    return { name: 'Без явного паттерна', bias: 0 };
  }

  function fibRetracement(rows) {
    if (!window.VipMarket) return null;
    return window.VipMarket.fibRetracement(rows);
  }

  function settledBars(rows) {
    if (!rows || rows.length < 3) return rows || [];
    var last = rows[rows.length - 1];
    var start = Number(last.t || last.time || 0);
    if (start > 0 && start < 1000000000000) start *= 1000;
    var minuteStart = Math.floor(Date.now() / 60000) * 60000;
    if (start >= minuteStart) return rows.slice(0, -1);
    return rows;
  }

  function minuteCall(fib, rows, ticks) {
    if (!window.VipMarket || !rows || !rows.length) return null;
    return window.VipMarket.minuteCall(fib, rows, ticks);
  }

  function presentSignal(pair, tf, analysis) {
    var ms = Math.max(1, Number(tf) || 1) * 60000;
    var bucket = Math.floor(Date.now() / ms);
    var key = String(pair || '') + ':' + String(tf || 1) + ':' + bucket;
    if (!presentSignal.hold || presentSignal.hold.key !== key) {
      presentSignal.hold = { key: key, analysis: analysis };
    }
    var fixed = presentSignal.hold.analysis;
    return {
      isUp: fixed.isUp,
      wait: fixed.wait,
      entry: fixed.entry,
      last: analysis.last,
      sma9: fixed.sma9,
      sma20: fixed.sma20,
      rsi: fixed.rsi,
      vol: fixed.vol,
      levels: fixed.levels,
      accuracy: fixed.accuracy,
      score: fixed.score,
      pattern: fixed.pattern,
      fib: fixed.fib,
      zone: fixed.zone || '',
      pointsText: fixed.pointsText,
      reasons: fixed.reasons,
      closes: fixed.closes,
      up: fixed.up,
      down: fixed.down,
      confidence: fixed.confidence,
      indicators: fixed.indicators,
      factors: fixed.factors,
      reclaimSide: fixed.reclaimSide || '',
      lastBar: analysis.lastBar || fixed.lastBar,
      quoteAt: fixed.quoteAt || 0,
      receivedAt: fixed.receivedAt || 0,
      signalAt: fixed.signalAt || 0,
      latencyMs: fixed.latencyMs || 0,
      dataAge: fixed.dataAge,
      marketState: fixed.marketState || '',
      reason: fixed.reason || ''
    };
  }

  function analyzeMarket(candles, ticks, higher, frames, meta) {
    var series = sanitizeCandles(candles).slice(-400);
    if (!series.length) {
      return { wait: true, isUp: false, last: 0, entry: 0, accuracy: 50, rsi: 50, sma9: 0, sma20: 0, vol: 0, reasons: ['Нет котировок'], levels: { support: 0, resistance: 0 }, pattern: { name: '', bias: 0 } };
    }
    var closed = series.slice(0, -1);
    var use = closed.length >= 8 ? closed : series;
    var closes = use.map(function (c) { return c.close; });
    var last = series[series.length - 1].close;
    var lastClosed = use[use.length - 1];
    var sma9 = sma(closes, 9);
    var sma20 = sma(closes, Math.min(20, closes.length));
    var r = rsi(closes, 14);
    var levels = swingLevels(use);
    var pattern = detectPattern(use);
    var range = Math.max((levels.resistance - levels.support) || 0, last * 0.00015);
    var score = 0;
    if (lastClosed.close > sma9) score += 1; else score -= 1;
    if (sma9 > sma20) score += 1; else score -= 1;
    if (r < 30) score += 2; else if (r > 70) score -= 2; else if (r < 42) score += 1; else if (r > 58) score -= 1;
    score += pattern.bias;
    if (lastClosed.close <= levels.support + range * 0.16 && pattern.bias >= 0) score += 2;
    if (lastClosed.close >= levels.resistance - range * 0.16 && pattern.bias <= 0) score -= 2;
    var settled = settledBars(series);
    var fib = fibRetracement(settled.slice(-160));
    var higherRows = higher ? settledBars(sanitizeCandles(higher).slice(-400)) : null;
    var board = null;
    if (window.SignalEngine && window.SignalEngine.decide) {
      var agg = window.SignalEngine.aggregate;
      var tickAt = 0;
      (ticks || []).forEach(function (tick) {
        var stamp = Number(tick && (tick.t || tick[0]) || 0);
        if (stamp > 0 && stamp < 1000000000000) stamp *= 1000;
        if (stamp > tickAt) tickAt = stamp;
      });
      board = window.SignalEngine.decide({
        pair: frames && frames.pair,
        m1: settled,
        m3: agg ? agg(settled, 180000) : [],
        m5: (frames && frames['5м']) || higherRows || [],
        m15: (frames && frames['15м']) || [],
        now: Date.now(),
        lastTickAt: (meta && meta.quoteAt) || tickAt || (settled.length ? settled[settled.length - 1].t : 0)
      });
    }
    var wait = board ? !!board.wait : true;
    var isUp = board ? !!board.isUp : false;
    var accuracy = board ? board.score : 0;
    var reason = board ? board.reason : 'Движок сигнала не загружен.';
    var slice = use.slice(-20);
    var vol = 0;
    slice.forEach(function (c) { vol += (c.high - c.low) / (c.close || 1); });
    vol = slice.length ? (vol / slice.length) * 100 : 0;
    var sideText = wait ? 'NO TRADE' : (isUp ? 'CALL' : 'PUT');
    return {
      isUp: isUp, wait: wait, last: last, entry: last, sma9: sma9, sma20: sma20, rsi: r, vol: vol,
      levels: levels, accuracy: accuracy, score: accuracy, pattern: pattern, fib: fib,
      zone: '',
      pointsText: '',
      up: board ? board.up : null,
      down: board ? board.down : null,
      confidence: accuracy,
      indicators: board ? board.indicators : null,
      factors: board ? board.parts : null,
      reclaimSide: wait ? '' : (isUp ? 'UP' : 'DOWN'),
      reason: reason,
      reasons: board && board.reasons ? board.reasons : [sideText + '. ' + reason, pattern.name ? (pattern.name + ' · RSI ' + r.toFixed(1)) : ('RSI ' + r.toFixed(1))],
      closes: series.slice(-12).map(function (c) { return Number(c.close); }),
      lastBar: settled.length ? settled[settled.length - 1] : (series.length ? series[series.length - 1] : null),
      quoteAt: meta && meta.quoteAt || 0,
      receivedAt: meta && meta.receivedAt || 0,
      signalAt: Date.now(),
      latencyMs: meta && meta.quoteAt ? Math.max(0, Date.now() - meta.quoteAt) : (board && board.dataAge) || 0,
      dataAge: board ? board.dataAge : null,
      marketState: board ? board.marketState : 'НЕТ ДАННЫХ'
    };
  }

  function drawFib(ctx, fib, rows, y, padL, padR, step, w, h) {
    if (!fib) return;
    var xOf = function (index) { return padL + index * step + step / 2; };
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(30,230,135,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(xOf(fib.start.index), y(fib.start.price));
    ctx.lineTo(xOf(fib.end.index), y(fib.end.price));
    ctx.stroke();
    ctx.setLineDash([]);
    fib.levels.forEach(function (lv) {
      var gy = y(lv.price);
      if (gy < 8 || gy > h - 8) return;
      var golden = lv.level === 0.618 || lv.level === 0.5 || lv.level === 0;
      ctx.strokeStyle = golden ? 'rgba(30,230,135,0.85)' : 'rgba(154,168,184,0.55)';
      ctx.lineWidth = lv.level === 0.618 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(padL + 34, gy);
      ctx.lineTo(w - padR, gy);
      ctx.stroke();
      ctx.fillStyle = golden ? '#00ff6a' : '#ff1744';
      ctx.font = (lv.level === 0.618 ? 'bold ' : '') + '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(lv.level), 4, gy + 3);
    });
  }

  function fitCanvas(canvas) {
    if (!canvas) return {};
    var wrap = canvas.parentElement;
    var w = (wrap && wrap.clientWidth) || 340;
    var h = (wrap && wrap.clientHeight) || 240;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function paintChartMessage(title, sub) {
    var box = fitCanvas($('po-candle-canvas'));
    var ctx = box.ctx, w = box.w, h = box.h;
    if (!ctx) return;
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d5deea';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, w / 2, h / 2 - 8);
    ctx.fillStyle = '#8ea0b5';
    ctx.font = '11px sans-serif';
    ctx.fillText(sub, w / 2, h / 2 + 12);
  }

  function drawPocketChart(candles, analysis) {
    var box = fitCanvas($('po-candle-canvas'));
    var ctx = box.ctx, w = box.w, h = box.h;
    if (!ctx) return;
    var rows = sanitizeCandles(candles).slice(-160);
    if (!rows.length) {
      paintChartMessage('Жду свечи Pocket Option', 'История ещё не пришла с терминала');
      return;
    }
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, w, h);
    var padL = 36, padR = 64, padT = 14, padB = 16;
    var max = Math.max.apply(null, rows.map(function (c) { return c.high; }));
    var min = Math.min.apply(null, rows.map(function (c) { return c.low; }));
    var span = (max - min) || Math.abs(rows[rows.length - 1].close) * 0.0008;
    max += span * 0.1;
    min -= span * 0.1;
    function y(v) { return padT + (1 - (v - min) / (max - min)) * (h - padT - padB); }
    var step = (w - padL - padR) / rows.length;
    var cw = Math.max(2, Math.min(9, step * 0.7));
    var last = rows[rows.length - 1];
    var digits = digitsFor(last.close);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.fillStyle = '#6d7d90';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    for (var i = 0; i < 5; i++) {
      var val = max - i * ((max - min) / 4);
      var gy = y(val);
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(w - padR, gy);
      ctx.stroke();
      ctx.fillText(val.toFixed(digits), w - 6, gy + 3);
    }
    var fib = (analysis && analysis.fib) || fibRetracement(rows);
    rows.forEach(function (c, idx) {
      var x = padL + idx * step + (step - cw) / 2;
      var up = c.close >= c.open;
      var color = up ? '#00ff6a' : '#ff1744';
      var top = y(c.high);
      var bot = y(c.low);
      var y1 = y(Math.max(c.open, c.close));
      var y2 = y(Math.min(c.open, c.close));
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x + cw / 2, top);
      ctx.lineTo(x + cw / 2, bot);
      ctx.stroke();
      ctx.fillRect(x, y1, cw, Math.max(2, y2 - y1));
    });
    if (fib) drawFib(ctx, fib, rows, y, padL, padR, step, w, h);
    var quoteColor = last.close >= last.open ? '#00ff6a' : '#ff1744';
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = quoteColor;
    ctx.beginPath();
    ctx.moveTo(padL, y(last.close));
    ctx.lineTo(w - padR, y(last.close));
    ctx.stroke();
    ctx.setLineDash([]);
    var tagY = Math.min(h - 18, Math.max(8, y(last.close) - 8));
    ctx.fillStyle = quoteColor;
    ctx.fillRect(w - padR + 3, tagY, padR - 7, 16);
    ctx.fillStyle = '#061018';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(last.close.toFixed(digits), w - padR / 2 + 1, tagY + 12);
  }

  function categoryOf(type, bucket) {
    var t = String(type || bucket || '').toLowerCase();
    if (t.indexOf('crypto') >= 0) return 'crypto';
    if (t.indexOf('commod') >= 0) return 'commodities';
    if (t.indexOf('stock') >= 0) return 'stocks';
    if (t.indexOf('index') >= 0 || t.indexOf('indice') >= 0) return 'indices';
    if (bucket === 'crypto' || bucket === 'commodities' || bucket === 'stocks' || bucket === 'indices' || bucket === 'forex') return bucket;
    return 'forex';
  }

  function absorbPayouts(data) {
    var cats = { forex: [], crypto: [], commodities: [], stocks: [], indices: [] };
    var map = { currencies: 'forex', forex: 'forex', crypto: 'crypto', commodities: 'commodities', stocks: 'stocks', indices: 'indices' };
    var groups = (data && data.categories) || {};
    Object.keys(groups).forEach(function (key) {
      var target = map[key] || categoryOf('', key);
      (groups[key] || []).forEach(function (row) {
        var display = row.display || row.symbol || row.pair || row.name;
        if (!display) return;
        cats[target].push({
          display: display,
          symbol: row.symbol || display,
          payout: Math.round(Number(row.payout || row.percent || 0)),
          active: row.active !== false
        });
      });
    });
    if (!cats.forex.length && data && data.pairs && typeof data.pairs === 'object') {
      Object.keys(data.pairs).forEach(function (sym) {
        var row = data.pairs[sym] || {};
        var display = row.display || sym;
        var target = categoryOf(row.type, '');
        cats[target].push({
          display: display,
          symbol: row.id || row.symbol || display,
          payout: Math.round(Number(row.payout || 0)),
          active: row.active !== false
        });
      });
    }
    var total = 0;
    Object.keys(cats).forEach(function (k) {
      var seen = {};
      cats[k] = cats[k].filter(function (row) {
        var id = norm(row.display);
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      });
      cats[k].sort(function (a, b) {
        var ao = a.active === false ? 1 : 0;
        var bo = b.active === false ? 1 : 0;
        if (ao !== bo) return ao - bo;
        return (b.payout || 0) - (a.payout || 0);
      });
      total += cats[k].length;
    });
    if (!total) return false;
    liveCats = cats;
    liveTotal = total;
    window.__SLV_LIVE_PAIRS__ = true;
    return true;
  }

  function activeCategory() {
    var ids = ['forex', 'crypto', 'commodities', 'stocks', 'indices'];
    for (var i = 0; i < ids.length; i++) {
      var btn = $('cat-' + ids[i]);
      if (!btn) continue;
      var bg = String(btn.style.background || '');
      if (bg.indexOf('neon-green') !== -1) return ids[i];
    }
    return scanCategory || 'forex';
  }

  function setPoStatus(text) {
    var el = $('slv-po-status');
    if (!el) {
      var count = $('total-assets-count');
      var host = count && count.parentElement;
      if (!host || !host.parentElement) return;
      el = document.createElement('div');
      el.id = 'slv-po-status';
      el.style.cssText = 'text-align:center;font-size:10px;color:#3d8bff;font-weight:800;margin-top:4px;letter-spacing:.4px;';
      host.parentElement.insertBefore(el, host.nextSibling);
    }
    el.textContent = text;
  }

  var pairSignals = {};
  var pinClock = 0;
  var boardRun = { cat: '', minute: 0, gen: 0 };

  function esc(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pairByName(name) {
    var cat = (liveCats && liveCats[activeCategory()]) || [];
    for (var i = 0; i < cat.length; i++) if (cat[i].display === name) return cat[i];
    return null;
  }

  function entryPin(pair) {
    if (!pair || pair.active === false) return 0;
    var hit = pairSignals[norm(pair.display)];
    if (!hit || (hit.signal !== 'UP' && hit.signal !== 'DOWN')) return 0;
    return hit.pin || 0;
  }

  function ensureBoard() {
    if ($('slv-all-board')) return;
    var box = $('analysis-pairs-render-box');
    if (!box || !box.parentElement) return;
    var el = document.createElement('div');
    el.id = 'slv-all-board';
    el.style.cssText = 'margin:0 0 10px;padding:12px 14px;border-radius:18px;background:rgba(0,0,0,.4);border:1px solid rgba(142,162,255,.35);color:#d5deea;font-size:12px;font-weight:700;line-height:1.45;';
    el.textContent = 'Сканирую все пары этой вкладки на следующую минуту…';
    box.parentElement.insertBefore(el, box);
  }

  function paintBoard(text) {
    ensureBoard();
    var el = $('slv-all-board');
    if (el) el.textContent = text;
  }

  function badgeFor(pair) {
    if (pair.active === false) return '<span style="color:#ff4d6d;font-size:11px;font-weight:900;">ЗАКРЫТА</span>';
    var hit = pairSignals[norm(pair.display)];
    if (!hit) return '<span style="color:#8ea2ff;font-size:11px;font-weight:900;">ЖДУ</span>';
    if (hit.signal === 'UP') return '<span style="color:#00ff6a;font-size:12px;font-weight:900;">CALL ' + hit.score + '</span>';
    if (hit.signal === 'DOWN') return '<span style="color:#ff1744;font-size:12px;font-weight:900;">PUT ' + hit.score + '</span>';
    return '<span style="color:#8ea2ff;font-size:11px;font-weight:900;">НЕТ СДЕЛКИ</span>';
  }

  function signalMark(pair) {
    if (!pair || pair.active === false) return '';
    var hit = pairSignals[norm(pair.display)];
    if (!hit || (hit.signal !== 'UP' && hit.signal !== 'DOWN')) return '';
    var color = hit.signal === 'UP' ? '#00ff6a' : '#ff1744';
    return '<span style="color:' + color + ';font-size:13px;font-weight:900;letter-spacing:.8px;">СИГНАЛ</span>';
  }

  function metaChips(pair) {
    var closed = pair.active === false;
    var otc = /OTC/i.test(pair.display || '') || /_otc$/i.test(pair.symbol || '');
    var id = pair.symbol || '';
    var payColor = closed ? '#8d97a6' : (pair.payout >= 92 ? '#1fd47a' : '#3dff8a');
    var html = '';
    if (id) html += '<span style="font-size:10px;font-weight:800;color:#9eb6ff;">ID ' + esc(id) + '</span>';
    if (otc) html += '<span style="font-size:10px;font-weight:900;color:#fff;background:#3d8bff;border-radius:999px;padding:2px 7px;line-height:1.4;">ОТК</span>';
    html += '<span style="color:' + payColor + ';font-weight:900;">' + (pair.payout || 0) + '%</span>';
    return html;
  }

  function renderLivePairs() {
    var renderBox = $('analysis-pairs-render-box');
    if (!renderBox || !liveCats) return false;
    ensureBoard();
    var search = $('analysis-search-input');
    var q = search ? search.value.toUpperCase().trim() : '';
    var base = liveCats[activeCategory()] || [];
    var filtered = q ? base.filter(function (p) { return p.display.toUpperCase().indexOf(q) !== -1; }) : base.slice();
    filtered.sort(function (a, b) { return entryPin(b) - entryPin(a); });
    renderBox.innerHTML = '';
    if (!filtered.length) {
      renderBox.innerHTML = '<div style="color:#9a9484;text-align:center;font-size:13px;padding:30px;font-weight:600;">Тикер не найден в этой категории.</div>';
    } else {
      filtered.forEach(function (pair) {
        var row = document.createElement('div');
        var closed = pair.active === false;
        row.className = 'pair-row';
        row.setAttribute('data-pair', pair.display);
        row.style.setProperty('display', 'grid', 'important');
        row.style.gridTemplateColumns = 'minmax(0,1fr) auto minmax(72px,1fr)';
        row.style.alignItems = 'center';
        row.style.columnGap = '8px';
        if (closed) {
          row.style.opacity = '0.45';
          row.style.cursor = 'default';
        } else {
          row.addEventListener('click', function () { window.launchFullscreenAnalysis(pair.display); });
        }
        var hot = entryPin(pair);
        if (hot) {
          var hit = pairSignals[norm(pair.display)];
          row.style.borderColor = hit && hit.signal === 'DOWN' ? '#ff1744' : '#00ff6a';
        }
        row.innerHTML = '<span style="display:flex;align-items:center;gap:8px;min-width:0;"><canvas class="po-row-spark" width="72" height="28" data-pair="' + esc(pair.display) + '" style="width:72px;height:28px;flex:0 0 auto;background:#0b1118;border-radius:8px;"></canvas><span style="display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;"><span style="font-weight:900;">' + esc(pair.display) + '</span>' + metaChips(pair) + '</span></span><span class="po-row-signal" style="justify-self:center;text-align:center;white-space:nowrap;">' + signalMark(pair) + '</span><span style="display:flex;align-items:center;justify-content:flex-end;"><span class="po-next-badge">' + badgeFor(pair) + '</span></span>';
        renderBox.appendChild(row);
      });
    }
    var countEl = $('total-assets-count');
    if (countEl) countEl.textContent = String(liveTotal);
    scheduleBoard();
    return true;
  }

  function refreshBadges() {
    var box = $('analysis-pairs-render-box');
    if (!box) return;
    var rows = box.querySelectorAll('.pair-row');
    for (var i = 0; i < rows.length; i++) {
      var name = rows[i].getAttribute('data-pair');
      if (!name || !liveCats) continue;
      var pair = pairByName(name);
      if (!pair) continue;
      var badge = rows[i].querySelector('.po-next-badge');
      var mark = rows[i].querySelector('.po-row-signal');
      if (badge) badge.innerHTML = badgeFor(pair);
      if (mark) mark.innerHTML = signalMark(pair);
      var hit = pairSignals[norm(name)];
      var hot = pair.active !== false && hit && (hit.signal === 'UP' || hit.signal === 'DOWN');
      rows[i].style.borderColor = hot ? (hit.signal === 'UP' ? '#00ff6a' : '#ff1744') : '';
    }
  }

  function restorePayoutOrder(cat) {
    var box = $('analysis-pairs-render-box');
    var list = (liveCats && liveCats[cat]) || [];
    if (!box) return;
    var byName = {};
    var rows = box.querySelectorAll('.pair-row');
    for (var i = 0; i < rows.length; i++) byName[rows[i].getAttribute('data-pair')] = rows[i];
    for (var j = 0; j < list.length; j++) {
      var row = byName[list[j].display];
      if (!row) continue;
      row.style.borderColor = '';
      box.appendChild(row);
    }
  }

  function liftSignalRow(name) {
    var box = $('analysis-pairs-render-box');
    if (!box) return;
    var hit = pairSignals[norm(name)];
    if (!hit || (hit.signal !== 'UP' && hit.signal !== 'DOWN')) return;
    var rows = box.querySelectorAll('.pair-row');
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-pair') === name) { row = rows[i]; break; }
    }
    if (!row) return;
    if (box.firstElementChild !== row) box.insertBefore(row, box.firstElementChild);
    box.scrollTop = 0;
  }

  function scheduleBoard() {
    var cat = activeCategory();
    var minute = Math.floor(Date.now() / 60000);
    if (boardRun.cat === cat && boardRun.minute === minute) return;
    boardRun.cat = cat;
    boardRun.minute = minute;
    boardRun.running = true;
    var gen = ++boardRun.gen;
    runBoard(cat, gen);
  }

  async function runBoard(cat, gen) {
    var list = ((liveCats && liveCats[cat]) || []).filter(function (p) { return p.active !== false; });
    var title = cat === 'forex' ? 'Валюты' : 'Пары';
    var stats = { call: 0, put: 0, wait: 0, wins: 0, losses: 0, pushes: 0, skip: 0, done: 0, bars: 0 };
    pinClock = 0;
    for (var resetI = 0; resetI < list.length; resetI++) delete pairSignals[norm(list[resetI].display)];
    restorePayoutOrder(cat);
    refreshBadges();
    paintBoard(title + ': сканирую все ' + list.length + '. Сигнал на следующую минуту считается по закрытым свечам. Найденный вход сразу встаёт наверх.');
    var cursor = 0;
    async function worker() {
      while (cursor < list.length && gen === boardRun.gen) {
        var pair = list[cursor++];
        var name = pair.display;
        try {
          var pack = await fetchPocketCandles(name, 1, 60);
          if (gen !== boardRun.gen) return;
          var rows = settledBars(sanitizeCandles(pack.candles));
          var canvas = document.querySelector('canvas.po-row-spark[data-pair="' + name.replace(/"/g, '') + '"]');
          if (canvas) drawSpark(canvas, rows);
          var lastT = rows.length ? Number(rows[rows.length - 1].t) : 0;
          if (lastT > 0 && lastT < 1000000000000) lastT *= 1000;
          var fromPocket = isPocketHistory(rows, pack.source);
          var board = (!fromPocket || !window.SignalEngine) ? null : window.SignalEngine.decide({
            pair: name,
            m1: rows,
            now: Date.now(),
            lastTickAt: lastT ? lastT + 60000 : 0
          });
          var report = (fromPocket && window.SignalEngine && window.SignalEngine.backtest) ? window.SignalEngine.backtest(rows, name) : null;
          var direction = board ? board.direction : 'NO_TRADE';
          var tradable = direction === 'UP' || direction === 'DOWN';
          pairSignals[norm(name)] = {
            signal: direction,
            score: board ? board.score : 0,
            reason: board ? board.reason : 'Нет свечей терминала.',
            pin: tradable ? ++pinClock : 0
          };
          if (direction === 'UP') stats.call += 1;
          else if (direction === 'DOWN') stats.put += 1;
          else stats.wait += 1;
          if (report) {
            stats.wins += report.all.wins || 0;
            stats.losses += report.all.losses || 0;
            stats.pushes += report.all.pushes || 0;
            stats.skip += report.noTrade || 0;
            stats.bars += report.evaluatedBars || 0;
          }
        } catch (e) {
          pairSignals[norm(name)] = { signal: 'NO_TRADE', score: 0, reason: 'Свечи не пришли.' };
          stats.wait += 1;
        }
        stats.done += 1;
        refreshBadges();
        if (pairSignals[norm(name)] && pairSignals[norm(name)].pin) liftSignalRow(name);
        paintBoard(title + ': ' + stats.done + ' из ' + list.length + '. На эту минуту CALL ' + stats.call + ', PUT ' + stats.put + ', нет сделки ' + stats.wait + '. На этих же закрытых минутах: плюс ' + stats.wins + ', минус ' + stats.losses + ', пропуск ' + stats.skip + '. Плюс и минус — проверка прошлых минут, не обещание следующей.');
      }
    }
    await Promise.all([worker(), worker()]);
    if (gen === boardRun.gen) boardRun.running = false;
  }


  function drawSpark(canvas, candles) {
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, w, h);
    var rows = sanitizeCandles(candles).slice(-28);
    if (rows.length < 2) return;
    var max = Math.max.apply(null, rows.map(function (c) { return c.high; }));
    var min = Math.min.apply(null, rows.map(function (c) { return c.low; }));
    var span = (max - min) || Math.abs(rows[rows.length - 1].close) * 0.0008;
    var step = w / rows.length;
    var cw = Math.max(1, step * 0.62);
    rows.forEach(function (c, idx) {
      var up = c.close >= c.open;
      ctx.strokeStyle = up ? '#00ff6a' : '#ff1744';
      ctx.fillStyle = ctx.strokeStyle;
      var x = idx * step + (step - cw) / 2;
      var y = function (v) { return 2 + (1 - (v - (min - span * 0.08)) / (span * 1.16)) * (h - 4); };
      ctx.beginPath();
      ctx.moveTo(x + cw / 2, y(c.high));
      ctx.lineTo(x + cw / 2, y(c.low));
      ctx.stroke();
      var y1 = y(Math.max(c.open, c.close));
      var y2 = y(Math.min(c.open, c.close));
      ctx.fillRect(x, y1, cw, Math.max(1, y2 - y1));
    });
  }

  var sparkQueue = [];
  var sparkBusy = false;
  function queueRowSparks(root) {
    if (!root) return;
    scheduleBoard();
  }
  function pumpSparks() {
    if (sparkBusy || !sparkQueue.length) return;
    var canvas = sparkQueue.shift();
    if (!canvas || !canvas.isConnected) return pumpSparks();
    sparkBusy = true;
    fetchPocketCandles(canvas.getAttribute('data-pair'), 1, 60).then(function (pack) {
      drawSpark(canvas, pack && pack.candles);
    }).catch(function () {}).then(function () {
      sparkBusy = false;
      setTimeout(pumpSparks, 250);
    });
  }

  async function refreshPocketPairs() {
    setPoStatus('POCKET OPTION • загрузка пар…');
    try {
      var res = await fetch(apiBase() + '/api/payouts', { cache: 'no-store' });
      if (!res.ok) throw new Error('payouts ' + res.status);
      var data = await res.json();
      if (!absorbPayouts(data)) throw new Error('empty payouts');
      var source = (data && data.source) || 'pocketoption';
      setPoStatus(source.indexOf('demo') >= 0 || source.indexOf('pocket') >= 0 ? 'POCKET OPTION • выплаты как в терминале' : 'POCKET OPTION • доска выплат');
      if (typeof window.filterAnalysisPairs === 'function') window.filterAnalysisPairs();
    } catch (e) {
      setPoStatus('POCKET OPTION • нет связи со шлюзом');
    }
  }

  var poLink = null;
  async function pocketConnected() {
    if (poLink && Date.now() - poLink.at < 15000) return poLink.ok;
    try {
      var res = await fetch(apiBase() + '/api/po/health', { cache: 'no-store' });
      var data = await res.json();
      poLink = { at: Date.now(), ok: !!(data && data.connected) };
    } catch (e) {
      poLink = { at: Date.now(), ok: false };
    }
    return poLink.ok;
  }

  async function fetchPocketCandles(pairName, tf, periodSeconds) {
    var period = periodSeconds || Math.max(60, Number(tf || 1) * 60);
    var pocketLive = await pocketConnected();
    var res = await fetch(apiBase() + '/api/candles?pair=' + encodeURIComponent(pairName) + '&period=' + period, { cache: 'no-store' });
    if (!res.ok) throw new Error('candles ' + res.status);
    var data = await res.json();
    var rows = (data && data.candles) || [];
    if (!rows.length) throw new Error('empty');
    return {
      candles: (function () {
        var list = sanitizeCandles(rows.map(function (c) {
          return { t: c.t || (c.time * 1000), open: +c.open, high: +c.high, low: +c.low, close: +c.close };
        }));
        var src = data.source || '';
        if (/pocketoption-demo/i.test(src)) src = 'pocketoption-demo';
        else if (/pocketoption-api/i.test(src)) src = 'pocketoption-api';
        else if (pocketLive) src = 'pocketoption-api';
        else src = src || 'fallback-market';
        list.__source = src;
        return list;
      })(),
      ticks: Array.isArray(data.ticks) ? data.ticks : [],
      quoteAt: Number(data.quoteAt) || 0,
      receivedAt: Number(data.receivedAt) || 0,
      source: /pocketoption-demo/i.test(data.source || '') ? 'pocketoption-demo' : ((data.source && /pocketoption-api/i.test(data.source)) ? data.source : (pocketLive ? 'pocketoption-api' : (data.source || 'fallback-market')))
    };
  }

  async function cachedCandles(pairName, seconds, ttl) {
    if (!cachedCandles.box) cachedCandles.box = {};
    var key = String(pairName || '') + ':' + seconds;
    var hit = cachedCandles.box[key];
    if (hit && Date.now() - hit.at < ttl && hit.candles) return hit.candles;
    try {
      var pack = await fetchPocketCandles(pairName, 1, seconds);
      cachedCandles.box[key] = { at: Date.now(), candles: pack.candles };
      return pack.candles;
    } catch (e) {
      return hit ? hit.candles : null;
    }
  }

  function buildFrames(s5, m1, m15) {
    var agg = window.VipMarket && window.VipMarket.aggregateCandles;
    var frames = {};
    if (!agg) return frames;
    if (s5 && s5.length) {
      frames['5с'] = s5;
      frames['15с'] = agg(s5, 15000);
      frames['30с'] = agg(s5, 30000);
    }
    if (m1 && m1.length) {
      frames['1м'] = m1;
      frames['5м'] = agg(m1, 300000);
      frames['10м'] = agg(m1, 600000);
      if (!m15) frames['15м'] = agg(m1, 900000);
    }
    if (m15 && m15.length) frames['15м'] = m15;
    return frames;
  }

  async function loadScan(pairName, tf) {
    var pack = await fetchPocketCandles(pairName, tf);
    var frames = buildFrames(null, pack.candles, null);
    frames.pair = pairName;
    return { pack: pack, m5: frames['5м'] || null, frames: frames };
  }

  function unlockScanScroll(overlay) {
    if (!overlay) return;
    overlay.style.setProperty('display', 'block', 'important');
    overlay.style.setProperty('overflow-x', 'hidden', 'important');
    overlay.style.setProperty('overflow-y', 'scroll', 'important');
    overlay.style.setProperty('height', '100dvh', 'important');
    overlay.style.setProperty('max-height', '100dvh', 'important');
    overlay.style.setProperty('-webkit-overflow-scrolling', 'touch');
    overlay.style.touchAction = 'pan-y';
    overlay.style.overscrollBehavior = 'contain';
    var desk = overlay.querySelector('.po-desk');
    if (desk) {
      desk.style.minHeight = 'auto';
      desk.style.height = 'auto';
      desk.style.overflow = 'visible';
    }
    var card = $('radar-final-result');
    if (card) {
      card.style.overflow = 'visible';
      card.style.maxHeight = 'none';
      card.style.maxWidth = '100%';
    }
    overlay.scrollTop = 0;
  }

  function ensureScanOverlay() {
    if ($('po-scan-overlay') || !$('po-chart-wrap')) return;
    if (!$('slv-po-scan-style')) {
      var style = document.createElement('style');
      style.id = 'slv-po-scan-style';
      style.textContent = '.po-price.neutral{color:#3d8bff}.po-scan-overlay{position:absolute;inset:0;z-index:6;display:none;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(6,12,18,.55),rgba(5,10,16,.78));overflow:hidden}.po-scan-overlay.active{display:flex}.po-scan-beam{position:absolute;top:0;bottom:0;width:42%;left:-40%;background:linear-gradient(90deg,transparent,rgba(61,139,255,.08),rgba(30,230,135,.22),rgba(61,139,255,.08),transparent);animation:poScanBeam 1.15s ease-in-out infinite}.po-scan-copy{position:relative;z-index:2;text-align:center;padding:0 18px}.po-scan-title{font-size:13px;letter-spacing:2.4px;color:#3d8bff;font-weight:800}.po-scan-sub{margin-top:8px;font-size:12px;font-weight:700;color:#d5deea}.po-scan-bar{width:180px;height:4px;margin:12px auto 0;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden}.po-scan-bar i{display:block;height:100%;width:18%;background:linear-gradient(90deg,#3d8bff,#1ee687);animation:poScanBar 1.3s ease-in-out infinite}@keyframes poScanBeam{to{left:110%}}@keyframes poScanBar{0%{transform:translateX(-120%)}100%{transform:translateX(560%)}}';
      document.head.appendChild(style);
    }
    var ov = document.createElement('div');
    ov.className = 'po-scan-overlay';
    ov.id = 'po-scan-overlay';
    ov.innerHTML = '<div class="po-scan-beam"></div><div class="po-scan-copy"><div class="po-scan-title">СКАНИРОВАНИЕ</div><div class="po-scan-sub" id="po-scan-sub">Считываю график Pocket Option…</div><div class="po-scan-bar"><i></i></div></div>';
    $('po-chart-wrap').appendChild(ov);
  }

  function setScanOverlay(on, text) {
    ensureScanOverlay();
    var ov = $('po-scan-overlay');
    var sub = $('po-scan-sub');
    if (sub && text) sub.textContent = text;
    if (ov) ov.classList.toggle('active', !!on);
  }

  function startNextCandleClock(tf) {
    if (scanExpiryTimer) clearInterval(scanExpiryTimer);
    var tick = function () {
      var el = $('scanning-expiry');
      if (!el) return;
      var msTf = Math.max(1, Number(tf || 1)) * 60000;
      var sec = Math.max(0, Math.ceil((msTf - (Date.now() % msTf)) / 1000));
      var mm = String(Math.floor(sec / 60)).padStart(2, '0');
      var ss = String(sec % 60).padStart(2, '0');
      el.textContent = 'NEXT M' + (tf || 1) + '  ' + mm + ':' + ss;
    };
    tick();
    scanExpiryTimer = setInterval(tick, 250);
  }

  function readJournal() {
    try { return JSON.parse(localStorage.getItem('vip_signal_log') || '[]'); }
    catch (e) { return []; }
  }

  function writeJournal(rows) {
    try { localStorage.setItem('vip_signal_log', JSON.stringify((rows || []).slice(-500))); }
    catch (e) {}
  }

  function postJournal(row) {
    var base = apiBase();
    if (!base || !row) return;
    fetch(base + '/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row)
    }).catch(function () {});
  }

  function minuteWindow(tf, now) {
    var ms = Math.max(1, Number(tf) || 1) * 60000;
    var open = Math.floor((now || Date.now()) / ms) * ms;
    return { open: open, expiry: open + ms };
  }

  function tickStamp(tick) {
    var stamp = Number(tick && (tick.t || tick[0]) || 0);
    if (stamp > 0 && stamp < 1000000000000) stamp *= 1000;
    return stamp;
  }

  function tickPrice(tick) {
    return Number(tick && (tick.price != null ? tick.price : tick[1]));
  }

  function rememberSignal(pair, tf, analysis) {
    if (!analysis) return;
    var windowMs = minuteWindow(tf);
    var id = String(pair || '') + ':' + tf + ':' + windowMs.open;
    var log = readJournal();
    if (log.some(function (row) { return row.id === id; })) return;
    var row = {
      id: id,
      at: Date.now(),
      signalTimestamp: windowMs.open,
      pair: pair,
      tf: Number(tf) || 1,
      entryAt: windowMs.open,
      expiryAt: windowMs.expiry,
      expirationTimestamp: windowMs.expiry,
      receivedAt: analysis.receivedAt || 0,
      signalAt: analysis.signalAt || Date.now(),
      latencyMs: analysis.latencyMs || 0,
      signal: analysis.wait ? 'NO_TRADE' : (analysis.isUp ? 'UP' : 'DOWN'),
      marketState: analysis.marketState || '',
      score: analysis.score,
      dataAge: analysis.dataAge,
      entry: null,
      close: null,
      result: null,
      up: analysis.up,
      down: analysis.down,
      indicators: analysis.indicators || null,
      reason: analysis.reason || ((analysis.reasons && analysis.reasons[0]) || '')
    };
    log.push(row);
    writeJournal(log);
    postJournal(row);
  }

  function gradeJournal(candles, ticks) {
    var log = readJournal();
    var changed = false;
    var now = Date.now();
    log.forEach(function (row) {
      if (!row || row.result || row.signal === 'NO_TRADE' || row.signal === 'WAIT') return;
      var entryAt = Number(row.entryAt || 0);
      var exp = Number(row.expiryAt || row.expirationTimestamp || 0);
      if (!(entryAt > 0) || !(exp > 0) || now < exp) return;
      var path = [];
      (ticks || []).forEach(function (tick) {
        var stamp = tickStamp(tick);
        var price = tickPrice(tick);
        if (price > 0 && stamp >= entryAt && stamp <= exp) path.push({ t: stamp, price: price });
      });
      if (!path.length) {
        (candles || []).forEach(function (candle) {
          var open = tickStamp(candle);
          if (open === entryAt && candle.open > 0 && candle.close > 0) {
            path.push({ t: open, price: Number(candle.open) });
            path.push({ t: open + 60000, price: Number(candle.close) });
          }
        });
      }
      if (!path.length) return;
      path.sort(function (a, b) { return a.t - b.t; });
      var p0 = path[0].price;
      var p1 = path[path.length - 1].price;
      row.entry = p0;
      row.exit = p1;
      row.close = p1;
      row.priceMethod = 'next_minute_open_to_close';
      if (p1 === p0) row.result = 'PUSH';
      else if (row.signal === 'UP' || row.signal === 'CALL') row.result = p1 > p0 ? 'WIN' : 'LOSS';
      else row.result = p1 < p0 ? 'WIN' : 'LOSS';
      changed = true;
      postJournal(row);
    });
    if (changed) writeJournal(log);
  }

  function journalLine() {
    var done = readJournal().filter(function (row) { return row.result === 'WIN' || row.result === 'LOSS'; });
    if (!done.length) return '';
    var wins = done.filter(function (row) { return row.result === 'WIN'; }).length;
    return 'Журнал: ' + done.length + ' закрытых сигналов, ' + wins + ' свеча закрылась в сторону сигнала.';
  }

  function paintVerdict(pair, tfLabel, analysis) {
    var d = digitsFor(analysis.entry || analysis.last || 0);
    var entry = (analysis.entry || analysis.last || 0).toFixed(d);
    var title = $('analyzed-pair-title');
    if (title) title.textContent = pair + '  •  ' + tfLabel;
    var label = $('ta-summary-tf-label');
    if (label) label.textContent = (analysis.marketState || 'РЫНОК') + ' · ' + tfLabel;
    var ind = analysis.indicators || {};
    var rsiEl = $('ta-rsi-val');
    if (rsiEl) rsiEl.textContent = Number(ind.rsi != null ? ind.rsi : analysis.rsi || 0).toFixed(1);
    var s9 = $('ta-sma9-val');
    if (s9) s9.textContent = Number(ind.ema20 != null ? ind.ema20 : analysis.sma9 || 0).toFixed(d);
    var s20 = $('ta-sma20-val');
    if (s20) s20.textContent = Number(ind.ema50 != null ? ind.ema50 : analysis.sma20 || 0).toFixed(d);
    var vol = $('ta-vol-val');
    if (vol) vol.textContent = ind.adx != null ? Number(ind.adx).toFixed(1) : Number(analysis.vol || 0).toFixed(2) + '%';
    var arrow = $('final-direction-arrow');
    var fill = $('final-progress-fill');
    var acc = $('final-accuracy-percent');
    var verdict = $('ta-verdict-box');
    if (acc) acc.textContent = (analysis.score != null ? analysis.score : analysis.accuracy) + '/100';
    if (fill) fill.style.width = Math.max(0, Math.min(100, analysis.score != null ? analysis.score : analysis.accuracy)) + '%';
    if (analysis.wait) {
      if (arrow) { arrow.textContent = 'НЕТ СДЕЛКИ'; arrow.className = 'final-dir'; arrow.style.color = '#8ea2ff'; }
      if (fill) { fill.style.background = '#8ea2ff'; fill.style.boxShadow = '0 0 22px #8ea2ff'; fill.className = 'progress-bar-fill'; }
      if (verdict) { verdict.textContent = 'НЕТ СДЕЛКИ · ' + (analysis.reason || 'закрытые минуты не подтвердили сторону'); verdict.className = 'ta-verdict'; }
    } else if (analysis.isUp) {
      if (arrow) { arrow.textContent = 'CALL ↑ СЛЕДУЮЩАЯ M' + scanTf; arrow.className = 'final-dir up'; arrow.style.color = ''; }
      if (fill) { fill.style.background = '#00ff6a'; fill.style.boxShadow = '0 0 22px #00ff6a'; fill.className = 'progress-bar-fill up'; }
      if (verdict) { verdict.textContent = 'CALL · следующая M' + scanTf + ' · счёт ' + (analysis.score != null ? analysis.score : analysis.accuracy) + '/100 · ориентир ' + entry; verdict.className = 'ta-verdict buy'; }
    } else {
      if (arrow) { arrow.textContent = 'PUT ↓ СЛЕДУЮЩАЯ M' + scanTf; arrow.className = 'final-dir down'; arrow.style.color = ''; }
      if (fill) { fill.style.background = '#ff1744'; fill.style.boxShadow = '0 0 22px #ff1744'; fill.className = 'progress-bar-fill down'; }
      if (verdict) { verdict.textContent = 'PUT · следующая M' + scanTf + ' · счёт ' + (analysis.score != null ? analysis.score : analysis.accuracy) + '/100 · ориентир ' + entry; verdict.className = 'ta-verdict sell'; }
    }
    var banner = $('scan-pattern-banner');
    if (banner) {
      var journal = journalLine();
      var barLine = lastBarLine(analysis.lastBar);
      var lag = analysis.latencyMs != null ? ('SIGNAL LATENCY: ' + analysis.latencyMs + ' ms') : '';
      banner.innerHTML = (barLine ? barLine + '<br>' : '') + (lag ? lag + '<br>' : '') + (analysis.reasons || []).join('<br>') + (journal ? '<br>' + journal : '');
    }
    var call = $('scan-call-side');
    var put = $('scan-put-side');
    if (call && put) {
      call.classList.toggle('active-call', !analysis.wait && analysis.isUp);
      put.classList.toggle('active-put', !analysis.wait && !analysis.isUp);
      call.style.opacity = analysis.wait ? '0.55' : (analysis.isUp ? '1' : '0.45');
      put.style.opacity = analysis.wait ? '0.55' : (!analysis.isUp ? '1' : '0.45');
    }
    var price = $('scanning-live-price');
    if (price && analysis.last) {
      price.textContent = analysis.last.toFixed(digitsFor(analysis.last));
      price.className = 'po-price ' + (analysis.wait ? 'neutral' : (analysis.isUp ? '' : 'down'));
    }
    window.__slvChatContext = {
      pair: pair,
      price: analysis.last,
      reason: (analysis.reasons && analysis.reasons[0]) || '',
      rsi: analysis.rsi,
      closes: analysis.closes || [],
      direction: analysis.wait ? 'WAIT' : (analysis.isUp ? 'CALL' : 'PUT'),
      level: analysis.fib ? analysis.fib.nearest : null,
      points: analysis.pointsText || '',
      up: analysis.up,
      down: analysis.down,
      modelStrength: analysis.confidence
    };
  }

  var forecastToken = 0;
  function lastBarLine(bar) {
    if (!bar || !(bar.close > 0)) return '';
    var stamp = '';
    if (bar.t) {
      try {
        stamp = new Date(bar.t).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
      } catch (e) { stamp = ''; }
    }
    var d = digitsFor(bar.close);
    return 'Свеча M1 ' + (stamp ? stamp + ' МСК' : '') + ' O ' + bar.open.toFixed(d) + ' H ' + bar.high.toFixed(d) + ' L ' + bar.low.toFixed(d) + ' C ' + bar.close.toFixed(d) + '. RSI считается по этим же свечам.';
  }

  function askScannerForecast() {
    window.__slvForecast = null;
  }

  function stopScanTimers() {
    if (scanPriceTimer) { clearInterval(scanPriceTimer); scanPriceTimer = null; }
    if (scanExpiryTimer) { clearInterval(scanExpiryTimer); scanExpiryTimer = null; }
    setScanOverlay(false);
  }

  function wire() {
    if (wired || typeof window.filterAnalysisPairs !== 'function' || typeof window.switchScreen !== 'function') return false;
    wired = true;
    var origFilter = window.filterAnalysisPairs;
    var origSetCat = window.setAssetCategory;
    var origSetTf = window.setScanTimeframe;
    var origClose = window.closeFullscreenAnalysis;
    var origSwitch = window.switchScreen;

    window.setAssetCategory = function (category) {
      scanCategory = category || 'forex';
      if (typeof origSetCat === 'function') return origSetCat.apply(this, arguments);
    };
    window.setScanTimeframe = function (mins) {
      scanTf = Number(mins) || 1;
      if (typeof origSetTf === 'function') return origSetTf.apply(this, arguments);
    };
    window.filterAnalysisPairs = function () {
      if (liveCats) return renderLivePairs();
      return origFilter.apply(this, arguments);
    };
    window.switchScreen = function (id) {
      if (typeof origSwitch === 'function') origSwitch.apply(this, arguments);
      if (id === 'bot-analysis-screen') refreshPocketPairs();
      if (!window.__slvPayoutTimer) {
        window.__slvPayoutTimer = setInterval(function () {
          var screen = document.getElementById('bot-analysis-screen');
          if (screen && screen.classList.contains('active')) refreshPocketPairs();
        }, 20000);
      }
    };
    window.closeFullscreenAnalysis = function () {
      stopScanTimers();
      if (typeof origClose === 'function') return origClose.apply(this, arguments);
    };

    window.launchFullscreenAnalysis = async function (pairName) {
      var tf = scanTf || 1;
      var tfLabel = 'M' + tf;
      stopScanTimers();
      var overlay = $('fullscreen-radar');
      var statusText = $('radar-status-text');
      var finalBlock = $('radar-final-result');
      var radarAnim = $('radar-animation-element');
      var marketView = $('scanning-market-view');
      if (!overlay) return;
      window.__slvForecast = null;
      unlockScanScroll(overlay);
      if (radarAnim) radarAnim.style.display = 'none';
      if (marketView) marketView.style.display = 'block';
      if (finalBlock) finalBlock.style.display = 'none';
      if ($('scanning-pair-name')) $('scanning-pair-name').textContent = pairName;
      if ($('scanning-tf-label')) $('scanning-tf-label').textContent = tfLabel + ' • LIVE';
      var otc = $('scanning-otc-badge');
      if (otc) otc.style.display = /OTC/i.test(pairName) ? 'inline-flex' : 'none';
      var price = $('scanning-live-price');
      if (price) { price.textContent = 'ID'; price.className = 'po-price neutral'; }
      var chg = $('scanning-price-change');
      if (chg) { chg.textContent = 'BID'; chg.style.color = '#3d8bff'; }
      if (statusText) statusText.textContent = 'СКАНИРОВАНИЕ ' + tfLabel + '…';
      setScanOverlay(true, 'Считываю график ' + pairName + ' как на Pocket Option…');
      startNextCandleClock(tf);
      try {
        var loaded = await loadScan(pairName, tf);
        var pack = loaded.pack;
        var fromPocket = isPocketHistory(pack.candles, pack.source);
        var raw = analyzeMarket(pack.candles, pack.ticks, loaded.m5, loaded.frames, { quoteAt: pack.quoteAt, receivedAt: pack.receivedAt });
        var analysis = presentSignal(pairName, tf, raw);
        if (fromPocket) {
          gradeJournal(pack.candles, pack.ticks);
          rememberSignal(pairName, tf, analysis);
        }
        drawPocketChart(pack.candles, analysis);
        setScanOverlay(false);
        if (finalBlock) finalBlock.style.display = 'block';
        paintVerdict(pairName, tfLabel, analysis);
        if (fromPocket) askScannerForecast(pairName, analysis);
        if (statusText) statusText.textContent = fromPocket ? ('POCKET OPTION • ' + tfLabel) : 'СВЕЧИ POCKET OPTION';
        var banner = $('scan-pattern-banner');
        if (banner) {
          banner.textContent = fromPocket
            ? ('Живые свечи ' + pairName + ' · ' + pack.candles.length + ' баров M' + tf)
            : 'Свечи получены, но сессия Pocket Option не подтверждена. График всё равно показан.';
        }
        unlockScanScroll(overlay);
        scanPriceTimer = setInterval(async function () {
          try {
            var freshLoad = await loadScan(pairName, tf);
            var fresh = freshLoad.pack;
            var liveOk = isPocketHistory(fresh.candles, fresh.source);
            var rawLive = analyzeMarket(fresh.candles, fresh.ticks, freshLoad.m5, freshLoad.frames, { quoteAt: fresh.quoteAt, receivedAt: fresh.receivedAt });
            var live = presentSignal(pairName, tf, rawLive);
            if (liveOk) {
              gradeJournal(fresh.candles, fresh.ticks);
              rememberSignal(pairName, tf, live);
            }
            drawPocketChart(fresh.candles, live);
            paintVerdict(pairName, tfLabel, live);
            if (statusText) statusText.textContent = liveOk ? ('POCKET OPTION • ' + tfLabel) : 'НЕТ СЕССИИ POCKET OPTION';
          } catch (err) {}
        }, 2000);
      } catch (e) {
        setScanOverlay(false);
        if (marketView) marketView.style.display = 'block';
        if (finalBlock) finalBlock.style.display = 'block';
        if (statusText) statusText.textContent = 'НЕТ СВЕЧЕЙ POCKET OPTION';
        paintChartMessage('Нет свечей Pocket Option', (e && e.message) ? String(e.message).slice(0, 64) : 'Шлюз не ответил');
      }
    };
    return true;
  }

  function boot() {
    if (wire()) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (wire() || tries > 40) clearInterval(timer);
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
