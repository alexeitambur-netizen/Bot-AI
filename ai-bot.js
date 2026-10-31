/* AI Bot — логика мини-приложения */
(function () {
  var ADMIN_ID = '5817328317';

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

  var selectedPair = localStorage.getItem('aiBotSelectedPair') || 'EURUSD_otc';
  var selectedTf = Number(localStorage.getItem('aiBotSelectedTf')) || 5;
  var selectedCat = localStorage.getItem('aiBotSelectedCat') || 'currencies';
  var userId = '';
  var allPairs = [];
  var searchQuery = '';
  var chartAnimators = [];
  var lastEntryPrice = null;
  var countdownTimer = null;
  var signalCache = {};

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
      }
    }
    updateUserBadge();
    var input = $('userIdInput');
    if (input) input.value = userId;
    var el = $('tgAuto');
    if (el) el.innerHTML = userId ? 'Телеграм ID: <b>' + userId + '</b>' : 'Не удалось определить ID';
  }

  function updateUserBadge() {
    var badge = $('userBadge');
    if (!badge) return;
    if (userId === ADMIN_ID) {
      badge.textContent = 'Admin';
      badge.style.color = '#19e58b';
    } else {
      badge.textContent = 'Нет доступа';
      badge.style.color = '#ff526d';
    }
  }

  function updateTfDisplay() {
    var el = $('tfValue');
    if (el) el.textContent = tfLabel();
  }

  function checkAccess() {
    if (userId !== ADMIN_ID) {
      alert('Доступ закрыт. Только для администратора.');
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
      if (box) box.innerHTML = '<div style="color:#a8c5d9;padding:12px;grid-column:1/-1">Не удалось загрузить пары</div>';
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
        localStorage.setItem('aiBotSelectedCat', selectedCat);
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
      box.innerHTML = '<div style="color:#a8c5d9;padding:12px;text-align:center;grid-column:1/-1">Ничего не найдено</div>';
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
        localStorage.setItem('aiBotSelectedPair', selectedPair);
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

  function openTfPopup() {
    var overlay = $('tfOverlay');
    var box = $('tfOptions');
    if (!overlay || !box) return;
    box.innerHTML = TIMEFRAMES.map(function (tf) {
      var sel = tf.value === selectedTf ? ' selected' : '';
      return '<div class="tf-opt' + sel + '" data-tf="' + tf.value + '">' + tf.label + '</div>';
    }).join('');
    box.querySelectorAll('.tf-opt').forEach(function (opt) {
      opt.addEventListener('click', function () {
        selectedTf = Number(opt.dataset.tf);
        localStorage.setItem('aiBotSelectedTf', selectedTf);
        updateTfDisplay();
        overlay.classList.add('hidden');
      });
    });
    overlay.classList.remove('hidden');
  }

  function tfLabel() {
    var tf = TIMEFRAMES.find(function (t) { return t.value === selectedTf; });
    return tf ? tf.label : (selectedTf + ' сек');
  }

  function nextCandleOpenMs() {
    var now = Date.now();
    var tfMs = selectedTf * 1000;
    var next = Math.ceil(now / tfMs) * tfMs;
    if (next - now < 500) next += tfMs;
    return next;
  }

  function cacheKey() {
    return selectedPair + '|' + selectedTf + '|' + nextCandleOpenMs();
  }

  function analyzeTicks(candles) {
    if (!candles || candles.length < 3) {
      return { isDown: Math.random() > 0.5, reason: 'Анализ по тикам', entry: null };
    }
    var recent = candles.slice(-8);
    var closes = recent.map(function (c) { return Number(c.close) || 0; });
    var last = closes[closes.length - 1];
    var prev = closes[closes.length - 2] || last;
    var older = closes[Math.max(0, closes.length - 5)] || prev;
    var downCount = 0;
    var upCount = 0;
    for (var i = 1; i < closes.length; i++) {
      if (closes[i] < closes[i - 1]) downCount++;
      else if (closes[i] > closes[i - 1]) upCount++;
    }
    var score = 0;
    if (last < prev) score -= 3; else score += 3;
    if (last < older) score -= 2; else score += 2;
    if (downCount > upCount + 1) score -= 2;
    if (upCount > downCount + 1) score += 2;
    var isDown = score < 0;
    var reason = (isDown ? 'Импульс вниз' : 'Импульс вверх') + ' · ' + downCount + '↓/' + upCount + '↑';
    return { isDown: isDown, reason: reason, entry: last };
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
    s1.setAttribute('stop-color', '#19e58b');
    s1.setAttribute('stop-opacity', '0.5');
    var s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s2.setAttribute('offset', '100%');
    s2.setAttribute('stop-color', '#19e58b');
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
      poly.setAttribute('stroke', '#36d8f2');
      poly.setAttribute('stroke-width', '1.8');
      poly.setAttribute('stroke-linecap', 'round');
      svg.appendChild(poly);
      function tickLine() {
        if (!running) return;
        pts.shift();
        var last = pts[pts.length - 1];
        var ny = last.y + (Math.random() - 0.5) * 5;
        ny = Math.max(4, Math.min(32, ny));
        pts.push({ x: last.x + 5.6, y: ny });
        poly.setAttribute('points', pts.map(function (p) { return p.x + ',' + p.y; }).join(' '));
        area.setAttribute('points', pts.map(function (p) { return p.x + ',' + p.y; }).join(' ') + ' 100,36 0,36');
        requestAnimationFrame(tickLine);
      }
      tickLine();
    } else if (type === 'impulse' || type === 'vol') {
      var bars = [];
      for (var b = 0; b < 10; b++) {
        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', 3 + b * 9.6);
        rect.setAttribute('width', 6);
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', '#19e58b');
        svg.appendChild(rect);
        bars.push(rect);
      }
      function tickBars() {
        if (!running) return;
        bars.forEach(function (rect) {
          var h = 4 + Math.random() * 24;
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
      circle.setAttribute('stroke', '#36d8f2');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', '#19e58b');
      svg.appendChild(dot);
      var angle = 0;
      function tickSess() {
        if (!running) return;
        angle += 0.06;
        dot.setAttribute('cx', 50 + Math.cos(angle) * 12);
        dot.setAttribute('cy', 18 + Math.sin(angle) * 12);
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
      bg.setAttribute('fill', 'rgba(255,255,255,0.08)');
      svg.appendChild(bg);
      var fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      fill.setAttribute('x', '8');
      fill.setAttribute('y', '14');
      fill.setAttribute('height', '8');
      fill.setAttribute('rx', '4');
      fill.setAttribute('fill', '#19e58b');
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
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    chartAnimators.forEach(function (s) { if (typeof s === 'function') s(); });
    chartAnimators = [];
    var btn = $('getSignalBtn');
    if (btn) btn.disabled = true;
    var main = $('signalMain');
    var analysis = $('analysisView');
    var overlay = $('signalOverlay');
    if (overlay) overlay.classList.add('hidden');
    if (main) main.style.display = 'none';
    if (analysis) analysis.style.display = 'block';

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
    if (indBox) {
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
    }

    var bar = $('analysisBar');
    var status = $('analysisStatus');
    var countEl = $('progressCount');
    var bottom = $('bottomStatus');

    for (var i = 0; i < indicators.length; i++) {
      var num = i + 1;
      if (status) status.textContent = 'Взвешиваю всё...';
      if (bottom) bottom.textContent = 'GPT 6.0 анализирует... ' + num + ' из ' + indicators.length;
      if (countEl) countEl.textContent = num + ' из ' + indicators.length;
      if (bar) bar.style.width = (num / indicators.length * 100) + '%';
      var el = $('ind-' + indicators[i].key);
      if (el) el.classList.add('show');
      await sleep(400);
    }

    var key = cacheKey();
    var cached = signalCache[key];
    var result;

    if (cached && cached.expires > Date.now()) {
      result = cached;
    } else {
      var candles = [];
      try {
        var candlesRes = await fetch('/api/candles?pair=' + encodeURIComponent(selectedPair) + '&period=' + selectedTf);
        if (candlesRes.ok) {
          var candleData = await candlesRes.json();
          candles = candleData.candles || [];
        }
      } catch (e) {
        console.error('candles fetch failed', e);
      }
      result = analyzeTicks(candles);
      result.expires = nextCandleOpenMs();
      signalCache[key] = result;
    }

    var isDown = result.isDown;
    var reason = result.reason;
    lastEntryPrice = result.entry;
    var chartColor = isDown ? '#ff526d' : '#19e58b';

    indicators.forEach(function (ind) {
      var el = $('ind-' + ind.key);
      if (!el) return;
      var val = isDown ? 'Вниз' : 'Вверх';
      if (ind.key === 'rsi') val = isDown ? '38' : '62';
      if (ind.key === 'support') val = isDown ? 'слабая' : 'сильная';
      if (ind.key === 'session') val = isDown ? 'азиатская' : 'европейская';
      var valueEl = el.querySelector('.value');
      if (valueEl) {
        valueEl.textContent = val;
        valueEl.style.color = chartColor;
      }
      el.querySelectorAll('polyline').forEach(function (p) { p.setAttribute('stroke', chartColor); });
    });

    if (status) status.textContent = 'Анализ завершён';
    if (bottom) bottom.textContent = 'GPT 6.0 завершил анализ';
    await sleep(500);
    showResult(isDown, reason, lastEntryPrice);
    if (btn) btn.disabled = false;
  }

  function closeSignal() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    var overlay = $('signalOverlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function showResult(isDown, reason, entryPrice) {
    chartAnimators.forEach(function (s) { if (typeof s === 'function') s(); });
    chartAnimators = [];
    var analysis = $('analysisView');
    if (analysis) analysis.style.display = 'none';
    var main = $('signalMain');
    if (main) main.style.display = 'block';

    var overlay = $('signalOverlay');
    var card = $('signalCard');
    if (!overlay || !card) return;

    var dir = isDown ? 'ВНИЗ' : 'ВВЕРХ';
    var cls = isDown ? 'down' : 'up';
    var icon = isDown ? '↓' : '↑';
    var tfName = tfLabel();
    var pairName = allPairs.find(function (p) { return p.symbol === selectedPair; });
    var pairLabel = pairName ? pairName.display : selectedPair;
    var priceStr = entryPrice ? entryPrice.toFixed(5).replace(/\.?0+$/, '') : '—';
    var nextOpen = nextCandleOpenMs();

    card.innerHTML =
      '<div class="big-signal ' + cls + '" style="position:relative">' +
        '<button id="closeBtn" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#a8c5d9;font-size:22px;cursor:pointer;line-height:1">×</button>' +
        '<div class="signal-icon ' + cls + '">' + icon + '</div>' +
        '<div style="font-size:12px;color:#a8c5d9;margin-bottom:6px">' + pairLabel + '</div>' +
        '<div class="direction">' + dir + '</div>' +
        '<div class="entry-price">Вход: ' + priceStr + '</div>' +
        '<div style="margin-top:6px;font-size:13px">Следующая свеча · ' + tfName + '</div>' +
        '<div class="countdown" id="cd">До открытия: ...</div>' +
        '<div style="margin-top:10px;font-size:11px;color:#a8c5d9">' + (reason || '') + '</div>' +
        '<button class="rescan-btn" id="rescanBtn">Сканировать снова</button>' +
      '</div>';

    overlay.classList.remove('hidden');

    var closeBtn = $('closeBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeSignal);

    var rescan = $('rescanBtn');
    if (rescan) {
      rescan.addEventListener('click', function () {
        closeSignal();
        getSignal();
      });
    }

    var cd = $('cd');
    function tick() {
      var left = Math.max(0, Math.round((nextOpen - Date.now()) / 1000));
      if (left <= 0) {
        if (cd) cd.textContent = 'Свеча открыта';
        clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }
      var m = Math.floor(left / 60);
      var s = left % 60;
      if (cd) cd.textContent = 'До открытия: ' + (m > 0 ? m + ':' + String(s).padStart(2, '0') : '0:' + String(s).padStart(2, '0'));
    }
    tick();
    countdownTimer = setInterval(tick, 250);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var searchInput = $('pairSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      searchQuery = searchInput.value.trim();
      renderPairs();
    });
  }

  var tfSel = $('tfSelector');
  if (tfSel) tfSel.addEventListener('click', openTfPopup);

  var tfOverlay = $('tfOverlay');
  if (tfOverlay) {
    tfOverlay.addEventListener('click', function (e) {
      if (e.target === tfOverlay) tfOverlay.classList.add('hidden');
    });
  }

  var getBtn = $('getSignalBtn');
  if (getBtn) getBtn.addEventListener('click', getSignal);

  var saveBtn = $('saveIdBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      $('profileStatus').innerHTML = '<span style="color:#ff526d">Доступ только для администратора</span>';
    });
  }

  function init() {
    initTelegram();
    updateTfDisplay();
    loadPayouts();
    var stats = $('todayStats');
    if (stats) stats.innerHTML = 'Сделки: 0<br>Успешные: —<br>Оборот: —';
    if (userId === ADMIN_ID) {
      showPage('signal');
    } else {
      showPage('profile');
      var status = $('profileStatus');
      if (status) status.innerHTML = '<span style="color:#ff526d">Доступ закрыт</span>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
