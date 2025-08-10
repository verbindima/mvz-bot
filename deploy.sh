#!/bin/bash

# Deploy script for MVZ Telegram Bot
# Usage: ./deploy.sh [server_ip] [server_user]

SERVER_IP=${1:-"your_server_ip"}
SERVER_USER=${2:-"root"}
PROJECT_NAME="mvz-bot"
REMOTE_PATH="/opt/$PROJECT_NAME"

echo "🚀 Deploying MVZ Telegram Bot to $SERVER_USER@$SERVER_IP"

# Build project locally
echo "📦 Building project..."
if command -v tsc &> /dev/null; then
  yarn build
else
  echo "Using npx tsc..."
  npx tsc
fi

# Create tarball excluding unnecessary files
echo "📦 Creating deployment package..."
tar -czf mvz-bot.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='data/database.db' \
  --exclude='dist' \
  --exclude='.nyc_output' \
  --exclude='coverage' \
  --exclude='.vscode' \
  --exclude='.idea' \
  --exclude='*.tar.gz' \
  .

echo "📤 Uploading to server..."
scp mvz-bot.tar.gz $SERVER_USER@$SERVER_IP:/tmp/

echo "🔧 Setting up on server..."
ssh $SERVER_USER@$SERVER_IP << 'EOF'
  # Install Node.js if not present
  if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    apt-get install -y nodejs
  fi

  # Install Yarn if not present
  if ! command -v yarn &> /dev/null; then
    curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
    echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
    apt update
    apt install -y yarn
  fi

  # Install PM2 if not present
  if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
  fi

  # Create project directory
  mkdir -p /opt/mvz-bot
  cd /opt/mvz-bot

  # Stop existing process
  pm2 stop mvz-bot 2>/dev/null || true

  # Create backup if files exist
  if [ -d "src" ] || [ -d "dist" ]; then
    BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
    echo "📦 Creating backup: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
    cp -r . "$BACKUP_DIR/" 2>/dev/null || true
    echo "✅ Backup created at /opt/mvz-bot/$BACKUP_DIR"
  fi

  # Extract and setup new version
  echo "🔄 Extracting new version..."
  tar -xzf /tmp/mvz-bot.tar.gz
  rm /tmp/mvz-bot.tar.gz

  # Install dependencies
  yarn install --production

  # Setup environment file if it doesn't exist
  if [ ! -f .env ]; then
    echo "BOT_TOKEN=your_bot_token_here" > .env
    echo "GEMINI_API_KEY=your_gemini_key_here" >> .env
    echo "NODE_ENV=production" >> .env
    echo "DATABASE_URL=file:./data/database.db" >> .env
    echo ""
    echo "⚠️  Please edit /opt/mvz-bot/.env with your actual tokens!"
  fi

  # Create data directory
  mkdir -p data

  # Run database migrations
  npx prisma db push

  # Build the project
  yarn build

  # Start with PM2
  pm2 start npm --name "mvz-bot" -- start
  pm2 save
  pm2 startup

EOF

echo "✅ Deployment completed!"
echo ""
echo "📝 Next steps:"
echo "1. SSH to your server: ssh $SERVER_USER@$SERVER_IP"
echo "2. Edit environment file: nano /opt/mvz-bot/.env"
echo "3. Restart the bot: pm2 restart mvz-bot"
echo "4. Check logs: pm2 logs mvz-bot"
echo ""
echo "📊 Useful PM2 commands:"
echo "- pm2 list                 # Show all processes"
echo "- pm2 logs mvz-bot         # Show logs"  
echo "- pm2 restart mvz-bot      # Restart bot"
echo "- pm2 stop mvz-bot         # Stop bot"

# Cleanup
rm mvz-bot.tar.gz