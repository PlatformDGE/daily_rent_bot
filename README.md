# ApartFlow — Daily Rent

Учёт посуточной аренды в Тбилиси: Telegram-бот и Mini App.

## Как устроено

```
Telegram ──► бот (на VPS)  ──кнопка──►  Mini App (GitHub Pages)
                                              │  HTTPS + подпись Telegram
                                              ▼
                                   API на Hetzner VPS ──► SQLite
```

| Часть | Где | Что |
|---|---|---|
| `index.html` | GitHub Pages: `platformdge.github.io/daily_rent_bot/` | Mini App (весь фронт в одном файле) |
| `server/` | Hetzner VPS | API + Telegram-бот + база SQLite |
| `deploy/` | — | установка на VPS: systemd, Caddy (HTTPS), бэкапы |

### Данные
- База: `/opt/apartflow/data/apartflow.db` (SQLite). Таблицы `apartments`, `bookings`, `expenses`, `cleaning`, `staff`.
- **Ничего не удаляется физически**: удаление ставит `deleted_at`, запись остаётся.
- **Журнал**: каждое изменение (кто, когда, было/стало) пишется в `audit_log`.
- **Бэкап**: ежедневно, 30 последних копий в `/opt/apartflow/backups`.
- Доля платформы фиксирована: **20% платформе / 80% собственнику** (`PLATFORM_PCT`).

### Доступ
Открыть приложение можно только из Telegram и только пользователям из `ALLOWED_TG_IDS`.
Сервер проверяет подпись Telegram (`initData`). Свой ID можно узнать командой `/myid` в боте.

## Сервер (Hetzner 91.99.162.108)

- API: **https://apartflow.91-99-162-108.sslip.io** (Caddy проксирует на `127.0.0.1:3077`).
- Код: `/opt/apartflow/app`, свой Node.js: `/opt/apartflow/node`, база: `/opt/apartflow/data`.
- Настройки: `/etc/apartflow.env` (токен бота, `ALLOWED_TG_IDS`). Токен меняется командой `/opt/apartflow/set-token.sh`.
- Сервисы: `systemctl status apartflow`, журнал `journalctl -u apartflow -f`, бэкап — таймер `apartflow-backup.timer`.
- Установка не трогает остальное на сервере (Homes in Georgia в Docker): см. `deploy/setup.sh`.
- Новый пользователь: пусть напишет боту `/start`, его ID появится в журнале (`[tg] from id=...`), добавить в `ALLOWED_TG_IDS` и `systemctl restart apartflow`.

## Перенос с Google Sheets (выполнен 2026-11-11)

- `scripts/import-sheets.js "<URL Apps Script>"` переносит все листы и сверяет каждую запись; повторный запуск безопасен.
- При первом открытии новой версии телефон сам отправляет на сервер то, что старая версия хранила только
  в памяти (валюта, налог, Booking fee, коммуналка, статус и счёт квартиры). Значения на сервере не перезаписываются,
  сырой снимок сохраняется в `raw_imports`.
- Google-таблица остаётся как архив.

## Разработка

```bash
cd server && npm install && npm test
# локально без Telegram:
DEV_NO_AUTH=1 BOT_ENABLED=0 PORT=3077 node src/index.js
# фронт:  python3 -m http.server 8077  →  http://127.0.0.1:8077/?api=http://127.0.0.1:3077
```
