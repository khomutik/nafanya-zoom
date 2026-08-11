# Sender runbook

## Назначение

Sender читает только `/zoom-only/outbox`, отправляет сообщения в Zoom и подтверждает доставленные ID. Он не читает входящий Zoom-чат, не использует Telegram и не вызывает старые webhook/ingest-маршруты.

Старый `zoom-bridge` удалён. Не запускайте его контейнеры, volume или маршруты параллельно с текущим sender: два шофёра у одного outbox быстро превращаются в цирк с дублями.

## Обычный запуск

```bash
docker compose -p nafanya-zoom-sender -f compose.example.yml build
docker compose -p nafanya-zoom-sender -f compose.example.yml up -d zoom-sender
docker compose -p nafanya-zoom-sender -f compose.example.yml ps
curl -fsS http://127.0.0.1:3097/health
```

## Остановка

```bash
docker compose -p nafanya-zoom-sender -f compose.example.yml down
```

## Безопасный dry-run

Установите в `.env`:

```dotenv
ZOOM_SENDER_DRY_RUN=true
ZOOM_SENDER_MOCK_OUTBOX=true
```

Затем выполните:

```bash
npm run dry-run
```

## Ручная авторизация

Авторизация создаёт временный контейнер с noVNC. Открывайте его через защищённый control-agent, завершайте проверку Zoom и сразу закрывайте. Не копируйте profile volume другой группе.

## Диагностика

- `workerAvailable=false` — проверьте Worker URL и `ZOOM_ONLY_SECRET`;
- `zoomJoined=false` — проверьте ссылку конференции и сохранённый Zoom-профиль;
- `chatOpen=false` — в конференции запрещён чат или Zoom изменил Web Client;
- повторная авторизация — завершите активные Zoom-сессии, пересоздайте профиль и войдите заново.
