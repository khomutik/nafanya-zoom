# Установка в другой Zoom-аккаунт

Ниже — полный перенос. Код общий, но Cloudflare, VPS, Zoom App, бот-аккаунт и все секреты должны принадлежать новой группе.

## 1. Подготовка

Понадобятся:

- Zoom-аккаунт с правом создавать приложения;
- отдельный Zoom-пользователь для браузерного бота;
- Cloudflare-аккаунт с Workers, Durable Objects и R2;
- VPS Linux с Docker, Docker Compose и Caddy;
- домен с HTTPS;
- Node.js 22 и Git на компьютере администратора.

```bash
git clone https://github.com/khomutik/nafanya-zoom.git
cd nafanya-zoom
npm --prefix worker ci
npm --prefix sender ci
npm test
```

## 2. Настройте группу

Отредактируйте [`config/group.json`](../config/group.json). Не вставляйте туда пароли или закрытые служебные ссылки: файл публичный.

Проверьте изменения:

```bash
npm --prefix worker test
```

## 3. Разверните Cloudflare Worker

Войдите в нужный Cloudflare-аккаунт и создайте приватный R2 bucket:

```bash
cd worker
npx wrangler login
npx wrangler r2 bucket create nafanya-zoom-library
```

Если меняете имя bucket, одновременно исправьте `bucket_name` в `worker/wrangler.jsonc`.

Создайте две разные случайные строки и сохраните их. Затем добавьте их в Worker:

```bash
npx wrangler secret put ZOOM_ONLY_SECRET
npx wrangler secret put ZOOM_PANEL_TOKEN
npm run check
npm run deploy
```

Запишите опубликованный адрес вида `https://nafanya-zoom-worker.<account>.workers.dev`.

## 4. Подготовьте VPS sender

Скопируйте каталог проекта на сервер, например в `/opt/nafanya-zoom`, и создайте окружение:

```bash
cd /opt/nafanya-zoom/sender
cp .env.example .env
chmod 600 .env
```

Заполните минимум:

```dotenv
WORKER_BASE_URL=https://YOUR-WORKER.workers.dev
ZOOM_ONLY_SECRET=тот-же-секрет-что-в-Worker
ZOOM_PANEL_TOKEN=тот-же-panel-token-что-в-Worker
ZOOM_MEETING_URL=https://zoom.us/j/ВАША_ПОСТОЯННАЯ_ССЫЛКА
ZOOM_DISPLAY_NAME=Название группы (бот)
ZOOM_APP_TITLE=Пульт группы в Zoom
ZOOM_CONTROL_TOKEN=новая-случайная-строка
ZOOM_APP_CLIENT_SECRET=будет-добавлен-после-создания-Zoom-App
ZOOM_APP_SESSION_SECRET=ещё-одна-случайная-строка
ZOOM_AUTH_EMAIL=отдельный-аккаунт-бота
ZOOM_AUTH_PASSWORD=пароль-аккаунта-бота
ZOOM_CONTROL_PROJECT_HOST_PATH=/opt/nafanya-zoom/sender
```

Соберите sender и запустите control-agent:

```bash
docker compose -p nafanya-zoom-sender -f compose.example.yml build
docker compose -f control-agent.compose.example.yml up -d
```

Добавьте в Caddy адаптированный [`docs/Caddyfile.example`](Caddyfile.example), проверьте и перезагрузите Caddy.

## 5. Создайте собственное Zoom App

В Zoom App Marketplace:

1. `Develop` → `Build App` → `General App`.
2. Выберите `User-managed` — этот режим даёт Zoom Apps SDK для Meetings.
3. В `Surface` включите `Meetings`, `Zoom Apps SDK`, Desktop и Mobile.
4. Home URL: `https://YOUR-DOMAIN/nafanya-zoom-control/zoom-app`.
5. В Domain Allow List добавьте `https://YOUR-DOMAIN`.
6. Установите собственные название, описание и иконку.
7. Скопируйте development Client Secret в `ZOOM_APP_CLIENT_SECRET` на VPS.
8. Добавьте тестовых пользователей приложения или одобрите его для нужных пользователей аккаунта.

Приложение запрашивает в `zoomSdk.config()` возможности `appPopout`, `getSupportedJsApis`, `setDynamicIndicator`, `removeDynamicIndicator` и `extendDynamicIndicator`. Оно не слушает вход участников и не передаёт самодельный звук через `shareComputerAudio`. Если Zoom изменит названия разделов Marketplace, ориентируйтесь на Meetings + Zoom Apps SDK, а не на древние скриншоты из интернета — они стареют бодрее молока.

Необязательный изолированный тест редактирования сообщений Team Chat настраивается отдельно по [`TEAM_CHAT_TEST.md`](TEAM_CHAT_TEST.md).

После изменения `.env` перезапустите control-agent:

```bash
docker compose -f control-agent.compose.example.yml up -d --force-recreate
```

Официальная текущая инструкция Zoom по General App: <https://developers.zoom.us/docs/integrations/create/>.

## 6. Один раз авторизуйте бота

Откройте:

```text
https://YOUR-DOMAIN/nafanya-zoom-control/app?token=ZOOM_CONTROL_TOKEN
```

Ссылка установит защищённую cookie и уберёт token из адресной строки. В админском блоке выберите восстановление входа Zoom, откройте временное окно и завершите проверку Zoom. После сохранения профиля отключите режим авторизации и включите бота.

Микрофон и видео sender выключает после входа и перепроверяет их состояние.

## 7. Загрузите библиотеку

В админском блоке выберите локальную папку Markdown/Obsidian. Панель игнорирует `.obsidian`, проверяет содержимое и сначала показывает dry-run. Публикуйте только после успешной проверки.

Markdown остаётся на компьютере администратора. Рабочая копия для бота хранится в приватном R2; локальную папку после импорта можно перемещать.

## 8. Контрольная конференция

Проверьте по порядку:

1. бот входит с выключенными микрофоном и видео;
2. короткая кнопка появляется в общем чате;
3. длинный текст разбивается без потери и без `Часть 1/2`;
4. две одинаковые записи добавляются в очередь как разные позиции;
5. `Высказался`, `Вернуть`, `Пропускает` и удаление сохраняют порядок;
6. спикерская не смешивается с обычной очередью;
7. таймер, запущенный с телефона, виден на настольном Zoom;
8. нативный сигнал Zoom слышен на компьютере и телефоне;
9. вход нового участника не публикует темы повторно;
10. общая красная кнопка очищает обычную очередь и доп. темы, но не вопросы спикеру;
11. после остановки sender не продолжает опрашивать Zoom.

## 9. Обновление

Перед обновлением скопируйте `.env`, Caddyfile и профиль sender. Затем:

```bash
git pull --ff-only
npm --prefix worker ci
npm --prefix sender ci
npm test
npm --prefix worker run deploy
docker compose -p nafanya-zoom-sender -f sender/compose.example.yml build
docker compose -f sender/control-agent.compose.example.yml up -d --force-recreate
```
