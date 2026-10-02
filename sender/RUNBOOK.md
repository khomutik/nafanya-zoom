# Zoom Sender v2: боевой runbook

> **Текущий режим с 1 августа 2026:** старая Zoom-очередь, которая читала коды из Zoom-чата, удалена. Текущая свободная очередь ведётся только кнопками в Zoom App. Sender не читает заявки из чата, а только забирает готовые сообщения из outbox и отправляет их в Zoom.

Эта инструкция описывает безопасный запуск Нафани на реальном Zoom-собрании. Все команды выполняются на сервере из папки:

```bash
cd /home/masha/nafanya-zoom-sender
```

Секреты, Zoom-ссылку, `.env`, cookies и browser profile нельзя печатать в отчётах, логах, скриншотах или отправлять в GitHub.

## Как пользоваться служащему

1. Открыть ярлык `Nafanya Zoom Panel`.
2. Нажать **«Включить Нафаню»**.
3. Дождаться зелёного статуса **«В Zoom, чат открыт»**.
4. Выбрать сообщение собрания либо номер отрывка и нажать **«Отправить в Zoom»**.
5. В конце нажать **«Выключить Нафаню»**.

Если панель показывает **«Нужен вход в Zoom»**, не открывать очередь и позвать Машу или администратора. Служащему не нужно заходить на сервер, редактировать `.env` или запускать Docker.

### Статусы и управление очередью

- **«Выключен»** — Нафаня не запущен; нажмите **«Включить Нафаню»** в компактном блоке внизу пульта.
- **«В зале ожидания»** — Нафаня жив и ждёт допуска. Повторно включать его не нужно; ожидание не ограничено 90 секундами.
- **«В Zoom, чат открыт»** — можно отправлять тексты и вести свободную очередь в пульте.
- **«Нужен вход Zoom»** — позовите Машу или администратора и используйте **«Починить вход Zoom»**.
- **«Ошибка»** — нажмите **«Обновить»**. Если ошибка осталась, не открывайте очередь и позовите администратора.
- **Outbox** обычно возвращается к `0` после отправки. Если число не уменьшается дольше минуты, не нажимайте другие кнопки подряд.

В блоке очереди:

- **«Высказался»** отмечает запись галочкой, но сохраняет её на месте;
- **«Вернуть в очередь»** снимает галочку;
- **«Пропускает»** опускает ожидающую запись на одну строку;
- **«Удалить»** удаляет только выбранную запись;
- повторное добавление одинакового текста разрешено.

Литература и вопросы игры показаны внутри раскрывашек по дням недели. Они публикуются отдельно и не меняют состояние очереди.

## 1. Safe-mode по умолчанию

Когда sender не используется, в `.env` должны стоять:

```bash
ZOOM_SENDER_DRY_RUN=true
ZOOM_SENDER_MOCK_OUTBOX=true
ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS=false
ZOOM_AUTH_SETUP=false
```

Файл `.env` хранится только на сервере. Значения переменных не показывать командой `cat .env` и не копировать в чат.

## 2. Pre-flight перед собранием

### 2.1. Проверить контейнеры

```bash
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Нужно убедиться:

- `nafanya-zoom-sender-v2` не запущен второй копией.

Старый `zoom-bridge` удалён из репозитория и с сервера. Боевой Zoom обслуживает только `zoom-sender-v2`.

### 2.2. Проверить Chromium и browser profile

```bash
pgrep -a -f 'chromium|chrome|playwright' || true
docker run --rm \
  -v nafanya-zoom-sender_zoom-sender-profile:/profile:ro \
  alpine sh -c 'find /profile -maxdepth 1 -name "Singleton*" -print'
```

Если sender остановлен, Chromium-процессов быть не должно. Lock-файлы удалять можно только после проверки, что ни sender, ни Chromium не работают:

```bash
docker run --rm \
  -v nafanya-zoom-sender_zoom-sender-profile:/profile \
  alpine sh -c 'rm -f /profile/SingletonLock /profile/SingletonSocket /profile/SingletonCookie'
```

Профиль должен существовать, быть доступен на запись и содержать ранее сохранённую Zoom-сессию. Сам profile, cookies и storage state никуда не копировать.

### 2.3. Проверить Worker

Через защищённый `/zoom-only/status` или живую Zoom-only panel проверить:

- `outboxSize=0` перед новым собранием;
- в пульте нет старых тестовых записей в текущей очереди и списке спикерской.

Если состояние неожиданное, не продолжать вслепую. Лишние записи удалять штатными кнопками пульта либо общей кнопкой очистки. Storage руками не редактировать.

## 3. Подготовить боевой режим

Перед реальным собранием сделать резервную копию `.env`:

```bash
cp .env ".env.backup-before-meeting-$(date +%Y%m%d-%H%M%S)"
```

Для боевой работы:

```bash
ZOOM_SENDER_DRY_RUN=false
ZOOM_SENDER_MOCK_OUTBOX=false
ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS=false
ZOOM_AUTH_SETUP=false
```

Read-only diagnostics включать лишь для диагностики: они создают локальные файлы и для обычного собрания не нужны. Sender не читает из чата заявки очереди.

## 4. Запустить sender

```bash
docker compose -f compose.example.yml up -d
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Посмотреть последние безопасные строки логов:

```bash
docker compose -f compose.example.yml logs --tail=100 zoom-sender
```

В логах не должно быть секретов или полной Zoom-ссылки. Пока Нафаня допущен в конференцию, outbox проверяется каждые 1500 мс. В зале ожидания outbox не опрашивается. После выключения sender и панель очереди не делают запросов к Worker; только открытый Zoom App синхронизирует независимый общий таймер.

## 5. Проверить health

```bash
curl http://127.0.0.1:3097/health
```

Перед открытием очереди обязательно получить:

- `status=healthy`;
- `zoomJoined=true`;
- `chatOpen=true`;
- `lastError=null`.

Если `chatOpen=false`, не отправлять тексты и не менять очередь. Сначала восстановить вход или чат.

## 6. Восстановить Zoom-авторизацию

Если human panel показывает **«Нужен вход в Zoom»**, служащий не открывает очередь и зовёт Машу или администратора.

Маша/администратор:

1. Нажимает **«Починить вход Zoom»**.
2. Ждёт ссылку **«Открыть окно Zoom для входа»**.
3. Открывает окно и вручную проходит captcha, email confirmation, 2FA или security prompt.
4. Не отправляет пароль, коды и cookies в чат и не сохраняет их в скриншотах.
5. Ждёт статус **«Вход сохранён. Включите Нафаню»**.
6. Нажимает **«Включить Нафаню»** и ждёт **«В Zoom, чат открыт»**.

Если auth/setup завис, нажать **«Остановить восстановление входа»**. Control agent закроет auth-view, вернёт `.env` в safe-mode и оставит sender выключенным.

## 7. Вести свободную очередь

Очередь ведётся только в нужной раскрывашке дня в Zoom App. Техвед пишет любую однострочную запись и нажимает **«Обновить очередь»**. После любого изменения Worker атомарно сохраняет новую версию и кладёт полный актуальный текст в outbox.

Проверять:

- запись появилась в пульте один раз;
- после отправки `outboxSize` вернулся к `0`;
- при одновременной работе двух техведов пульт показывает свежую версию.

Токен панели не вставлять в runbook, команды, отчёты или скриншоты.

## 8. Штатная работа очереди

Очередь ведётся только через свободное поле в приложении Нафани. Sender не читает Zoom-чат, не разбирает `111/222/333/444` и не вызывает старые webhook/ingest-маршруты.

## 9. Смотреть состояние во время собрания

Проверять два независимых состояния.

Sender:

```bash
curl http://127.0.0.1:3097/health
docker compose -f compose.example.yml logs --tail=100 zoom-sender
```

Worker через защищённый `/zoom-only/status` или panel:

- `meetingBoard.version` и `meetingBoard.entries`;
- `speakerQuestions.version` и `speakerQuestions.entries`;
- `outboxSize`.

Нормальное состояние: sender healthy, чат открыт, outbox после отправки возвращается к нулю, а версия и списки меняются только после действий в пульте.

## 10. Закрыть собрание

1. Дождаться, пока `outboxSize` вернётся к `0`.
2. Выключить Нафаню кнопкой пульта. При ручном администрировании остановить sender:

```bash
docker compose -f compose.example.yml stop zoom-sender
```

3. Вернуть `.env` в safe-mode:

```bash
ZOOM_SENDER_DRY_RUN=true
ZOOM_SENDER_MOCK_OUTBOX=true
ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS=false
ZOOM_AUTH_SETUP=false
```

4. Проверить, что sender остановлен.

Красная кнопка **«Очистить всё: очереди, доп. темы и спикерскую»** после подтверждения очищает всё сохранённое состояние Zoom-очереди и публикует пустое актуальное состояние. Книжную базу она не затрагивает.

## 11. Аварийные ситуации

### Zoom открыл Sign In

Не открывать очередь. Остановить обычный sender и пройти auth/setup по разделу 6.

### `chatOpen=false`

Не нажимать кнопки отправки. Проверить waiting room, авторизацию, открытие чата и `lastError`.

### Outbox не пустой

Не перезапускать sender вслепую: старое сообщение может уйти после рестарта. Проверить health, логи отправки и ack. Ручного reset нет: каждое сообщение должно быть либо отправлено и подтверждено, либо разобрано администратором.

### Неожиданный список очереди

Не продолжать тест или собрание вслепую. Обновить пульт, сверить `meetingBoard.version` и удалить конкретную лишнюю запись либо осознанно использовать общую очистку.

### Подозрение на self-ingest или дубли

Закрыть очередь, остановить sender и сохранить только обезличенный диагностический фрагмент. Не править Worker на живом собрании.

### Падает Worker regression на Google Sheets

Пустой ответ живого расписания Google Sheets нужно проверять отдельно. Он не доказывает сбой Zoom Sender, message-ID dedup или chat ingest.

## 12. Git hygiene

Перед commit проверить `git status`. Никогда не добавлять:

- `.env` и его backup;
- diagnostics;
- screenshots;
- logs;
- browser profile, cookies и storage state;
- `node_modules`;
- временные файлы и реальные секреты.

В Git можно добавлять только намеренно изменённые RUNBOOK/README, код и тесты.

## 13. Установить человеческий control agent

Control agent работает отдельно от sender-а. Он слушает только `127.0.0.1:3098`, выполняет только whitelist-действия start/stop/status/auth-setup и не предоставляет произвольный shell.

В серверный `.env` администратор должен безопасно добавить:

```bash
ZOOM_CONTROL_TOKEN=
ZOOM_PANEL_TOKEN=
ZOOM_APP_CLIENT_SECRET=
ZOOM_APP_SESSION_SECRET=
ZOOM_CONTROL_HOST=127.0.0.1
ZOOM_CONTROL_PORT=3098
```

Реальные значения в runbook, чат и Git не вставлять. Для control agent нужен отдельный сильный случайный токен. `ZOOM_PANEL_TOKEN` должен совпадать с защищённым токеном существующей Worker-панели.

`ZOOM_APP_CLIENT_SECRET` берётся из черновика приложения в Zoom Marketplace и используется только для расшифровки `X-Zoom-App-Context`. `ZOOM_APP_SESSION_SECRET` — отдельная случайная строка для короткой HttpOnly-cookie. Home URL приложения: `https://pochtinormalnye.ru/nafanya-zoom-control/zoom-app`. В Domain Allow List добавить `https://pochtinormalnye.ru`.

Запускать control agent отдельным Compose-проектом:

```bash
docker compose \
  -p nafanya-zoom-control \
  -f control-agent.compose.example.yml \
  up -d
```

Локальная проверка:

```bash
curl http://127.0.0.1:3098/health
docker compose \
  -p nafanya-zoom-control \
  -f control-agent.compose.example.yml \
  logs --tail=100 zoom-control
```

Health control agent подтверждает только работу пульта. Готовность самого Нафани по-прежнему определяется статусом **«В Zoom, чат открыт»**.

### HTTPS через Caddy

В существующий блок `pochtinormalnye.ru` администратор с root-доступом добавляет маршруты **перед** `file_server`. Auth-view должен стоять выше общего control route:

```caddyfile
handle_path /nafanya-zoom-control/vnc/* {
	forward_auth 127.0.0.1:3098 {
		uri /auth/check
	}
	reverse_proxy 127.0.0.1:6080
}

handle_path /nafanya-zoom-control/* {
	reverse_proxy 127.0.0.1:3098
}
```

После проверки конфигурации:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Control agent не открывает порты `3098`, `6080` или VNC наружу: снаружи доступен только HTTPS-префикс Caddy. Caddy проверяет ту же `HttpOnly; Secure; SameSite=Strict` cookie через `/auth/check` перед каждым noVNC HTTP/WebSocket-запросом. Токен в URL auth-view не добавляется.

### Что делает control agent

- `start` проверяет старый bridge, browser locks, включает боевой режим и запускает только sender;
- `status` показывает: выключен, запускается, в зале ожидания, готов, нужен вход или ошибка;
- `stop` отказывается выключать sender при открытой очереди;
- `auth-setup` запускает временный headed Chromium + noVNC, показывает защищённое окно и закрывает его после успеха, ошибки или ручной остановки;
- Worker-панель проксируется с серверным panel-token, поэтому токен не попадает в браузерный JavaScript.

Control agent монтирует Docker socket и поэтому является административным компонентом. Его endpoint нельзя публиковать без HTTPS, отдельного токена и Caddy-защиты.
