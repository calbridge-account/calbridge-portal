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
const decisionsRoutes = require('./routes/decisions');
const cogsRoutes = require('./routes/cogs');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.set('trust proxy', 1); // trust Nginx reverse proxy
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
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
app.use('/decisions', decisionsRoutes);
app.use('/cogs', cogsRoutes);
app.use('/admin', adminRoutes);
app.use('/billing', billingRoutes);

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
