#!/usr/bin/env bash
# Установка/обновление «Поколения» на сервере (Ubuntu 22.04/24.04). Запускать от root из /opt/pokolenie.
# Безопасно запускать повторно. Настройки — в /etc/pokolenie/env (BOT_TOKEN, DOMAIN, ADMIN_TG_IDS).
# Проект живёт отдельно от других сайтов на сервере: своя папка, своя база, свой порт (3100),
# а Caddy по доменному имени отправляет запросы нужному проекту.
set -euo pipefail
APP=/opt/pokolenie
DATA=/var/lib/pokolenie
CONF=/etc/pokolenie
PORT=3100
export DEBIAN_FRONTEND=noninteractive
cd "$APP"

mkdir -p "$CONF"
touch "$CONF/env"
chmod 600 "$CONF/env"
# shellcheck disable=SC1091
source "$CONF/env"
DOMAIN="${DOMAIN:-}"

# --- Node.js 22 (если уже стоит для другого проекта — используем его) ---
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "→ Устанавливаю Node.js 22"
  if ! { curl -fsSL --max-time 60 https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs; }; then
    NODE_V=v22.22.0
    ARCH=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
    for base in https://nodejs.org/dist https://npmmirror.com/mirrors/node; do
      if curl -fsSL --max-time 300 "$base/$NODE_V/node-$NODE_V-linux-$ARCH.tar.xz" -o /tmp/node.tar.xz; then
        tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm -f /tmp/node.tar.xz
        ln -sf /usr/local/bin/node /usr/bin/node
        break
      fi
    done
  fi
  node -v
fi

# --- Caddy: веб-сервер, сам получает HTTPS-сертификаты для всех доменов ---
if ! command -v caddy >/dev/null; then
  echo "→ Устанавливаю Caddy"
  apt-get update -y
  if ! apt-get install -y caddy; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
fi

# --- На сервере с 1 ГБ памяти добавляем файл подкачки, чтобы два проекта не упёрлись в память ---
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 1600000 ] && [ "$(awk 'NR>1' /proc/swaps | wc -l)" = 0 ]; then
  echo "→ Создаю файл подкачки 1 ГБ"
  (fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024) && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- пользователь и данные (база живёт отдельно от кода) ---
id pokolenie >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$DATA" pokolenie
mkdir -p "$DATA"
chown -R pokolenie:pokolenie "$DATA"

LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ -d node_modules/express ] && [ "$(cat "$CONF/deps-hash" 2>/dev/null)" = "$LOCK_HASH" ]; then
  echo "→ Зависимости не изменились"
else
  echo "→ Устанавливаю зависимости"
  ok=0
  for registry in https://registry.npmjs.org https://registry.npmmirror.com; do
    for attempt in 1 2; do
      if npm ci --omit=dev --no-audit --no-fund --loglevel=error --registry="$registry"; then ok=1; break 2; fi
      sleep 5
    done
  done
  [ "$ok" = 1 ] || { echo "✗ Не удалось скачать зависимости (нет связи с npm). Повторю при следующей проверке."; exit 1; }
  echo "$LOCK_HASH" > "$CONF/deps-hash"
fi

# --- адрес сайта ---
IP=$(curl -4fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')
# Технический адрес работает и без своего домена: pokolenie.1-2-3-4.sslip.io
SSLIP="pokolenie.${IP//./-}.sslip.io"
PUBLIC="${DOMAIN:-$SSLIP}"

# --- службы: приложение и автообновление с GitHub раз в минуту ---
cat > /etc/systemd/system/pokolenie.service <<UNIT
[Unit]
Description=Pokolenie
After=network.target

[Service]
Type=simple
User=pokolenie
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=TZ=Europe/Moscow
Environment=DATA_DIR=$DATA
Environment=PUBLIC_URL=https://$PUBLIC
EnvironmentFile=$CONF/env
ExecStart=/usr/bin/node --no-warnings --max-old-space-size=192 server/index.js
Restart=always
RestartSec=3
MemoryMax=350M

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/pokolenie-update.service <<UNIT
[Unit]
Description=Pokolenie: обновление с GitHub

[Service]
Type=oneshot
ExecStart=/bin/bash $APP/deploy/update.sh
UNIT

cat > /etc/systemd/system/pokolenie-update.timer <<UNIT
[Unit]
Description=Pokolenie: проверка обновлений каждую минуту

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable pokolenie pokolenie-update.timer >/dev/null 2>&1
systemctl restart pokolenie
systemctl start pokolenie-update.timer

# --- HTTPS: свой файл сайта, не трогая сайты других проектов ---
SITES="$SSLIP"
[ -n "$DOMAIN" ] && SITES="$DOMAIN, $SSLIP"
mkdir -p /etc/caddy/sites
cat > /etc/caddy/sites/pokolenie.caddy <<CADDY
# «Поколение» (создано deploy/install.sh — правки здесь перезапишутся)
$SITES {
	encode zstd gzip
	reverse_proxy localhost:$PORT
}
CADDY
bash "$APP/deploy/caddy-import.sh"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# --- проверка ---
code=000
for _ in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' localhost:$PORT/api/config || true)
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" != "200" ]; then
  echo "✗ Сервис не запустился. Последние строки лога:"
  journalctl -u pokolenie -n 40 --no-pager
  exit 1
fi
git -C "$APP" rev-parse HEAD > "$CONF/installed-commit"
[ -z "${BOT_TOKEN:-}" ] && echo "⚠ BOT_TOKEN не задан — бот выключен. Добавьте его в $CONF/env (см. README)."
[ -n "$DOMAIN" ] && echo "  Запасной адрес: https://$SSLIP"
echo "✓ «Поколение» работает: https://$PUBLIC  (версия $(git -C "$APP" log -1 --format='%h %s'))"
