'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');

const URL = 'wss://try-demo-eu.po.market/socket.io/?EIO=4&transport=websocket';
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALIASES = {
  GOLD: 'XAUUSD', 'XAU/EUR': 'XAUUSD', SILVER: 'XAGUSD', 'XAG/EUR': 'XAGUSD',
  BITCOIN: 'BTCUSD', 'BITCOIN ETF': 'BTCUSD', ETHEREUM: 'ETHUSD', SOLANA: 'SOLUSD',
  LITECOIN: 'LTCUSD', DOGECOIN: 'DOGEUSD', CARDANO: 'ADAUSD', POLYGON: 'MATICUSD',
  AVALANCHE: 'AVAXUSD', POLKADOT: 'DOTUSD', CHAINLINK: 'LINKUSD', TONCOIN: 'TONUSD',
  TRON: 'TRXUSD', BNB: 'BNBUSD', DASH: 'DASHUSD', 'BRENT OIL': 'UKOUSD',
  'WTI CRUDE OIL': 'USOUSD', 'NATURAL GAS': 'NGAS', APPLE: '#AAPL', TESLA: '#TSLA',
  MICROSOFT: '#MSFT', AMAZON: '#AMZN', NETFLIX: '#NFLX', INTEL: '#INTC',
  'FACEBOOK INC': '#FB', US100: 'USNDAQ100', SP500: 'SP500', DJI30: 'US30', JPN225: 'JPN225'
};

function demoToken() {
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function toSymbol(name) {
  let raw = String(name || '').trim();
  const otc = /\bOTC\b/i.test(raw);
  raw = raw.replace(/\s+OTC$/i, '').replace(/\s+spot$/i, '').trim();
  const upper = raw.toUpperCase();
  let base = ALIASES[upper];
  if (!base) base = raw.replace(/\//g, '').replace(/\s+/g, '').toUpperCase();
  base = base.replace(/_OTC$/i, '');
  if (otc || /_otc$/i.test(raw)) return base + '_otc';
  return base;
}

function asCandles(rows) {
  return (rows || []).map(function (row) {
    const time = Number(row[0]);
    const open = Number(row[1]);
    const close = Number(row[2]);
    const high = Number(row[3]);
    const low = Number(row[4]);
    return {
      t: time < 10000000000 ? time * 1000 : time,
      time: time,
      open: open,
      high: high,
      low: low,
      close: close
    };
  }).filter(function (c) {
    return isFinite(c.open) && isFinite(c.close) && c.close > 0 && c.high > 0 && c.low > 0;
  }).sort(function (a, b) { return a.time - b.time; });
}

function asTicks(history) {
  return (history || []).map(function (row) {
    if (!Array.isArray(row) || row.length < 2) return null;
    var time = Number(row[0]);
    var price = Number(row[1]);
    if (!(price > 0)) {
      time = Number(row[1]);
      price = Number(row[2]);
    }
    if (!(price > 0) || !isFinite(time)) return null;
    return { t: time < 10000000000 ? time * 1000 : time, price: price };
  }).filter(Boolean).sort(function (a, b) { return a.t - b.t; }).slice(-120);
}

function candlesFromTicks(ticks, periodSec) {
  const buckets = new Map();
  (ticks || []).forEach(function (tick) {
    const sec = tick.t > 10000000000 ? Math.floor(tick.t / 1000) : Math.floor(tick.t);
    const bucket = Math.floor(sec / periodSec) * periodSec;
    let bar = buckets.get(bucket);
    if (!bar) {
      buckets.set(bucket, {
        t: bucket * 1000,
        time: bucket,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price
      });
      return;
    }
    bar.high = Math.max(bar.high, tick.price);
    bar.low = Math.min(bar.low, tick.price);
    bar.close = tick.price;
  });
  return Array.from(buckets.values()).sort(function (a, b) { return a.time - b.time; });
}

function applyLiveTick(candles, history) {
  if (!candles.length || !history || !history.length) return candles.length ? candles[candles.length - 1].close : null;
  var tick = history.slice().sort(function (a, b) { return Number(a[0]) - Number(b[0]); }).pop();
  var price = Number(tick[1]);
  var tickSec = Number(tick[0]);
  if (!(price > 0)) return candles[candles.length - 1].close;
  var bar = candles[candles.length - 1];
  var barSec = bar.time > 10000000000 ? bar.time / 1000 : bar.time;
  if (tickSec + 1 >= barSec) {
    bar.close = price;
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
  }
  return price;
}

class DemoFeed {
  constructor() {
    this.ws = null;
    this.authed = false;
    this.connecting = null;
    this.token = demoToken();
    this.queue = [];
    this.pending = null;
    this.timer = null;
    this.expectBinary = null;
    this.assets = null;
    this.assetsAt = 0;
    this.cache = new Map();
    this.authWait = [];
  }

  connected() {
    return !!(this.ws && this.ws.readyState === WebSocket.OPEN && this.authed);
  }

  assetCount() {
    return Array.isArray(this.assets) ? this.assets.length : 0;
  }

  candles(pair, period, priority) {
    const symbol = toSymbol(pair);
    const tf = Math.max(1, Number(period) || 60);
    const key = symbol + ':' + tf;
    const hit = this.cache.get(key);
    if (hit && hit.candles && hit.candles.length && Date.now() - hit.touchedAt < 8000) {
      return Promise.resolve(this.snapshot(hit));
    }
    return new Promise((resolve, reject) => {
      const job = { symbol: symbol, period: tf, pair: pair, key: key, resolve: resolve, reject: reject };
      if (priority) this.queue.unshift(job);
      else this.queue.push(job);
      this.pump();
    });
  }

  snapshot(hit) {
    return {
      symbol: hit.symbol,
      requested: hit.requested,
      period: hit.period,
      last: hit.last,
      candles: hit.candles.slice(-400),
      ticks: (hit.ticks || []).slice(-120),
      quoteAt: hit.quoteAt,
      receivedAt: hit.receivedAt,
      source: 'pocketoption-demo'
    };
  }

  pump() {
    if (this.pending || !this.queue.length) return;
    this.ensure().then(() => this.next()).catch((err) => {
      const job = this.queue.shift();
      if (job) job.reject(err);
      this.pump();
    });
  }

  markAuthed() {
    if (this.authed) return;
    this.authed = true;
    const waiters = this.authWait.splice(0);
    waiters.forEach(function (fn) { fn(); });
  }

  ensure() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authed) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(URL, {
        headers: { Origin: 'https://pocketoption.com', 'User-Agent': 'Mozilla/5.0' }
      });
      this.ws = ws;
      this.authed = false;
      this.expectBinary = null;
      const fail = (err) => {
        this.connecting = null;
        this.authed = false;
        try { ws.close(); } catch (e) {}
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('demo connect timeout')), 12000);
      this.authWait.push(() => {
        clearTimeout(timer);
        this.connecting = null;
        resolve();
      });
      ws.on('message', (buf, isBinary) => this.onMessage(buf, isBinary));
      ws.on('error', (err) => {
        if (!this.authed) fail(err);
      });
      ws.on('close', () => {
        this.authed = false;
        this.ws = null;
        this.expectBinary = null;
        if (this.pending) {
          const job = this.pending;
          this.pending = null;
          clearTimeout(this.timer);
          job.reject(new Error('demo socket closed'));
        }
        this.connecting = null;
      });
    });
    return this.connecting;
  }

  next() {
    if (this.pending || !this.queue.length || !this.ws || !this.authed) return;
    const job = this.queue.shift();
    this.pending = job;
    this.timer = setTimeout(() => {
      if (this.pending === job) {
        this.pending = null;
        job.reject(new Error('demo history timeout'));
        this.pump();
      }
    }, 8000);
    this.ws.send('42["changeSymbol",' + JSON.stringify({ asset: job.symbol, period: job.period }) + ']');
  }

  onMessage(buf, isBinary) {
    const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
    if (!isBinary) {
      if (text === '2') {
        try { this.ws.send('3'); } catch (e) {}
        return;
      }
      if (text.startsWith('0') && text.indexOf('sid') >= 0) {
        try { this.ws.send('40'); } catch (e) {}
        return;
      }
      if (text.startsWith('40') && text.indexOf('sid') >= 0 && !this.authed) {
        try {
          this.ws.send('42["auth",' + JSON.stringify({
            token: this.token,
            balance: 50000,
            isDemo: 1,
            isFastHistory: true
          }) + ']');
        } catch (e) {}
        return;
      }
      const named = text.match(/^45\d*-?\["([^"]+)"/);
      if (named) {
        this.expectBinary = named[1];
        return;
      }
      if (text.startsWith('42')) {
        try {
          const packet = JSON.parse(text.slice(2));
          if (Array.isArray(packet)) this.onEvent(packet[0], packet[1], false);
        } catch (e) {}
      }
      return;
    }
    const event = this.expectBinary;
    this.expectBinary = null;
    if (!event) return;
    let data;
    try { data = JSON.parse(text); } catch (e) { return; }
    this.onEvent(event, data, true);
  }

  onEvent(event, data) {
    if (event === 'successauth') this.markAuthed();
    if (event === 'updateAssets' && Array.isArray(data)) {
      this.assets = data;
      this.assetsAt = Date.now();
      return;
    }
    if (event === 'updateStream') {
      this.applyStream(data);
      return;
    }
    if (event === 'updateHistoryNewFast' || event === 'updateHistoryNew') {
      this.finishHistory(data);
    }
  }

  applyStream(data) {
    const rows = Array.isArray(data) ? data : [];
    rows.forEach((row) => {
      if (!Array.isArray(row) || row.length < 3) return;
      const symbol = String(row[0] || '');
      const ts = Number(row[1]);
      const price = Number(row[2]);
      if (!symbol || !(price > 0) || !isFinite(ts)) return;
      this.cache.forEach((pack) => {
        if (pack.symbol !== symbol || !pack.candles || !pack.candles.length) return;
        const sec = ts > 10000000000 ? ts / 1000 : ts;
        const bucket = Math.floor(sec / pack.period) * pack.period;
        const last = pack.candles[pack.candles.length - 1];
        const lastSec = last.time > 10000000000 ? last.time / 1000 : last.time;
        if (bucket > lastSec + 1) {
          pack.candles.push({
            t: bucket * 1000,
            time: bucket,
            open: price,
            high: price,
            low: price,
            close: price
          });
          if (pack.candles.length > 400) pack.candles.splice(0, pack.candles.length - 400);
        } else {
          last.close = price;
          last.high = Math.max(last.high, price);
          last.low = Math.min(last.low, price);
        }
        pack.last = price;
        pack.quoteAt = ts < 10000000000 ? ts * 1000 : ts;
        pack.touchedAt = Date.now();
        pack.ticks = (pack.ticks || []).concat([{ t: pack.quoteAt, price: price }]).slice(-120);
      });
    });
  }

  finishHistory(data) {
    if (!data || !this.pending) return;
    if (!data.asset && !data.history && !data.candles) return;
    if (data.asset && data.asset !== this.pending.symbol) return;
    const job = this.pending;
    this.pending = null;
    clearTimeout(this.timer);
    let candles = asCandles(data.candles).slice(-400);
    const ticks = asTicks(data.history);
    if (candles.length < 8 && ticks.length) candles = candlesFromTicks(ticks, job.period).slice(-400);
    const last = applyLiveTick(candles, data.history);
    const quoteAt = ticks.length ? ticks[ticks.length - 1].t : (candles.length ? Number(candles[candles.length - 1].t) : Date.now());
    const pack = {
      symbol: data.asset || job.symbol,
      requested: job.pair,
      period: Number(data.period || job.period),
      last: last,
      candles: candles,
      ticks: ticks,
      quoteAt: quoteAt,
      receivedAt: Date.now(),
      touchedAt: Date.now(),
      source: 'pocketoption-demo'
    };
    this.cache.set(job.key, pack);
    job.resolve(this.snapshot(pack));
    this.pump();
  }
}

const feed = new DemoFeed();

function candles(pair, period) {
  return feed.candles(pair, period, true);
}

function boardFromAssets(rows) {
  var map = {
    currency: 'currencies',
    cryptocurrency: 'crypto',
    commodity: 'commodities',
    stock: 'stocks',
    index: 'indices'
  };
  var categories = { currencies: [], crypto: [], commodities: [], stocks: [], indices: [] };
  rows.forEach(function (row) {
    if (!Array.isArray(row) || row.length < 15) return;
    var bucket = map[row[3]];
    if (!bucket) return;
    categories[bucket].push({
      symbol: row[1],
      display: row[2] || row[1],
      payout: Math.round(Number(row[5]) || 0),
      type: row[3],
      active: row[14] === true
    });
  });
  return {
    status: 'ONLINE',
    source: 'pocketoption-demo',
    timestamp: Date.now(),
    categories: categories
  };
}

function payouts() {
  return feed.ensure().then(function () {
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      (function waitAssets() {
        if (feed.assets && feed.assets.length) return resolve(boardFromAssets(feed.assets));
        if (Date.now() - started > 8000) return reject(new Error('demo assets timeout'));
        setTimeout(waitAssets, 150);
      })();
    });
  });
}

function health() {
  return {
    ok: true,
    connected: feed.connected(),
    source: 'pocketoption-demo',
    assets: feed.assetCount()
  };
}

module.exports = { candles, payouts, toSymbol, health };
