const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/requireAuth');

// POST /auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    const client = await authService.signup({ email, password, name });
    req.session.clientId = client.id;
    res.status(201).json({ message: 'Account created', client: { id: client.id, email: client.email, name: client.name } });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const client = await authService.login({ email, password });
    req.session.clientId = client.id;
    res.json({ message: 'Logged in', client: { id: client.id, email: client.email, name: client.name } });
  } catch (err) {
    if (err.message === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (err.message === 'PENDING_APPROVAL') {
      return res.status(403).json({ error: 'PENDING_APPROVAL', message: 'Your account is pending approval. You will receive an email once approved.' });
    }
    if (err.message === 'ACCOUNT_SUSPENDED') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Your account has been suspended. Please contact support.' });
    }
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const client = await authService.getById(req.session.clientId);
    res.json({ client: { id: client.id, email: client.email, name: client.name } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
