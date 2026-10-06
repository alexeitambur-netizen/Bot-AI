# Bot AI

Сканер котировок Pocket Option. Без обучения и остальных разделов VIP Community.

Котировки привязаны к уже работающему приложению `VIP-COMMUNITY` (`https://vip-community.onrender.com`). Токены Telegram, Groq и Supabase для сканера не нужны: фронт ходит в `/api/payouts`, `/api/candles`, `/api/po/health`.

На Vercel папка `api/` проксирует эти запросы в тот же шлюз. Если открыть статику без своего сервера, `index.html` всё равно берёт котировки напрямую с VIP-шлюза.

Сейчас шлюз отдаёт живые пары Pocket Option (валюты, крипта, сырьё, акции, индексы) и свечи.

`VIP-COMMUNITY` этим репозиторием не изменяется.
