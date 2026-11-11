#!/usr/bin/env bash
# Записывает токен бота в /etc/apartflow.env. Токен не выводится на экран.
set -euo pipefail
ENV=/etc/apartflow.env
echo
echo "Вставьте токен бота (Cmd+V) и нажмите Enter."
echo "Символы не будут видны — это нормально."
read -rsp "Токен: " TOKEN
echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
if ! [[ "$TOKEN" =~ ^[0-9]{6,}:[A-Za-z0-9_-]{30,}$ ]]; then
  echo "❌ Это не похоже на токен бота (должно быть вида 1234567890:AAH...). Ничего не записано."
  exit 1
fi
RESP="$(curl -s -m 10 "https://api.telegram.org/bot${TOKEN}/getMe" || true)"
if ! printf '%s' "$RESP" | grep -q '"ok":true'; then
  echo "❌ Telegram не принял этот токен. Ничего не записано."
  exit 1
fi
BOTNAME="$(printf '%s' "$RESP" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
cp -p "$ENV" "$ENV.bak"
TMP="$(mktemp)"
awk -v t="$TOKEN" 'BEGIN{done=0} /^BOT_TOKEN=/{print "BOT_TOKEN=" t; done=1; next} {print} END{if(!done) print "BOT_TOKEN=" t}' "$ENV" > "$TMP"
cat "$TMP" > "$ENV"   # cat > сохраняет владельца и права файла
rm -f "$TMP" "$ENV.bak"
unset TOKEN RESP
echo "✅ Токен сохранён. Бот: @${BOTNAME}"
