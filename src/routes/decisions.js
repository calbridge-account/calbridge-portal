const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { analyze } = require('../services/decisionEngine');

/**
 * GET /decisions?days=30
 * Run full decision analysis for logged-in client
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const result = await analyze(req.session.clientId, days);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
