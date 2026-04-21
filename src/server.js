const app = require('./app');

// Web server process — Express only.
// Cron scheduling and BullMQ workers have been moved to src/worker.js
// and run as a separate pm2 process (calbridge-worker).

const PORT = process.env.PORT || 3000;

async function start() {
  // Init session store (Redis with Snowflake fallback) before accepting requests
  await app.init();

  app.listen(PORT, () => {
    console.log(`Calbridge Portal running on port ${PORT}`);

    // Pre-warm the Snowflake connection pool
    setTimeout(() => {
      const { query } = require('./services/snowflakeService');
      query('SELECT 1 AS ping')
        .then(() => console.log('[Snowflake] Connection pool warmed'))
        .catch(err => console.warn('[Snowflake] Warm-up failed (non-fatal):', err.message));
    }, 2000);
  });
}

start().catch(err => {
  console.error('[Server] Fatal startup error:', err.message);
  process.exit(1);
});
