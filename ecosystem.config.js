module.exports = {
  apps: [
    {
      name: 'calbridge-portal',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
    },
    {
      name: 'calbridge-worker',
      script: 'src/worker.js',
      instances: 1,
      exec_mode: 'fork',  // fork not cluster — workers don't need load balancing
      env: { NODE_ENV: 'production' },
      max_memory_restart: '768M',  // workers use more memory for ingestion
    }
  ]
};
