#!/usr/bin/env bash
# Запускается таймером раз в минуту: если в GitHub (ветка main) есть новый код — обновляет сервер.
set -euo pipefail
cd /opt/pokolenie
MARK=/etc/pokolenie/installed-commit
# сайты других проектов могли перезаписать Caddyfile — возвращаем подключение нашего сайта
bash deploy/caddy-import.sh --reload || true
git fetch -q origin main || echo "GitHub недоступен — проверю установленную версию"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Обновляю до: $(git log -1 --format='%h %s' origin/main)"
  git reset -q --hard origin/main
elif [ "$(cat "$MARK" 2>/dev/null)" = "$(git rev-parse HEAD)" ] && systemctl is-active -q pokolenie; then
  exit 0
else
  echo "Прошлая установка не завершилась или сервис не работает — повторяю"
fi
exec bash deploy/install.sh
