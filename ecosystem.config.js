module.exports = {
  apps: [{
    name: 'calbridge-portal',
    script: 'src/server.js',
    cwd: '/home/azureuser/.openclaw/workspace',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: '/home/azureuser/.pm2/logs/calbridge-portal-error.log',
    out_file: '/home/azureuser/.pm2/logs/calbridge-portal-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    restart_delay: 3000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
