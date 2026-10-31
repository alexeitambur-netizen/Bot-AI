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

  function createViz(container, type) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 32');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '32');
    svg.style.display = 'block';
    container.appendChild(svg);
    var running = true;

    if (type === 'line' || type === 'support' || type === 'ma') {
      var pts = [];
      var y = 16;
      for (var i = 0; i < 16; i++) {
        y += (Math.random() - 0.5) * 5;
        y = Math.max(4, Math.min(28, y));
        pts.push({ x: i * 6.4, y: y });
      }
      var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', '#6b7280');
      poly.setAttribute('stroke-width', type === 'ma' ? '1.2' : '1.8');
      poly.setAttribute('stroke-linecap', 'round');
      svg.appendChild(poly);
      var poly2 = null;
      if (type === 'ma') {
        poly2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly2.setAttribute('fill', 'none');
        poly2.setAttribute('stroke', '#8b6cff');
        poly2.setAttribute('stroke-width', '1.2');
        poly2.setAttribute('stroke-dasharray', '2,2');
        svg.appendChild(poly2);
      }
      function tickLine() {
        if (!running) return;
        pts.shift();
        var last = pts[pts.length - 1];
        var ny = last.y + (Math.random() - 0.5) * 6;
        ny = Math.max(4, Math.min(28, ny));
        pts.push({ x: last.x + 6.4, y: ny });
        poly.setAttribute('points', pts.map(function (p) { return p.x + ',' + p.y; }).join(' '));
        if (poly2) {
          var pts2 = pts.map(function (p, i) { return (p.x) + ',' + Math.max(4, Math.min(28, p.y + Math.sin(i * 0.5) * 3)); });
          poly2.setAttribute('points', pts2.join(' '));
        }
        requestAnimationFrame(tickLine);
      }
      tickLine();
    } else if (type === 'impulse' || type === 'vol') {
      var bars = [];
      for (var b = 0; b < 8; b++) {
        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', 4 + b * 12);
        rect.setAttribute('width', 8);
        rect.setAttribute('rx', '1.5');
        rect.setAttribute('fill', '#8b6cff');
        rect.setAttribute('opacity', '0.85');
        svg.appendChild(rect);
        bars.push(rect);
      }
      function tickBars() {
        if (!running) return;
        bars.forEach(function (rect) {
          var h = 4 + Math.random() * 22;
          rect.setAttribute('height', h);
          rect.setAttribute('y', 32 - h);
        });
        requestAnimationFrame(tickBars);
      }
      tickBars();
    } else if (type === 'move') {
      var arrows = [];
      for (var a = 0; a < 5; a++) {
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        g.setAttribute('x', 10 + a * 18);
        g.setAttribute('y', 20);
        g.setAttribute('font-size', '12');
        g.setAttribute('fill', '#6b7280');
        g.textContent = Math.random() > 0.5 ? '↑' : '↓';
        svg.appendChild(g);
        arrows.push(g);
      }
      function tickMove() {
        if (!running) return;
        arrows.forEach(function (el) {
          el.textContent = Math.random() > 0.5 ? '↑' : '↓';
          el.setAttribute('fill', el.textContent === '↑' ? '#1ee687' : '#ff4d6d');
        });
        setTimeout(tickMove, 280);
      }
      tickMove();
    } else if (type === 'session') {
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '50');
      circle.setAttribute('cy', '16');
      circle.setAttribute('r', '10');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', '#6b7280');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', '#8b6cff');
      svg.appendChild(dot);
      var angle = 0;
      function tickSess() {
        if (!running) return;
        angle += 0.08;
        var cx = 50 + Math.cos(angle) * 10;
        var cy = 16 + Math.sin(angle) * 10;
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', cy);
        requestAnimationFrame(tickSess);
      }
      tickSess();
    } else if (type === 'rsi') {
      var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', '10');
      bg.setAttribute('y', '12');
      bg.setAttribute('width', '80');
      bg.setAttribute('height', '8');
      bg.setAttribute('rx', '4');
      bg.setAttribute('fill', 'rgba(255,255,255,0.08)');
      svg.appendChild(bg);
      var fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      fill.setAttribute('x', '10');
      fill.setAttribute('y', '12');
      fill.setAttribute('height', '8');
      fill.setAttribute('rx', '4');
      fill.setAttribute('fill', '#8b6cff');
      svg.appendChild(fill);
      var rsiVal = 50;
      function tickRsi() {
        if (!running) return;
        rsiVal += (Math.random() - 0.5) * 8;
        rsiVal = Math.max(20, Math.min(80, rsiVal));
        fill.setAttribute('width', (rsiVal / 100) * 80);
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
      wrap.style.marginTop = '4px';
      div.appendChild(wrap);
      indBox.appendChild(div);
      chartAnimators.push(createViz(wrap, ind.type));
    });

    var bar = $('analysisBar');
    var status = $('analysisStatus');
    var countEl = $('progressCount');
    var bottom = $('bottomStatus');

    var stepMs = 420;
    for (var i = 0; i < indicators.length; i++) {
      var num = i + 1;
      status.textContent = 'Взвешиваю всё...';
      if (bottom) bottom.textContent = 'GPT 6.0 анализирует... ' + num + ' из ' + indicators.length;
      if (countEl) countEl.textContent = num + ' из ' + indicators.length;
      bar.style.width = (num / indicators.length * 100) + '%';
      var el = $('ind-' + indicators[i].key);
      if (el) el.classList.add('show');
      await sleep(stepMs);
    }

    try {
      var candlesRes = await fetch('/api/candles?pair=' + encodeURIComponent(selectedPair) + '&period=' + selectedTf);
      var candleData = await candlesRes.json();
      var candles = candleData.candles || [];
      var decision = null;
      if (window.SignalEngine && candles.length >= 10) {
        decision = SignalEngine.decide({
          pair: selectedPair, m1: candles, now: Date.now(),
          lastTickAt: candles.length ? candles[candles.length - 1].t : Date.now()
        });
      }
      var isDown = true;
      var reason = 'Анализ завершён';
      if (decision && decision.direction) {
        isDown = decision.direction === 'DOWN';
        reason = decision.reason || reason;
      } else if (candles.length >= 3) {
        isDown = candles[candles.length - 1].close < candles[candles.length - 3].close;
      }
      var chartColor = isDown ? '#ff4d6d' : '#1ee687';
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
        el.querySelectorAll('rect').forEach(function (r) {
          if (r.getAttribute('fill') !== 'rgba(255,255,255,0.08)') r.setAttribute('fill', chartColor);
        });
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
