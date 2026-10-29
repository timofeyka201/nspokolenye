#!/usr/bin/env bash
# Главный /etc/caddy/Caddyfile должен подключать сайты из /etc/caddy/sites/.
# Другой проект на сервере может перезаписать Caddyfile при своём обновлении — тогда возвращаем строку
# подключения и перезагружаем Caddy. Возвращает 0, если всё уже было на месте.
set -euo pipefail
LINE='import /etc/caddy/sites/*.caddy'
F=${CADDYFILE:-/etc/caddy/Caddyfile}
touch "$F"
if grep -qF "$LINE" "$F"; then exit 0; fi
printf '\n%s\n' "$LINE" >> "$F"
echo "→ Подключил /etc/caddy/sites к Caddyfile"
if [ "${1:-}" = "--reload" ]; then systemctl reload caddy 2>/dev/null || systemctl restart caddy; fi
