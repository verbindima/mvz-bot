# 🚀 Инструкция по развертыванию MVZ Bot

## Быстрый деплой

### 1. Автоматический деплой (рекомендуется)

```bash
# Сделать скрипт исполняемым (только первый раз)
chmod +x deploy.sh

# Запустить деплой
./deploy.sh your_server_ip your_username
# Например: ./deploy.sh 192.168.1.100 root
```

### 2. Настройка после деплоя

1. **Подключитесь к серверу:**
   ```bash
   ssh your_username@your_server_ip
   ```

2. **Отредактируйте конфигурацию:**
   ```bash
   nano /opt/mvz-bot/.env
   ```

3. **Добавьте ваши токены:**
   ```env
   BOT_TOKEN=1234567890:your_telegram_bot_token_here
   GEMINI_API_KEY=your_google_gemini_api_key_here
   NODE_ENV=production
   DATABASE_URL=file:./data/database.db
   ```

4. **Перезапустите бота:**
   ```bash
   cd /opt/mvz-bot
   pm2 restart mvz-bot
   ```

## Ручной деплой

### 1. Подготовка архива

```bash
# Собрать проект
yarn build

# Создать архив (исключая ненужные файлы)
tar -czf mvz-bot.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='data/database.db' \
  --exclude='dist' \
  .
```

### 2. Загрузка на сервер

```bash
# Скопировать архив на сервер
scp mvz-bot.tar.gz user@server:/opt/

# Подключиться к серверу
ssh user@server
```

### 3. Установка на сервере

```bash
# Перейти в директорию
cd /opt/
mkdir -p mvz-bot
cd mvz-bot

# Распаковать архив
tar -xzf ../mvz-bot.tar.gz

# Установить зависимости
npm install --production

# Настроить базу данных
mkdir -p data
npx prisma db push

# Создать конфигурацию
cat > .env << EOF
BOT_TOKEN=your_bot_token_here
GEMINI_API_KEY=your_gemini_key_here
NODE_ENV=production
DATABASE_URL=file:./data/database.db
EOF
```

### 4. Установка PM2 и запуск

```bash
# Установить PM2 глобально
npm install -g pm2

# Запустить бота
pm2 start ecosystem.config.js

# Сохранить конфигурацию PM2
pm2 save

# Настроить автозапуск
pm2 startup
```

## Управление ботом

### PM2 команды

```bash
# Показать статус всех процессов
pm2 list

# Показать логи
pm2 logs mvz-bot

# Перезапустить бота
pm2 restart mvz-bot

# Остановить бота  
pm2 stop mvz-bot

# Удалить процесс
pm2 delete mvz-bot

# Показать подробную информацию
pm2 show mvz-bot
```

### Логи

Логи находятся в директории `./logs/`:
- `err.log` - ошибки
- `out.log` - стандартный вывод
- `combined.log` - объединенные логи

```bash
# Просмотр логов в реальном времени
tail -f /opt/mvz-bot/logs/combined.log
```

## Обновление бота

### Автоматическое обновление

```bash
# Запустить деплой-скрипт снова
./deploy.sh your_server_ip your_username
```

### Ручное обновление

```bash
# На сервере
cd /opt/mvz-bot

# Остановить бота
pm2 stop mvz-bot

# Скачать новую версию (замените на ваш способ)
wget https://your-source/mvz-bot.tar.gz

# Распаковать
tar -xzf mvz-bot.tar.gz

# Обновить зависимости
npm install --production

# Обновить базу данных если нужно
npx prisma db push

# Запустить бота
pm2 start mvz-bot
```

## Мониторинг

### Проверка работоспособности

```bash
# Статус процесса
pm2 list

# Использование ресурсов
pm2 monit

# Логи ошибок
pm2 logs mvz-bot --err

# Рестарты
pm2 show mvz-bot
```

### Системная информация

```bash
# Использование диска
df -h

# Использование памяти
free -h

# Процессы Node.js
ps aux | grep node
```

## Устранение неполадок

### Бот не запускается

1. **Проверьте конфигурацию:**
   ```bash
   cat /opt/mvz-bot/.env
   ```

2. **Проверьте логи:**
   ```bash
   pm2 logs mvz-bot --lines 50
   ```

3. **Проверьте файлы:**
   ```bash
   ls -la /opt/mvz-bot/
   node -v
   npm -v
   ```

### База данных

```bash
# Проверить файл базы данных
ls -la /opt/mvz-bot/data/

# Пересоздать базу данных
cd /opt/mvz-bot
rm data/database.db
npx prisma db push
```

### Права доступа

```bash
# Исправить права на файлы
chown -R $(whoami):$(whoami) /opt/mvz-bot/
chmod +x /opt/mvz-bot/dist/bot.js
```

## Безопасность

### Рекомендации

1. **Используйте отдельного пользователя:**
   ```bash
   useradd -m -s /bin/bash mvzbot
   su - mvzbot
   ```

2. **Настройте файрвол:**
   ```bash
   ufw allow ssh
   ufw enable
   ```

3. **Регулярные бэкапы:**
   ```bash
   # Бэкап базы данных
   cp /opt/mvz-bot/data/database.db /backup/database.db.$(date +%Y%m%d)
   ```

## Требования к серверу

- **ОС:** Ubuntu 20.04+ / CentOS 7+ / Debian 10+
- **Node.js:** 20.x LTS
- **RAM:** минимум 512MB, рекомендуется 1GB+
- **Диск:** минимум 1GB свободного места
- **Сеть:** доступ к интернету для Telegram API и Google GenAI