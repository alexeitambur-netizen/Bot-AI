# Bot AI

Только сканер котировок Pocket Option. Без обучения, книг, чата и остальных разделов VIP Community.

Исходный репозиторий VIP-COMMUNITY не изменялся. Сюда скопированы движок сканера и шлюз котировок:

- scanner-po.js — сканер пар, свечи, сигнал
- market-signal.js, signal-engine.js — расчёт сигнала
- po-demo.js — живые котировки Pocket Option
- экраны списка пар и полноэкранного анализа

Фронт по умолчанию берёт котировки с уже работающего шлюза https://vip-community.onrender.com (SERVER_URL в index.html). Свой сервер можно поднять отдельно и подменить адрес.

## Telegram

1. В BotFather создай нового бота и возьми токен. Не используй токен VIP Community: два процесса с одним токеном будут мешать друг другу.
2. Задеплой этот репозиторий на Vercel.
3. В BotFather: Bot Settings → Menu Button → URL = ссылка Vercel.
4. Если нужен серверный бот с кнопкой «Открыть сканер», задеплой server.js на Render и задай BOT_TOKEN и WEBAPP_URL (ссылка Vercel).

Команды бота: /start, /scanner, /myid.
