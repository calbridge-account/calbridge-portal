const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { getIngestionStatus } = require('../jobs/ingestionRunner');
const { getTopPerformers, getAsinTrend } = require('../jobs/contributionMargin');
const { syncClient } = require('../jobs/scheduler');
const { getConnectionStatus } = require('../services/amazonAuthService');

// GET /dashboard
// Summary: connection status + ingestion health
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [connections, ingestion] = await Promise.all([
      getConnectionStatus(req.session.clientId),
      getIngestionStatus(req.session.clientId)
    ]);
    res.json({ connections, ingestion });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/performance
// Top/bottom performers by contribution margin
router.get('/performance', requireAuth, async (req, res, next) => {
  try {
    const { days = 30, limit = 10 } = req.query;
    const [topPerformers, bottomPerformers] = await Promise.all([
      getTopPerformers(req.session.clientId, { days: Number(days), limit: Number(limit), order: 'DESC' }),
      getTopPerformers(req.session.clientId, { days: Number(days), limit: Number(limit), order: 'ASC' })
    ]);
    res.json({ topPerformers, bottomPerformers, days: Number(days) });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/asin/:asin
// Contribution margin trend for a specific ASIN
router.get('/asin/:asin', requireAuth, async (req, res, next) => {
  try {
    const { days = 90 } = req.query;
    const trend = await getAsinTrend(req.session.clientId, req.params.asin, Number(days));
    res.json({ asin: req.params.asin, days: Number(days), trend });
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/sync
// Manually trigger a sync for the logged-in client
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const connections = await getConnectionStatus(req.session.clientId);
    // Fire sync in background — don't await
    syncClient(req.session.clientId, connections).catch(err =>
      console.error(`[Manual sync] Client ${req.session.clientId}:`, err.message)
    );
    res.json({ message: 'Sync started', clientId: req.session.clientId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
