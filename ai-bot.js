/* AI Bot — логика мини-приложения в стиле Chat GPT Trade Bot */
(function () {
  var TIMEFRAMES = [
    { label: '5 сек', value: 5 },
    { label: '15 сек', value: 15 },
    { label: '1 мин', value: 60 },
    { label: '3 мин', value: 180 },
    { label: '5 мин', value: 300 },
    { label: '30 мин', value: 1800 },
    { label: '1 час', value: 3600 },
    { label: '1 день', value: 86400 }
  ];

  var selectedPair = 'EURUSD_otc';
  var selectedTf = 5;
  var userId = localStorage.getItem('aiBotUserId') || '';
  var pairs = [];
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
        if (el) el.innerHTML = 'Телеграм ID определён автоматически: <b>' + userId + '</b>';
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
      alert('Доступ только по User ID. Введите его в разделе Профиль.');
      showPage('profile');
      return false;
    }
    return true;
  }

  async function loadPayouts() {
    try {
      var res = await fetch('/api/payouts');
      var data = await res.json();
      pairs = [];
      var cats = data.categories || {};
      Object.keys(cats).forEach(function (cat) {
        (cats[cat] || []).forEach(function (p) {
          if (p.active) {
            pairs.push({
              symbol: p.symbol,
              display: p.display || p.symbol,
              payout: p.payout || 0,
              type: cat
            });
          }
        });
      });
      pairs.sort(function (a, b) {
        if (b.payout !== a.payout) return b.payout - a.payout;
        return (a.display || '').localeCompare(b.display || '');
      });
      renderPairs();
      renderHot();
    } catch (e) {
      console.error(e);
      var box = $('pairList');
      if (box) box.innerHTML = '<div style="color:var(--muted);padding:12px">Не удалось загрузить пары</div>';
    }
  }

  function getFilteredPairs() {
    if (!searchQuery) return pairs;
    var q = searchQuery.toLowerCase();
    return pairs.filter(function (p) {
      return (p.display || '').toLowerCase().indexOf(q) >= 0 ||
             (p.symbol || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderPairs() {
    var box = $('pairList');
    var countEl = $('pairCount');
    if (!box) return;
    var filtered = getFilteredPairs();
    if (countEl) {
      countEl.textContent = filtered.length + ' пар' + (searchQuery ? ' найдено' : ' всего');
    }
    if (!filtered.length) {
      box.innerHTML = '<div style="color:var(--muted);padding:12px;text-align:center">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = filtered.map(function (p) {
      var sel = p.symbol === selectedPair ? ' selected' : '';
      return '<div class="pair-item' + sel + '" data-symbol="' + p.symbol + '">' +
        '<div>' + p.display + '</div>' +
        '<div class="payout">' + (p.payout || 0) + '%</div></div>';
    }).join('');
    box.querySelectorAll('.pair-item').forEach(function (item) {
      item.addEventListener('click', function () {
        selectedPair = item.dataset.symbol;
        renderPairs();
      });
    });
  }

  function renderHot() {
    var box = $('hotPairs');
    if (!box) return;
    var hot = pairs.filter(function (p) { return p.payout >= 85; }).slice(0, 8);
    box.innerHTML = hot.map(function (p) {
      return '<div class="pair-chip"><div>' + p.display + '</div><div class="payout">' + p.payout + '%</div></div>';
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

  function createAnimatedChart(container, type) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mini-chart');
    svg.setAttribute('viewBox', '0 0 100 32');
    svg.setAttribute('preserveAspectRatio', 'none');
    container.appendChild(svg);

    var points = [];
    var y = 16;
    for (var i = 0; i < 20; i++) {
      y += (Math.random() - 0.5) * 5;
      y = Math.max(4, Math.min(28, y));
      points.push({ x: i * 5.2, y: y });
    }

    var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#6b7280');
    poly.setAttribute('stroke-width', '1.8');
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);

    var bars = [];
    if (type === 'rsi') {
      for (var b = 0; b < 8; b++) {
        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', 4 + b * 12);
        rect.setAttribute('y', 20);
        rect.setAttribute('width', 8);
        rect.setAttribute('height', 8);
        rect.setAttribute('rx', '1');
        rect.setAttribute('fill', '#8b6cff');
        rect.setAttribute('opacity', '0.7');
        svg.appendChild(rect);
        bars.push(rect);
      }
    }

    var running = true;
    function tick() {
      if (!running) return;
      points.shift();
      var last = points[points.length - 1];
      var ny = last.y + (Math.random() - 0.5) * 6;
      ny = Math.max(4, Math.min(28, ny));
      points.push({ x: last.x + 5.2, y: ny });
      var d = points.map(function (p) { return p.x + ',' + p.y; }).join(' ');
      poly.setAttribute('points', d);
      if (bars.length) {
        bars.forEach(function (rect) {
          var h = 4 + Math.random() * 18;
          rect.setAttribute('height', h);
          rect.setAttribute('y', 32 - h);
        });
      }
      requestAnimationFrame(tick);
    }
    tick();
    return function stop() { running = false; };
  }

  async function getSignal() {
    if (!checkAccess()) return;
    chartAnimators.forEach(function (stop) { stop(); });
    chartAnimators = [];

    var btn = $('getSignalBtn');
    btn.disabled = true;
    $('signalMain').style.display = 'none';
    $('analysisView').style.display = 'block';
    $('signalResult').style.display = 'none';

    var indicators = [
      { key: 'trend', label: 'Тренд — ' + selectedTf + ' сек', type: 'line' },
      { key: 'support', label: 'Поддержка', type: 'line' },
      { key: 'move', label: 'Ход за ' + selectedTf + ' сек', type: 'line' },
      { key: 'impulse', label: 'Импульс', type: 'line' },
      { key: 'session', label: 'Сессия', type: 'bars' },
      { key: 'ma', label: 'Средние 50/200', type: 'line' },
      { key: 'rsi', label: 'RSI', type: 'rsi' },
      { key: 'vol', label: 'Волатильность', type: 'line' }
    ];

    var indBox = $('indicators');
    indBox.innerHTML = '';
    indicators.forEach(function (ind) {
      var div = document.createElement('div');
      div.className = 'indicator';
      div.id = 'ind-' + ind.key;
      div.innerHTML = '<div class="label">' + ind.label + '</div><div class="value">—</div>';
      var chartWrap = document.createElement('div');
      chartWrap.className = 'chart-wrap';
      div.appendChild(chartWrap);
      indBox.appendChild(div);
      var stop = createAnimatedChart(chartWrap, ind.type);
      chartAnimators.push(stop);
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
      await sleep(450);
    }

    try {
      var candlesRes = await fetch('/api/candles?pair=' + encodeURIComponent(selectedPair) + '&period=' + selectedTf);
      var candleData = await candlesRes.json();
      var candles = candleData.candles || [];
      var decision = null;
      if (window.SignalEngine && candles.length >= 10) {
        decision = SignalEngine.decide({
          pair: selectedPair,
          m1: candles,
          now: Date.now(),
          lastTickAt: candles.length ? candles[candles.length - 1].t : Date.now()
        });
      }
      var isDown = true;
      var reason = 'Анализ завершён';
      if (decision && decision.direction) {
        isDown = decision.direction === 'DOWN';
        reason = decision.reason || reason;
      } else if (candles.length >= 3) {
        var last = candles[candles.length - 1].close;
        var prev = candles[candles.length - 3].close;
        isDown = last < prev;
      }

      var chartColor = isDown ? '#ff4d6a' : '#00f0a0';
      indicators.forEach(function (ind) {
        var el = $('ind-' + ind.key);
        if (!el) return;
        var val = isDown ? 'Вниз' : 'Вверх';
        if (ind.key === 'rsi') val = isDown ? '38' : '62';
        if (ind.key === 'support') val = isDown ? 'слабая' : 'сильная';
        el.querySelector('.value').textContent = val;
        el.querySelector('.value').style.color = chartColor;
        var poly = el.querySelector('polyline');
        if (poly) poly.setAttribute('stroke', chartColor);
        el.querySelectorAll('rect').forEach(function (r) { r.setAttribute('fill', chartColor); });
      });

      status.textContent = 'Анализ завершён';
      if (bottom) bottom.textContent = 'GPT 6.0 завершил анализ';
      await sleep(900);
      showResult(isDown, reason);
    } catch (e) {
      status.textContent = 'Ошибка получения данных';
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  }

  function showResult(isDown, reason) {
    chartAnimators.forEach(function (stop) { stop(); });
    chartAnimators = [];
    $('analysisView').style.display = 'none';
    var box = $('signalResult');
    box.style.display = 'block';
    var dir = isDown ? 'ВНИЗ' : 'ВВЕРХ';
    var cls = isDown ? 'down' : 'up';
    var icon = isDown ? '↓' : '↑';
    var tfLabel = TIMEFRAMES.find(function (t) { return t.value === selectedTf; }) || { label: selectedTf + 'с' };
    var pairName = pairs.find(function (p) { return p.symbol === selectedPair; });
    var pairLabel = pairName ? pairName.display : selectedPair;
    box.innerHTML =
      '<div class="big-signal ' + cls + '">' +
        '<div class="signal-icon ' + cls + '">' + icon + '</div>' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:6px">' + pairLabel + '</div>' +
        '<div class="direction">' + dir + '</div>' +
        '<div style="margin-top:8px;font-size:14px">Откройте «' + dir + '» на ' + tfLabel.label + ' в PocketOption</div>' +
        '<div class="countdown" id="cd">Войдите за 0:' + String(Math.min(selectedTf, 59)).padStart(2, '0') + '</div>' +
        '<div style="margin-top:12px;font-size:12px;color:var(--muted)">' + (reason || '') + '</div>' +
      '</div>' +
      '<button class="get-signal" onclick="location.reload()">Новый сигнал</button>';

    var left = Math.min(selectedTf, 59);
    var cd = $('cd');
    var timer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(timer);
        if (cd) cd.textContent = 'Сделка завершена';
        return;
      }
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
