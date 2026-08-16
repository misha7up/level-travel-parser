# Деплой на Ubuntu (без Browserless)

Локальный Chromium на сервере — рейсы и кэшбек парсятся нормально, без лимитов Browserless.

Репозиторий: https://github.com/misha7up/level-travel-parser  
Корень приложения на сервере = эта папка (`rixos-web`).

## 1. Сервер

Нужны: Ubuntu 22.04/24.04, доступ по SSH, открытый порт **80** (и/или **443**).

```bash
sudo apt update
sudo apt install -y git curl nginx

# Node 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Chromium для Puppeteer (без Browserless)
sudo apt install -y chromium-browser
# если пакета нет (Ubuntu 24 snap-only) — так:
# sudo snap install chromium
# или: sudo apt install -y chromium

which chromium-browser || which chromium || which google-chrome-stable
```

Запомни путь из `which` — при необходимости положи в env как `CHROME_PATH`.

## 2. Клон и сборка

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
cd /var/www
git clone https://github.com/misha7up/level-travel-parser.git
cd level-travel-parser

npm install
npm run build
```

Проверка enrich локально на сервере:

```bash
# в одном терминале
npm run start
# в другом
curl -s "http://127.0.0.1:3000/api/enrich?packageId=404273168" | head -c 400
```

Если `no_chrome` — задай путь:

```bash
export CHROME_PATH=/usr/bin/chromium-browser   # или /snap/bin/chromium
```

## 3. systemd (автозапуск)

```bash
sudo tee /etc/systemd/system/rixos-web.service >/dev/null <<'EOF'
[Unit]
Description=Rixos Level.Travel search (Next.js)
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/level-travel-parser
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
# раскомментируй, если which chromium не в стандартных путях:
# Environment=CHROME_PATH=/usr/bin/chromium-browser
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# права на каталог для www-data
sudo chown -R www-data:www-data /var/www/level-travel-parser

sudo systemctl daemon-reload
sudo systemctl enable --now rixos-web
sudo systemctl status rixos-web --no-pager
```

Логи: `sudo journalctl -u rixos-web -f`

## 4. Nginx — открыть в браузере

Подставь свой IP или домен вместо `YOUR_HOST`:

```bash
sudo tee /etc/nginx/sites-available/rixos-web >/dev/null <<'EOF'
server {
    listen 80;
    server_name YOUR_HOST;

    client_max_body_size 4m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # enrich может идти до ~60с
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/rixos-web /etc/nginx/sites-enabled/rixos-web
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Открывай: `http://YOUR_HOST/` → даты → **Обновить**.

HTTPS (по желанию):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain.com
```

## 5. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Важно

- **Browserless не нужен** на Ubuntu — используется системный Chromium.
- Не ставь `BROWSERLESS_TOKEN` в env сервиса (иначе снова уйдёт в облако).
- Vercel можно оставить как зеркало; рабочий поиск с рейсами — на этом сервере.
- Воронка: пакеты по всем дням → enrich ~18 пакетов (12 дешёвых дней + 6 доп.). Chromium один на процесс, картинки/CSS режутся.

## VPS 1 GB / 1 CPU (выжать максимум)

```bash
# swap 2G — иначе Chromium убьёт OOM
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# в unit: NODE_OPTIONS + CHROME_PATH (см. deploy/rixos-web.service)
sudo cp /var/www/level-travel-parser/deploy/rixos-web.service /etc/systemd/system/rixos-web.service
sudo systemctl daemon-reload && sudo systemctl restart rixos-web
```

Не поднимай 2+ Chromium параллельно (в коде уже очередь на enrich).

## Обновление кода

```bash
cd /var/www/level-travel-parser
sudo systemctl stop rixos-web
sudo -u www-data git pull
sudo -u www-data npm install
sudo -u www-data npm run build
sudo systemctl start rixos-web
sudo systemctl status rixos-web --no-pager
```
