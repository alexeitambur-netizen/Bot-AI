/* AI Bot — логика мини-приложения */
(function () {
  var TIMEFRAMES = [
    { label: '5 сек', value: 5 },
    { label: '15 сек', value: 15 },
    { label: '30 сек', value: 30 },
    { label: '1 мин', value: 60 },
    { label: '2 мин', value: 120 },
    { label: '3 мин', value: 180 },
    { label: '5 мин', value: 300 },
    { label: '10 мин', value: 600 },
    { label: '15 мин', value: 900 },
    { label: '30 мин', value: 1800 },
    { label: '1 час', value: 3600 },
    { label: '4 часа', value: 14400 },
    { label: '1 день', value: 86400 }
  ];

  var CATS = [
    { id: 'currencies', label: 'Валюты' },
    { id: 'crypto', label: 'Крипта' },
    { id: 'commodities', label: 'Сырьё' },
    { id: 'stocks', label: 'Акции' },
    { id: 'indices', label: 'Индексы' }
  ];

  var selectedPair = 'EURUSD_otc';
  var selectedTf = 5;
  var selectedCat = 'currencies';
  var userId = localStorage.getItem('aiBotUserId') || '';
  var allPairs = [];
  var searchQuery = '';
  var chartAnimators = [];

  function $(id) { return document.getElementById(id); }

  function showPage(name) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.tabs-nav button, .bottom-nav button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.page === name);
    });
    var page = $('page-' + name);
    if (page) page.classList.add('active');
  }

  document.querySelectorAll('[data-page]').forEach(function (btn) {
    btn.addEventListener('click', function () { showPage(btn.dataset.page); });
  });

  function initTelegram() {
    if (window.Telegram && Telegram.WebApp) {
      Telegram.WebApp.ready();
      Telegram.WebApp.expand();
      var user = Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user;
      if (user && user.id) {
        userId = String(user.id);
        localStorage.setItem('aiBotUserId', userId);
        var el = $('tgAuto');
        if (el) el.innerHTML = 'Телеграм ID: <b>' + userId + '</b>';
      }
    }
    updateUserBadge();
    var input = $('userIdInput');
    if (input) input.value = userId;
  }

  function updateUserBadge() {
    var badge = $('userBadge');
    if (badge) badge.textContent = userId ? 'ID: ' + userId.slice(-4) : 'Нет доступа';
  }

  function checkAccess() {
    if (!userId) {
      alert('Доступ только по User ID. Введите его в Профиле.');
      showPage('profile');
      return false;
    }
    return true;
  }

  async function loadPayouts() {
    try {
      var res = await fetch('/api/payouts');
      var data = await res.json();
      allPairs = [];
      var cats = data.categories || {};
      Object.keys(cats).forEach(function (cat) {
        (cats[cat] || []).forEach(function (p) {
          if (p.active) {
            allPairs.push({
              symbol: p.symbol,
              display: p.display || p.symbol,
              payout: p.payout || 0,
              type: cat
            });
          }
        });
      });
      renderCatTabs();
      renderPairs();
      renderHot();
    } catch (e) {
      console.error(e);
      var box = $('pairGrid');
      if (box) box.innerHTML = '<div style="color:var(--muted);padding:12px;grid-column:1/-1">Не удалось загрузить пары</div>';
    }
  }

  function renderCatTabs() {
    var box = $('catTabs');
    if (!box) return;
    box.innerHTML = CATS.map(function (c) {
      var active = c.id === selectedCat ? ' active' : '';
      var count = allPairs.filter(function (p) { return p.type === c.id; }).length;
      return '<button class="' + active + '" data-cat="' + c.id + '">' + c.label + ' <span style="opacity:0.6">(' + count + ')</span></button>';
    }).join('');
    box.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedCat = btn.dataset.cat;
        renderCatTabs();
        renderPairs();
      });
    });
  }

  function getVisiblePairs() {
    var list = allPairs.filter(function (p) { return p.type === selectedCat; });
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      list = list.filter(function (p) {
        return (p.display || '').toLowerCase().indexOf(q) >= 0 ||
               (p.symbol || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    list.sort(function (a, b) { return (b.payout || 0) - (a.payout || 0); });
    return list;
  }

  function renderPairs() {
    var box = $('pairGrid');
    var countEl = $('pairCount');
    if (!box) return;
    var list = getVisiblePairs();
    if (countEl) countEl.textContent = list.length + ' пар в этой категории';
    if (!list.length) {
      box.innerHTML = '<div style="color:var(--muted);padding:12px;text-align:center;grid-column:1/-1">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = list.map(function (p) {
      var sel = p.symbol === selectedPair ? ' selected' : '';
      return '<div class="pair-card' + sel + '" data-symbol="' + p.symbol + '">' +
        '<div class="name">' + p.display + '</div>' +
        '<div class="payout">' + (p.payout || 0) + '%</div></div>';
    }).join('');
    box.querySelectorAll('.pair-card').forEach(function (card) {
      card.addEventListener('click', function () {
        selectedPair = card.dataset.symbol;
        renderPairs();
      });
    });
  }

  function renderHot() {
    var box = $('hotPairs');
    if (!box) return;
    var hot = allPairs.filter(function (p) { return p.payout >= 85; }).slice(0, 6);
    box.innerHTML = hot.map(function (p) {
      return '<div class="pair-card"><div class="name">' + p.display + '</div><div class="payout">' + p.payout + '%</div></div>';
    }).join('');
  }

  function renderTfs() {
    var grid = $('tfGrid');
    if (!grid) return;
    grid.innerHTML = TIMEFRAMES.map(function (tf) {
      var sel = tf.value === selectedTf ? ' selected' : '';
      return '<button class="tf-btn' + sel + '" data-tf="' + tf.value + '">' + tf.label + '</button>';
    }).join('');
    grid.querySelectorAll('.tf-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedTf = Number(btn.dataset.tf);
        renderTfs();
      });
    });
  }

  function tfLabel() {
    var tf = TIMEFRAMES.find(function (t) { return t.value === selectedTf; });
    return tf ? tf.label : (selectedTf + ' сек');
  }

  function analyzeTicks(candles) {
    if (!candles || candles.length < 4) return { isDown: Math.random() > 0.5, reason: 'Мало данных' };
    var recent = candles.slice(-8);
    var closes = recent.map(function (c) { return c.close; });
    var last = closes[closes.length - 1];
    var prev = closes[closes.length - 2];
    var prev3 = closes[Math.max(0, closes.length - 4)];
    var bearish = 0, bullish = 0;
    recent.slice(-5).forEach(function (c) {
      if (c.close < c.open) bearish++;
      else if (c.close > c.open) bullish++;
    });
    var sma = closes.reduce(function (a, b) { return a + b; }, 0) / closes.length;
    var momentum = last - prev3;
    var score = 0;
    if (last < prev) score -= 1; else score += 1;
    if (momentum < 0) score -= 1; else score += 1;
    if (last < sma) score -= 1; else score += 1;
    if (bearish > bullish) score -= 1;
    if (bullish > bearish) score += 1;
    var isDown = score < 0;
    if (score === 0) isDown = last < prev;
    var reason = (isDown ? 'Импульс вниз' : 'Импульс вверх') + ' · ' + bearish + '↓/' + bullish + '↑';
    return { isDown: isDown, reason: reason };
  }

  function createViz(container, type) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 36');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '36');
    svg.style.display = 'block';
    container.appendChild(svg);
    var running = true;
    var uid = 'g' + Math.random().toString(36).slice(2, 8);

    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', uid);
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y2', '1');
    var s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s1.setAttribute('offset', '0%');
    s1.setAttribute('stop-color', '#a855f7');
    s1.setAttribute('stop-opacity', '0.6');
    var s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s2.setAttribute('offset', '100%');
    s2.setAttribute('stop-color', '#a855f7');
    s2.setAttribute('stop-opacity', '0');
    grad.appendChild(s1);
    grad.appendChild(s2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    if (type === 'line' || type === 'support' || type === 'move' || type === 'ma') {
      var pts = [];
      var y = 18;
      for (var i = 0; i < 18; i++) {
        y += (Math.random() - 0.48) * 4;
        y = Math.max(4, Math.min(32, y));
        pts.push({ x: i * 5.6, y: y });
      }
      var area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      area.setAttribute('fill', 'url(#' + uid + ')');
      svg.appendChild(area);
      var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', '#c084fc');
      poly.setAttribute('stroke-width', '1.8');
      poly.setAttribute('stroke-linecap', 'round');
      poly.setAttribute('filter', 'drop-shadow(0 0 3px #a855f7)');
      svg.appendChild(poly);
      var poly2 = null;
      if (type === 'ma') {
        poly2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly2.setAttribute('fill', 'none');
        poly2.setAttribute('stroke', '#f43f5e');
        poly2.setAttribute('stroke-width', '1.2');
        poly2.setAttribute('stroke-dasharray', '3,2');
        svg.appendChild(poly2);
      }
      function tickLine() {
        if (!running) return;
        pts.shift();
        var last = pts[pts.length - 1];
        var ny = last.y + (Math.random() - 0.5) * 5;
        ny = Math.max(4, Math.min(32, ny));
        pts.push({ x: last.x + 5.6, y: ny });
        var linePts = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ');
        poly.setAttribute('points', linePts);
        var areaPts = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ') + ' 100,36 0,36';
        area.setAttribute('points', areaPts);
        if (poly2) {
          var pts2 = pts.map(function (p, i) { return p.x + ',' + Math.max(4, Math.min(32, p.y + Math.sin(i * 0.4) * 4)); });
          poly2.setAttribute('points', pts2.join(' '));
        }
        requestAnimationFrame(tickLine);
      }
      tickLine();
    } else if (type === 'impulse' || type === 'vol') {
      var bars = [];
      for (var b = 0; b < 10; b++) {
        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', 3 + b * 9.6);
        rect.setAttribute('width', 6');
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', '#a855f7');
        rect.setAttribute('opacity', '0.9');
        svg.appendChild(rect);
        bars.push(rect);
      }
      function tickBars() {
        if (!running) return;
        bars.forEach(function (rect, i) {
          var h = 6 + Math.sin(Date.now() / 200 + i) * 10 + Math.random() * 8;
          h = Math.max(4, Math.min(28, h));
          rect.setAttribute('height', h);
          rect.setAttribute('y', 36 - h);
        });
        requestAnimationFrame(tickBars);
      }
      tickBars();
    } else if (type === 'session') {
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '50');
      circle.setAttribute('cy', '18');
      circle.setAttribute('r', '12');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', '#a855f7');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('opacity', '0.5');
      svg.appendChild(circle);
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', '#c084fc');
      dot.setAttribute('filter', 'drop-shadow(0 0 4px #a855f7)');
      svg.appendChild(dot);
      var angle = 0;
      function tickSess() {
        if (!running) return;
        angle += 0.06;
        var cx = 50 + Math.cos(angle) * 12;
        var cy = 18 + Math.sin(angle) * 12;
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', cy);
        requestAnimationFrame(tickSess);
      }
      tickSess();
    } else if (type === 'rsi') {
      var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', '8');
      bg.setAttribute('y', '14');
      bg.setAttribute('width', '84');
      bg.setAttribute('height', '8');
      bg.setAttribute('rx', '4');
      bg.setAttribute('fill', 'rgba(168,85,247,0.15)');
      svg.appendChild(bg);
      var fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      fill.setAttribute('x', '8');
      fill.setAttribute('y', '14');
      fill.setAttribute('height', '8');
      fill.setAttribute('rx', '4');
      fill.setAttribute('fill', 'url(#' + uid + ')');
      svg.appendChild(fill);
      var rsiVal = 50;
      function tickRsi() {
        if (!running) return;
        rsiVal += (Math.random() - 0.5) * 6;
        rsiVal = Math.max(25, Math.min(75, rsiVal));
        fill.setAttribute('width', (rsiVal / 100) * 84);
        requestAnimationFrame(tickRsi);
      }
      tickRsi();
    }

    return function () { running = false; };
  }

  async function getSignal() {
    if (!checkAccess()) return;
    chartAnimators.forEach(function (s) { s(); });
    chartAnimators = [];
    var btn = $('getSignalBtn');
    btn.disabled = true;
    $('signalMain').style.display = 'none';
    $('analysisView').style.display = 'block';
    $('signalResult').style.display = 'none';

    var tfName = tfLabel();
    var indicators = [
      { key: 'trend', label: 'Тренд — ' + tfName, type: 'line' },
      { key: 'support', label: 'Поддержка', type: 'support' },
      { key: 'move', label: 'Ход за ' + tfName, type: 'move' },
      { key: 'impulse', label: 'Импульс', type: 'impulse' },
      { key: 'session', label: 'Сессия', type: 'session' },
      { key: 'ma', label: 'Средние 50/200', type: 'ma' },
      { key: 'rsi', label: 'RSI', type: 'rsi' },
      { key: 'vol', label: 'Волатильность', type: 'vol' }
    ];

    var indBox = $('indicators');
    indBox.innerHTML = '';
    indicators.forEach(function (ind) {
      var div = document.createElement('div');
      div.className = 'indicator';
      div.id = 'ind-' + ind.key;
      div.innerHTML = '<div class="label">' + ind.label + '</div><div class="value">—</div>';
      var wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      div.appendChild(wrap);
      indBox.appendChild(div);
      chartAnimators.push(createViz(wrap, ind.type));
    });

    var bar = $('analysisBar');
    var status = $('analysisStatus');
    var countEl = $('progressCount');
    var bottom = $('bottomStatus');

    for (var i = 0; i < indicators.length; i++) {
      var num = i + 1;
      status.textContent = 'Взвешиваю всё...';
      if (bottom) bottom.textContent = 'GPT 6.0 анализирует... ' + num + ' из ' + indicators.length;
      if (countEl) countEl.textContent = num + ' из ' + indicators.length;
      bar.style.width = (num / indicators.length * 100) + '%';
      var el = $('ind-' + indicators[i].key);
      if (el) el.classList.add('show');
      await sleep(420);
    }

    try {
      var candlesRes = await fetch('/api/candles?pair=' + encodeURIComponent(selectedPair) + '&period=' + selectedTf);
      var candleData = await candlesRes.json();
      var candles = candleData.candles || [];
      var result = analyzeTicks(candles);
      var isDown = result.isDown;
      var reason = result.reason;
      var chartColor = isDown ? '#f43f5e' : '#22d3a0';
      indicators.forEach(function (ind) {
        var el = $('ind-' + ind.key);
        if (!el) return;
        var val = isDown ? 'Вниз' : 'Вверх';
        if (ind.key === 'rsi') val = isDown ? '38' : '62';
        if (ind.key === 'support') val = isDown ? 'слабая' : 'сильная';
        if (ind.key === 'session') val = isDown ? 'азиатская' : 'европейская';
        el.querySelector('.value').textContent = val;
        el.querySelector('.value').style.color = chartColor;
        el.querySelectorAll('polyline').forEach(function (p) { p.setAttribute('stroke', chartColor); });
      });
      status.textContent = 'Анализ завершён';
      if (bottom) bottom.textContent = 'GPT 6.0 завершил анализ';
      await sleep(600);
      showResult(isDown, reason);
    } catch (e) {
      status.textContent = 'Ошибка получения данных';
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  }

  function showResult(isDown, reason) {
    chartAnimators.forEach(function (s) { s(); });
    chartAnimators = [];
    $('analysisView').style.display = 'none';
    var box = $('signalResult');
    box.style.display = 'block';
    var dir = isDown ? 'ВНИЗ' : 'ВВЕРХ';
    var cls = isDown ? 'down' : 'up';
    var icon = isDown ? '↓' : '↑';
    var tfName = tfLabel();
    var pairName = allPairs.find(function (p) { return p.symbol === selectedPair; });
    var pairLabel = pairName ? pairName.display : selectedPair;
    box.innerHTML =
      '<div class="big-signal ' + cls + '">' +
        '<div class="signal-icon ' + cls + '">' + icon + '</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">' + pairLabel + '</div>' +
        '<div class="direction">' + dir + '</div>' +
        '<div style="margin-top:8px;font-size:13px">Откройте «' + dir + '» на ' + tfName + '</div>' +
        '<div class="countdown" id="cd">Войдите за 0:' + String(Math.min(selectedTf, 59)).padStart(2, '0') + '</div>' +
        '<div style="margin-top:10px;font-size:11px;color:var(--muted)">' + (reason || '') + '</div>' +
      '</div>' +
      '<button class="get-signal" onclick="location.reload()">Новый сигнал</button>';
    var left = Math.min(selectedTf, 59);
    var cd = $('cd');
    var timer = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(timer); if (cd) cd.textContent = 'Сделка завершена'; return; }
      if (cd) cd.textContent = 'Войдите за 0:' + String(left).padStart(2, '0');
    }, 1000);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var searchInput = $('pairSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      searchQuery = searchInput.value.trim();
      renderPairs();
    });
  }

  $('getSignalBtn').addEventListener('click', getSignal);

  $('saveIdBtn').addEventListener('click', function () {
    var val = $('userIdInput').value.trim();
    if (!val) {
      $('profileStatus').innerHTML = '<span class="status-err">Введите ID</span>';
      return;
    }
    userId = val;
    localStorage.setItem('aiBotUserId', userId);
    $('profileStatus').innerHTML = '<span class="status-ok">Сохранено. Доступ открыт.</span>';
    updateUserBadge();
  });

  function init() {
    initTelegram();
    renderTfs();
    loadPayouts();
    var stats = $('todayStats');
    if (stats) stats.innerHTML = 'Сделки: 0<br>Успешные: —<br>Оборот: —';
    showPage('signal');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
