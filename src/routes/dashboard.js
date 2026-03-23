const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');

// GET /dashboard
// Placeholder — will serve client dashboard data from Snowflake
router.get('/', requireAuth, (req, res) => {
  res.json({
    message: 'Dashboard coming soon',
    clientId: req.session.clientId
  });
});

module.exports = router;
