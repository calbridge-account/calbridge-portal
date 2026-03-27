const app = require('./app');

// Legacy scheduler — kept for reference, superseded by cron.js
// const { startScheduler } = require('./jobs/scheduler');

// New cron runner — owns all platform job scheduling
const { startCron } = require('./jobs/cron');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Calbridge Portal running on port ${PORT}`);
  if (process.env.ENABLE_SCHEDULER !== 'false') {
    // New cron runner — handles all jobs including report polling
    startCron({ runImmediately: true });

    // Weekly email still registered here until it's folded into cron.js
    registerWeeklyEmailCron();
  }
});

/**
 * Register weekly email cron — every Monday at 8:00 AM Pacific time
 */
function registerWeeklyEmailCron() {
  try {
    const cron = require('node-cron');
    const { sendWeeklyReportsToAll } = require('./jobs/weeklyEmailScheduler');

    // '0 8 * * 1' = 8:00 AM every Monday, America/Los_Angeles timezone
    cron.schedule('0 8 * * 1', async () => {
      console.log('[WeeklyEmail] Sending weekly reports...');
      try {
        await sendWeeklyReportsToAll();
      } catch (err) {
        console.error('[WeeklyEmail] Cron job failed:', err.message);
      }
    }, {
      timezone: 'America/Los_Angeles'
    });

    console.log('[WeeklyEmail] Cron registered — every Monday at 8am Pacific');
  } catch (err) {
    console.error('[WeeklyEmail] Failed to register cron:', err.message);
  }
}
