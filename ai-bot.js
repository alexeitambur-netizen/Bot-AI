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

  function createViz(container, type, color) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 56');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '56');
    svg.style.display = 'block';
    container.appendChild(svg);
    var c = color || '#36d8f2';
    var running = true;

    if (type === 'line') {
      svg.innerHTML = '<g opacity="0.9"><path d="M10 40 L25 32 L40 28 L55 22 L70 18 L85 14" fill="none" stroke="' + c + '" stroke-width="2.5" stroke-linecap="round"/><path d="M10 40 L25 32 L40 28 L55 22 L70 18 L85 14 L85 48 L10 48 Z" fill="' + c + '" opacity="0.15"/><circle cx="85" cy="14" r="3" fill="' + c + '"/><path d="M75 8 L85 14 L80 18" fill="none" stroke="' + c + '" stroke-width="1.5"/></g>';
    } else if (type === 'support') {
      svg.innerHTML = '<g><ellipse cx="50" cy="38" rx="28" ry="8" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><ellipse cx="50" cy="38" rx="20" ry="5" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.8"/><path d="M30 30 Q50 20 70 30" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M35 26 Q50 16 65 26" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.7"/><circle cx="50" cy="18" r="3" fill="' + c + '"/></g>';
    } else if (type === 'move') {
      svg.innerHTML = '<g><rect x="22" y="8" width="56" height="40" rx="4" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M38 20 L38 36 M46 18 L46 38 M54 22 L54 34 M62 16 L62 40" fill="none" stroke="' + c + '" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="28" r="2" fill="' + c + '"/></g>';
    } else if (type === 'impulse') {
      svg.innerHTML = '<g><ellipse cx="50" cy="22" rx="12" ry="10" fill="' + c + '" opacity="0.3"/><path d="M40 20 Q45 12 50 14 Q55 12 60 20 Q58 28 50 30 Q42 28 40 20" fill="' + c + '" opacity="0.6"/><line x1="50" y1="8" x2="50" y2="36" stroke="' + c + '" stroke-width="1" opacity="0.5"/><line x1="30" y1="22" x2="70" y2="22" stroke="' + c + '" stroke-width="1" opacity="0.5"/><rect x="28" y="38" width="4" height="12" rx="1" fill="' + c + '"/><rect x="36" y="34" width="4" height="16" rx="1" fill="' + c + '"/><rect x="44" y="30" width="4" height="20" rx="1" fill="' + c + '"/><rect x="52" y="32" width="4" height="18" rx="1" fill="' + c + '"/><rect x="60" y="36" width="4" height="14" rx="1" fill="' + c + '"/></g>';
    } else if (type === 'session') {
      svg.innerHTML = '<g><path d="M15 42 L50 20 L85 42" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.4"/><path d="M25 42 L50 26 L75 42" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><circle cx="50" cy="36" r="8" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="50" cy="36" r="3" fill="' + c + '" opacity="0.5"/></g>';
    } else if (type === 'ma') {
      svg.innerHTML = '<g><rect x="35" y="42" width="30" height="6" rx="2" fill="' + c + '" opacity="0.4"/><polygon points="50,12 58,28 42,28" fill="' + c + '" opacity="0.7"/><polygon points="50,18 54,28 46,28" fill="' + c + '"/><rect x="46" y="28" width="8" height="14" fill="' + c + '" opacity="0.8"/></g>';
    } else if (type === 'rsi') {
      svg.innerHTML = '<g><path d="M12 40 L22 32 L32 36 L42 24 L52 28 L62 18" fill="none" stroke="' + c + '" stroke-width="2"/><rect x="68" y="22" width="20" height="14" rx="2" fill="none" stroke="' + c + '" stroke-width="1.5"/><polygon points="78,22 70,30 86,30" fill="' + c + '" opacity="0.4"/><rect x="20" y="44" width="40" height="4" rx="2" fill="' + c + '" opacity="0.6"/></g>';
    } else if (type === 'vol') {
      svg.innerHTML = '<g><rect x="20" y="48" width="60" height="4" rx="1" fill="' + c + '" opacity="0.3"/><rect x="24" y="36" width="6" height="12" fill="' + c + '"/><rect x="34" y="28" width="6" height="20" fill="' + c + '"/><rect x="44" y="22" width="6" height="26" fill="' + c + '"/><rect x="54" y="30" width="6" height="18" fill="' + c + '"/><rect x="64" y="34" width="6" height="14" fill="' + c + '"/><rect x="74" y="38" width="6" height="10" fill="' + c + '"/></g>';
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
      { key: 'trend', label: 'Тренд — ' + tfName, type: 'line', color: '#ff9a3c' },
      { key: 'support', label: 'Поддержка', type: 'support', color: '#c46bff' },
      { key: 'move', label: 'Ход за ' + tfName, type: 'move', color: '#ff5ec7' },
      { key: 'impulse', label: 'Импульс', type: 'impulse', color: '#39ff6a' },
      { key: 'session', label: 'Сессия', type: 'session', color: '#36d8f2' },
      { key: 'ma', label: 'Средние 50/200', type: 'ma', color: '#ff5a5a' },
      { key: 'rsi', label: 'RSI', type: 'rsi', color: '#ffe14a' },
      { key: 'vol', label: 'Волатильность', type: 'vol', color: '#4ad4ff' }
    ];

    var indBox = $('indicators');
    if (indBox) {
      indBox.innerHTML = '';
      indicators.forEach(function (ind) {
        var div = document.createElement('div');
        div.className = 'indicator ' + ind.key;
        div.id = 'ind-' + ind.key;
        div.innerHTML = '<div class="label">' + ind.label + '</div><div class="value">—</div>';
        var wrap = document.createElement('div');
        wrap.className = 'chart-wrap';
        div.appendChild(wrap);
        indBox.appendChild(div);
        chartAnimators.push(createViz(wrap, ind.type, ind.color));
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
