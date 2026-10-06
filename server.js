const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const poDemo = require('./po-demo');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '');
const signalLogPath = path.join(__dirname, 'signal-log.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname, { index: 'index.html' }));

function log(message, type) {
    console.log('[' + new Date().toISOString() + '] [' + (type || 'INFO') + '] ' + message);
}

let currentPayouts = {
    status: 'ONLINE',
    timestamp: Date.now(),
    categories: { currencies: [], crypto: [], commodities: [], stocks: [], indices: [] }
};

app.get('/api/health', function (_req, res) {
    res.json({ status: 'ok', service: 'Bot AI scanner', timestamp: Date.now() });
});

app.get('/api/payouts', async function (_req, res) {
    try {
        const demo = await poDemo.payouts();
        if (demo && demo.categories && demo.categories.currencies && demo.categories.currencies.length) {
            currentPayouts = demo;
            return res.json(demo);
        }
    } catch (e) {}
    return res.json(currentPayouts);
});

app.get('/api/po/health', function (_req, res) {
    res.json(poDemo.health ? poDemo.health() : { ok: true, connected: false, source: 'pocketoption-demo' });
});

app.get('/api/candles', async function (req, res) {
    const pair = req.query.pair || req.query.symbol || 'EURUSD_otc';
    const period = req.query.period || '60';
    try {
        const demo = await poDemo.candles(pair, period);
        if (demo && Array.isArray(demo.candles) && demo.candles.length) return res.json(demo);
    } catch (e) {
        return res.status(503).json({ ok: false, error: 'Нет свечей Pocket Option' });
    }
    return res.status(503).json({ ok: false, error: 'Нет свечей Pocket Option' });
});

function readSignalLog() {
    try {
        const parsed = JSON.parse(fs.readFileSync(signalLogPath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

app.get('/api/signals', function (req, res) {
    const pair = req.query.pair;
    const rows = readSignalLog().filter(function (row) { return !pair || row.pair === pair; });
    res.json({ ok: true, rows: rows });
});

app.post('/api/signals', function (req, res) {
    const body = req.body || {};
    const list = readSignalLog();
    const keep = {
        id: body.id || Date.now().toString(36),
        pair: body.pair || '',
        side: body.side || '',
        tf: body.tf || 1,
        createdAt: body.createdAt || Date.now(),
        expiresAt: body.expiresAt || null,
        entry: body.entry || null,
        status: body.status || 'open'
    };
    const idx = list.findIndex(function (item) { return item.id === keep.id; });
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], keep);
    else list.push(keep);
    const trimmed = list.slice(-400);
    fs.writeFile(signalLogPath, JSON.stringify(trimmed), function () {});
    res.json({ ok: true, row: keep });
});

let bot = null;
if (BOT_TOKEN) {
    const { Telegraf, Markup } = require('telegraf');
    bot = new Telegraf(BOT_TOKEN);
    bot.start(async function (ctx) {
        const text = 'Bot AI. Только сканер котировок Pocket Option. Открой приложение и выбери пару.';
        const rows = [];
        if (WEBAPP_URL) rows.push([Markup.button.webApp('Открыть сканер', WEBAPP_URL)]);
        await ctx.reply(text, rows.length ? Markup.inlineKeyboard(rows) : undefined);
    });
    bot.command('myid', function (ctx) {
        ctx.reply('Telegram ID: ' + ctx.from.id);
    });
    bot.command('scanner', async function (ctx) {
        if (!WEBAPP_URL) return ctx.reply('Задай WEBAPP_URL на сервере — ссылка на приложение.');
        await ctx.reply('Сканер котировок', Markup.inlineKeyboard([
            [Markup.button.webApp('Открыть сканер', WEBAPP_URL)]
        ]));
    });
    bot.launch().then(function () { log('Telegram бот запущен', 'BOT'); }).catch(function (err) {
        log('Бот не запустился: ' + err.message, 'ERROR');
    });
    process.once('SIGINT', function () { bot.stop('SIGINT'); });
    process.once('SIGTERM', function () { bot.stop('SIGTERM'); });
} else {
    log('BOT_TOKEN не задан — API сканера работает, Telegram бот выключен', 'WARN');
}

app.listen(PORT, function () {
    log('Bot AI слушает порт ' + PORT, 'SERVER');
});
