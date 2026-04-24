module.exports = {
  apps: [
    {
      name: 'calbridge-portal',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      // Restart if process stops responding (no heartbeat for 30s)
      exp_backoff_restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'calbridge-worker',
      script: 'src/worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '768M',
      exp_backoff_restart_delay: 5000,  // wait longer between worker restarts
      max_restarts: 10,
      min_uptime: '10s',
    }
  ]
};
