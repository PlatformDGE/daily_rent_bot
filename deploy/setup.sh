#!/usr/bin/env bash
# Установка ApartFlow на сервер, где УЖЕ работают другие проекты.
#
# Скрипт ничего не трогает за пределами своего:
#   - свой Node.js в /opt/apartflow/node (системный Node не меняется);
#   - свой пользователь apartflow, свои файлы в /opt/apartflow;
#   - свои systemd-сервисы apartflow*, порт только на 127.0.0.1;
#   - НЕ ставит/не меняет веб-сервер (nginx/caddy), НЕ трогает firewall, НЕ обновляет пакеты.
# Веб-сервер (HTTPS-адрес для API) подключается отдельным шагом, вручную, после осмотра.
#
# Запуск (от root), код заранее скопирован в /opt/apartflow/app:
#   bash /opt/apartflow/app/deploy/setup.sh
set -euo pipefail

APP_DIR=/opt/apartflow
NODE_VERSION=v22.11.0
PORT="${PORT:-3077}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Запустите от root"
[ -f "$APP_DIR/app/server/package.json" ] || die "Нет кода в $APP_DIR/app (сначала скопируйте проект)"

say "Проверки (ничего не меняется)"
if ss -ltnH "sport = :$PORT" | grep -q .; then
  ss -ltnp "sport = :$PORT" || true
  die "Порт $PORT уже занят другой программой. Запустите с другим: PORT=3088 bash setup.sh"
fi
for u in apartflow.service apartflow-backup.service apartflow-backup.timer; do
  if [ -f "/etc/systemd/system/$u" ] && ! grep -q "ApartFlow" "/etc/systemd/system/$u"; then
    die "/etc/systemd/system/$u существует и не наш — остановка"
  fi
done
arch=$(uname -m)
case "$arch" in x86_64) narch=x64 ;; aarch64) narch=arm64 ;; *) die "Неизвестная архитектура $arch" ;; esac

say "Пользователь apartflow"
id apartflow >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin apartflow
mkdir -p "$APP_DIR/data" "$APP_DIR/backups"

say "Свой Node.js $NODE_VERSION в $APP_DIR/node (системный не трогаем)"
if [ ! -x "$APP_DIR/node/bin/node" ] || [ "$("$APP_DIR/node/bin/node" -v)" != "$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  base="https://nodejs.org/dist/$NODE_VERSION"
  file="node-$NODE_VERSION-linux-$narch.tar.xz"
  curl -fsSLo "$tmp/$file" "$base/$file"
  curl -fsSLo "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -) || die "Контрольная сумма Node не сошлась"
  rm -rf "$APP_DIR/node" && mkdir -p "$APP_DIR/node"
  tar -xJf "$tmp/$file" -C "$APP_DIR/node" --strip-components=1
  rm -rf "$tmp"
fi
NODE="$APP_DIR/node/bin/node"
NPM="$APP_DIR/node/bin/npm"

say "Зависимости"
chown -R apartflow:apartflow "$APP_DIR"
cd "$APP_DIR/app/server"
sudo -u apartflow env PATH="$APP_DIR/node/bin:/usr/bin:/bin" HOME="$APP_DIR" "$NPM" ci --omit=dev --no-audit --no-fund
chmod 700 "$APP_DIR/data" "$APP_DIR/backups"

say "Настройки /etc/apartflow.env"
if [ ! -f /etc/apartflow.env ]; then
  sed -e "s|^PORT=.*|PORT=$PORT|" \
      -e "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$(openssl rand -hex 32)|" \
      "$APP_DIR/app/deploy/apartflow.env.example" > /etc/apartflow.env
  chown root:apartflow /etc/apartflow.env
  chmod 640 /etc/apartflow.env
else
  echo "Уже есть — не трогаю"
fi

say "systemd (только наши сервисы, пока НЕ запускаем)"
for u in apartflow.service apartflow-backup.service apartflow-backup.timer; do
  sed "s|/usr/bin/node|$NODE|g" "$APP_DIR/app/deploy/$u" > "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable apartflow.service apartflow-backup.timer

cat <<EOF

✅ Установлено, но ещё не запущено. Дальше:
  1) nano /etc/apartflow.env      → вписать BOT_TOKEN и ALLOWED_TG_IDS
  2) импорт таблицы:
       cd $APP_DIR/app/server && sudo -u apartflow bash -c 'set -a; . /etc/apartflow.env; $NODE scripts/import-sheets.js "<URL Apps Script>"'
  3) systemctl start apartflow apartflow-backup.timer && journalctl -u apartflow -n 50
  4) curl http://127.0.0.1:$PORT/api/health
  5) HTTPS-адрес для API подключаем отдельно (зависит от того, какой веб-сервер уже стоит).

Удалить всё полностью:
  systemctl disable --now apartflow apartflow-backup.timer
  rm /etc/systemd/system/apartflow*.{service,timer} /etc/apartflow.env && systemctl daemon-reload
  userdel apartflow && rm -rf $APP_DIR
EOF
