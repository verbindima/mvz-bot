# 🚀 Быстрый деплой MVZ Bot

## Один скрипт - всё готово

```bash
# Сделать скрипт исполняемым
chmod +x deploy.sh

# Запустить деплой (замените на свои данные)
./deploy.sh 192.168.1.100 root
```

## После деплоя

1. **Настройте токены:**
   ```bash
   ssh root@192.168.1.100
   nano /opt/mvz-bot/.env
   ```

2. **Добавьте токены:**
   ```
   BOT_TOKEN=ваш_telegram_bot_token
   GEMINI_API_KEY=ваш_google_genai_key
   ```

3. **Перезапустите:**
   ```bash
   pm2 restart mvz-bot
   ```

4. **Проверьте:**
   ```bash
   pm2 logs mvz-bot
   ```

## Готово! 🎉

Бот работает 24/7 на сервере с автозапуском.

**Управление:**
- `pm2 list` - статус
- `pm2 logs mvz-bot` - логи  
- `pm2 restart mvz-bot` - перезапуск