const app = require('./app');

// Web server process — Express only.
// Cron scheduling and BullMQ workers have been moved to src/worker.js
// and run as a separate pm2 process (calbridge-worker).

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Calbridge Portal running on port ${PORT}`);

  // Pre-warm the Snowflake connection pool so the first real user request
  // doesn't eat the cold-start penalty (~2-4s warehouse wake-up).
  setTimeout(() => {
    const { query } = require('./services/snowflakeService');
    query('SELECT 1 AS ping')
      .then(() => console.log('[Snowflake] Connection pool warmed'))
      .catch(err => console.warn('[Snowflake] Warm-up failed (non-fatal):', err.message));
  }, 2000);
});
