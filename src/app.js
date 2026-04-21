require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');

const path = require('path');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const amazonRoutes = require('./routes/amazon');
const dashboardRoutes = require('./routes/dashboard');
const advertisingRoutes = require('./routes/advertising');
const accountRoutes = require('./routes/account');
const decisionsRoutes = require('./routes/decisions');
const cogsRoutes = require('./routes/cogs');
const adminRoutes = require('./routes/admin');
const adminOpsRoutes = require('./routes/adminOps');
const billingRoutes = require('./routes/billing');
const chatRoutes = require('./routes/chat');
const campaignsRoutes = require('./routes/campaigns');
const { ensureCampaignActionsTable } = require('./routes/campaigns');
const brandsRoutes = require('./routes/brands');
const recommendationsRoutes = require('./routes/recommendations');
const vendorAnalyticsRoutes  = require('./routes/vendorAnalytics');
const sellerAnalyticsRoutes  = require('./routes/sellerAnalytics');
const daypartingRoutes        = require('./routes/dayparting');
const cogsAnalyticsRoutes  = require('./routes/cogsAnalytics');
const streamRoutes         = require('./routes/stream');
const budgetRoutes         = require('./routes/budgets');
const navConfigRoutes      = require('./routes/navConfig');
const managerRoutes        = require('./routes/managerAccounts');
const managerAccountRoutes = require('./routes/managerAccounts');
const { agencyRouter }     = require('./routes/managerAccounts');

const app = express();

// Security & parsing
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // Allow Vite-built module scripts served from same origin
      'script-src':  ["'self'", "'unsafe-inline'"],  // unsafe-inline needed for Vite module preload
      'script-src-attr': ["'none'"],
      'connect-src': ["'self'"],
      'img-src':     ["'self'", 'data:', 'blob:'],
    },
  },
}));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session — Snowflake store (stable and synchronous)
const SnowflakeStore = require('./services/snowflakeSessionStore');

app.set('trust proxy', 1);
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave:            false,
  saveUninitialized: false,
  store:             new SnowflakeStore(),
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  },
}));

// No-op init kept for compatibility with server.js
app.init = async function initSessionStore() {};

// Serve static frontend
// HTML files: no-cache so browsers always re-check after deploys.
// JS/CSS/images: rely on ?v=<githash> query string for cache busting.
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, '../public')));

// Auth check endpoint for the React dashboard
app.get('/analytics-auth', (req, res) => {
  if (!req.session || !req.session.clientId) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true, clientId: req.session.clientId });
});

// Serve calbridge-v2 at /v2
app.use('/v2', express.static(path.join(__dirname, '../calbridge-v2/dist')));
app.get(/^\/v2(\/.*)?$/, (req, res, next) => {
  if (!req.session || !req.session.clientId) {
    return res.redirect('/?redirect=/v2/');
  }
  res.sendFile('index.html', {
    root: path.join(__dirname, '../calbridge-v2/dist')
  }, (err) => { if (err) next(err); });
});

// Serve Calbridge analytics dashboard at /analytics — redirect to login if not authenticated
app.get('/analytics', (req, res, next) => {
  if (!req.session || !req.session.clientId) {
    return res.redirect('/?redirect=/analytics/');
  }
  next();
});
app.use('/analytics', express.static(path.join(__dirname, '../calbridge-dash/dist')));
// Catch-all for React Router deep links (e.g. /analytics/advertising, /analytics/vendor)
// Regex instead of /*path wildcard to avoid Express 5 NotFoundError on sendFile
app.get(/^\/analytics(\/.*)?$/, (req, res, next) => {
  if (!req.session || !req.session.clientId) {
    return res.redirect('/?redirect=/analytics/');
  }
  res.sendFile('index.html', {
    root: path.join(__dirname, '../calbridge-dash/dist')
  }, (err) => { if (err) next(err); });
});

// Rate limiting — applied AFTER static files so HTML/CSS/JS are never throttled
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' }
});

app.use('/api', apiLimiter);
app.use('/auth/login', authLimiter);
app.use('/auth/signup', authLimiter);
app.use('/auth/forgot-password', authLimiter);

// Routes
app.use('/auth', authRoutes);
app.use('/amazon', amazonRoutes);
// /dashboard is deprecated — redirect everything to /analytics
app.get('/dashboard', (req, res) => res.redirect(301, '/analytics/'));
app.get('/dashboard/*path', (req, res) => res.redirect(301, '/analytics/'));
app.use('/advertising', advertisingRoutes);
app.use('/account', accountRoutes);
app.use('/decisions', decisionsRoutes);
app.use('/cogs', cogsRoutes);
app.use('/admin', adminRoutes);
app.use('/admin', adminOpsRoutes);
app.use('/billing', billingRoutes);
app.use('/chat', chatRoutes);
app.use('/campaigns', campaignsRoutes);
app.use('/brands', brandsRoutes);
app.use('/recommendations', recommendationsRoutes);
app.use('/vendor-analytics', vendorAnalyticsRoutes);
app.use('/seller-analytics', sellerAnalyticsRoutes);
app.use('/dayparting',        daypartingRoutes);
app.use('/cogs-analytics', cogsAnalyticsRoutes);
app.use('/admin', streamRoutes);
app.use('/budgets', budgetRoutes);
app.use('/', navConfigRoutes);
app.use('/manager', managerRoutes);
app.use('/manager', managerAccountRoutes);
app.use('/agency', agencyRouter);
app.use('/upload', require('./routes/upload'));

// Ensure campaign_actions table exists (non-blocking)
ensureCampaignActionsTable().catch(err =>
  console.warn('[Campaigns] Could not create campaign_actions table:', err.message)
);

// Public pricing redirect — no auth required
app.get('/landing', (req, res) => res.sendFile('landing.html', { root: path.join(__dirname, '../public') }));
app.get('/pricing', (req, res) => res.redirect('/landing#pricing'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Log 4xx/5xx requests server-side (no sensitive data exposed to clients)
app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      console.error(`[http] ${req.method} ${req.path} → ${res.statusCode}`);
    }
  });
  next();
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler — MUST be last middleware
// Never exposes stack traces or internal details to clients in production
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Always log full error server-side
  console.error(`[error] ${req.method} ${req.path} → ${status}:`, err.message);
  if (!isProd) console.error(err.stack);

  // Never expose stack traces or internal details to clients
  res.status(status).json({
    error: isProd ? (status < 500 ? err.message : 'Internal server error') : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
});

module.exports = app;
