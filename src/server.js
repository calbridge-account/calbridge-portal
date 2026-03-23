const app = require('./app');
const { startScheduler } = require('./jobs/scheduler');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CalBridge Portal running on port ${PORT}`);
  if (process.env.ENABLE_SCHEDULER !== 'false') {
    startScheduler();
  }
});
