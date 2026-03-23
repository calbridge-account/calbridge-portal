require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');

const path = require('path');
const authRoutes = require('./routes/auth');
const amazonRoutes = require('./routes/amazon');
const dashboardRoutes = require('./routes/dashboard');
const advertisingRoutes = require('./routes/advertising');
const accountRoutes = require('./routes/account');

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/auth', authRoutes);
app.use('/amazon', amazonRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/advertising', advertisingRoutes);
app.use('/account', accountRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
