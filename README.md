# iptvik.ru

Личная страница: `site/index.html`, достижения – `site/achievements/index.html`.

Сервер: клон в `/opt/iptvik`, `docker compose up -d` (Caddy раздает `site/` в сети `edge`
под алиасом `iptvik-site`), домен и TLS – в [vps-edge](https://github.com/viteax/vps-edge).

Обновить: `cd /opt/iptvik && git pull --ff-only` – перезапуск не нужен.
