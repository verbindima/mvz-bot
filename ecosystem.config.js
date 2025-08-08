module.exports = {
  apps: [
    {
      name: 'mvz-bot',
      script: 'yarn start',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'file:./data/database.db',
        SCHEME: 'self'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'data'],
      restart_delay: 4000,
    },
  ],
};