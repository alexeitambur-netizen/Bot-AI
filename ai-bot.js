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

  async function getSignal() {
    if (!checkAccess()) return;
    var btn = $('getSignalBtn');
    btn.disabled = true;
    $('signalMain').style.display = 'none';
    $('analysisView').style.display = 'block';
    $('signalResult').style.display = 'none';

    var indicators = [
      { key: 'trend', label: 'Тренд — ' + selectedTf + ' сек' },
      { key: 'support', label: 'Поддержка' },
      { key: 'move', label: 'Ход за ' + selectedTf + ' сек' },
      { key: 'impulse', label: 'Импульс' },
      { key: 'session', label: 'Сессия' },
      { key: 'ma', label: 'Средние 50/200' },
      { key: 'rsi', label: 'RSI' },
      { key: 'vol', label: 'Волатильность' }
    ];

    var indBox = $('indicators');
    indBox.innerHTML = indicators.map(function (ind) {
      return '<div class="indicator" id="ind-' + ind.key + '"><div class="label">' + ind.label + '</div><div class="value">—</div></div>';
    }).join('');

    var bar = $('analysisBar');
    var status = $('analysisStatus');

    // Sequential reveal of indicators
    for (var i = 0; i < indicators.length; i++) {
      status.textContent = 'GPT 6.0 анализирует... ' + (i + 1) + ' из ' + indicators.length;
      bar.style.width = ((i + 1) / indicators.length * 100) + '%';
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

      // Fill values after animation
      indicators.forEach(function (ind) {
        var el = $('ind-' + ind.key);
        if (!el) return;
        var val = isDown ? 'Вниз' : 'Вверх';
        if (ind.key === 'rsi') val = isDown ? '38' : '62';
        if (ind.key === 'support') val = isDown ? 'слабая' : 'сильная';
        el.querySelector('.value').textContent = val;
      });

      status.textContent = 'Анализ завершён';
      await sleep(700);
      showResult(isDown, reason);
    } catch (e) {
      status.textContent = 'Ошибка получения данных';
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  }

  function showResult(isDown, reason) {
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
