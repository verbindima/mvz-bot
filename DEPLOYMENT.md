# Deployment Guide

## GitHub CI/CD Pipeline

### Setup GitHub Secrets

В настройках репозитория (Settings > Secrets and variables > Actions) добавьте:

```
SERVER_HOST=your.server.ip
SERVER_USER=root
SERVER_SSH_KEY=-----BEGIN PRIVATE KEY-----
...your private key...
-----END PRIVATE KEY-----
SERVER_PORT=22
GITHUB_TOKEN=ghp_... (обычно автоматически доступен)
```

### Workflow Files

- `.github/workflows/deploy.yml` - Деплой в продакшн при пуше в `main`
- `.github/workflows/test.yml` - Тесты для PR и feature веток

### Server Setup (Первый раз)

```bash
# 1. Установить Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs

# 2. Установить Yarn
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
apt update && apt install yarn

# 3. Установить PM2
npm install -g pm2

# 4. Установить PostgreSQL
apt update
apt install postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

# 5. Создать базу данных и пользователя
sudo -u postgres psql
CREATE DATABASE mvz_bot;
CREATE USER mvz_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE mvz_bot TO mvz_user;
\q

# 6. Создать директории
mkdir -p /opt/mvz-bot/logs
mkdir -p /opt/mvz-bot-backups
```

### Environment Configuration

После первого деплоя настройте `.env` на сервере:

```bash
nano /opt/mvz-bot/.env
```

```env
# Telegram Bot Token
BOT_TOKEN=your_bot_token_here

# Google GenAI API Key  
GEMINI_API_KEY=your_gemini_key_here

# Environment
NODE_ENV=production

# PostgreSQL Database
DATABASE_URL=postgresql://mvz_user:your_secure_password@localhost:5432/mvz_bot

# Admin Telegram IDs
ADMINS=123456789,987654321
```

### Deployment Process

1. **Push to main branch** - автоматически запускает деплой
2. **Manual deployment** - через GitHub Actions UI

### Monitoring

```bash
# Проверить статус
pm2 status

# Посмотреть логи
pm2 logs mvz-bot

# Перезапустить
pm2 restart mvz-bot

# Посмотреть метрики
pm2 monit
```

### Rollback

```bash
# Посмотреть бекапы
ls -la /opt/mvz-bot-backups/

# Откатиться к предыдущей версии
pm2 stop mvz-bot
rm -rf /opt/mvz-bot
cp -r /opt/mvz-bot-backups/mvz-bot-TIMESTAMP /opt/mvz-bot
cd /opt/mvz-bot
pm2 start ecosystem.config.js --env production
```

### Pipeline Features

- ✅ Автоматические тесты и линтинг
- ✅ Сборка TypeScript
- ✅ Миграции базы данных
- ✅ Автоматические бекапы
- ✅ Zero-downtime deployment
- ✅ Rollback capability
- ✅ Логирование и мониторинг

### Security

- Секреты хранятся в GitHub Secrets
- SSH ключи для безопасного доступа
- База данных с аутентификацией
- Автоматическая очистка старых бекапов