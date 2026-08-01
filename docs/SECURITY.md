# Безопасность

## Секреты

Никогда не коммитьте `.env`, cookies, профиль Chromium, дампы диагностики и реальные токены. Для каждой установки создайте новые значения:

- `ZOOM_ONLY_SECRET` — общий секрет Worker ↔ sender;
- `ZOOM_PANEL_TOKEN` — Worker ↔ control-agent;
- `ZOOM_CONTROL_TOKEN` — вход администратора во внешний пульт;
- `ZOOM_APP_CLIENT_SECRET` — Client Secret из собственного Zoom Marketplace App;
- `ZOOM_APP_SESSION_SECRET` — отдельная случайная строка для серверной сессии Zoom App.

Пример генерации:

```bash
openssl rand -hex 32
```

В Cloudflare секреты добавляются через `wrangler secret put`, а на VPS — только в `sender/.env` с правами `600`.

## Сетевые границы

- sender health, control-agent и noVNC слушают только `127.0.0.1` хоста;
- наружу их публикует HTTPS reverse proxy;
- noVNC включается только на время ручной авторизации;
- control-agent имеет доступ к Docker socket, поэтому его админскую сессию нельзя открывать без токена;
- Worker сравнивает секреты в постоянное время и ограничивает размер тела импорта.

## Профиль Zoom

Каталог `zoom-sender-profile` содержит авторизованную сессию Zoom. Это почти ключ от аккаунта: не архивируйте его в публичные облака и не передавайте другой группе. При компрометации завершите активные сессии Zoom и создайте профиль заново.

## Публикация форка

Перед каждым публичным push проверьте:

```bash
git grep -nEi "password|secret|token|passcode|meeting[_ -]?id|@gmail|@yandex"
git status --short
```

Совпадения имён переменных допустимы; реальные значения — нет.

