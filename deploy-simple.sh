#!/bin/bash

# Simple deploy script for MVZ Telegram Bot (builds on server)
# Usage: ./deploy-simple.sh [server_ip] [server_user]

SERVER_IP=${1:-"your_server_ip"}
SERVER_USER=${2:-"root"}
PROJECT_NAME="mvz-bot"
REMOTE_PATH="/opt/$PROJECT_NAME"

echo "🚀 Deploying MVZ Telegram Bot to $SERVER_USER@$SERVER_IP (server-side build)"

# Create tarball excluding unnecessary files (no local build)
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
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    apt-get install -y nodejs
  fi

  # Install PM2 if not present
  if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
  fi

  # Create project directory
  mkdir -p /opt/mvz-bot
  cd /opt/mvz-bot

  # Stop existing process
  pm2 stop mvz-bot 2>/dev/null || true

  # Extract and setup
  echo "Extracting files..."
  tar -xzf /tmp/mvz-bot.tar.gz
  rm /tmp/mvz-bot.tar.gz

  # Install dependencies (including dev dependencies for build)
  echo "Installing dependencies..."
  npm install

  # Ensure TypeScript is available
  if ! npx tsc --version &> /dev/null; then
    echo "Installing TypeScript..."
    npm install -g typescript
  fi

  # Build project on server
  echo "Building project..."
  npm run build

  # Setup environment file if it doesn't exist
  if [ ! -f .env ]; then
    echo "Creating .env file..."
    echo "BOT_TOKEN=your_bot_token_here" > .env
    echo "GEMINI_API_KEY=your_gemini_key_here" >> .env
    echo "NODE_ENV=production" >> .env
    echo "DATABASE_URL=file:./data/database.db" >> .env
    echo ""
    echo "⚠️  Please edit /opt/mvz-bot/.env with your actual tokens!"
  fi

  # Create data directory and logs directory
  mkdir -p data logs

  # Run database migrations
  echo "Setting up database..."
  npx prisma db push

  # Start with PM2
  echo "Starting bot..."
  pm2 start ecosystem.config.js
  pm2 save
  pm2 startup

  echo "✅ Bot deployed successfully!"
  echo ""
  pm2 list

EOF

echo "✅ Deployment completed!"
echo ""
echo "📝 Next steps:"
echo "1. SSH to your server: ssh $SERVER_USER@$SERVER_IP"
echo "2. Edit environment file: nano /opt/mvz-bot/.env"
echo "3. Restart the bot: pm2 restart mvz-bot"
echo "4. Check logs: pm2 logs mvz-bot"

# Cleanup
rm mvz-bot.tar.gz