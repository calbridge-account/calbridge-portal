const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

// ─── Stripe client (lazy — only initialised when STRIPE_SECRET_KEY is set) ────
let _stripe = null;
function stripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
    const Stripe = require('stripe');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
  }
  return _stripe;
}

/**
 * Plan definitions — single source of truth
 */
const PLANS = {
  free: {
    id:           'free',
    name:         'Free',
    price:        0,
    priceMonthly: 'Free',
    description:  'See your Amazon data. No credit card required.',
    features: [
      '1 Amazon connection',
      '30-day data window',
      'Advertising & sales dashboard',
      'Read-only analytics',
    ],
    stripePriceId: null,
    limits: {
      connections:        1,
      dataWindowDays:     30,
      decisions:          false,
      aiChat:             false,
      vendorReports:      false,
      budgetAutomation:   false,
      smartAlerts:        false,
      campaignCreation:   false,
      portfolioBudgets:   false,
      apiAccess:          false,
      teamSeats:          1,
      whiteLabel:         false,
      multiBrand:         false,
    },
  },
  starter: {
    id:           'starter',
    name:         'Starter',
    price:        99,
    priceMonthly: '$99/mo',
    description:  'Clean data and full visibility. You make the calls.',
    features: [
      '2 Amazon connections',
      '90-day data history',
      'Full SP, SB, SD, DSP dashboard',
      'Contribution margin per campaign',
      'Budget tracking & daily pacing',
      'Manual recommendations (read-only)',
      '3 team seats',
    ],
    stripePriceId: process.env.STRIPE_PRICE_STARTER,
    limits: {
      connections:        2,
      dataWindowDays:     90,
      decisions:          false,
      aiChat:             false,
      vendorReports:      true,
      budgetAutomation:   false,
      smartAlerts:        false,
      campaignCreation:   false,
      portfolioBudgets:   false,
      apiAccess:          false,
      teamSeats:          3,
      whiteLabel:         false,
      multiBrand:         false,
    },
  },
  growth: {
    id:           'growth',
    name:         'Growth',
    price:        249,
    priceMonthly: '$249/mo',
    description:  'AI tells you what to do — and does it.',
    features: [
      'All Amazon connections',
      '1-year data history',
      'Everything in Starter',
      'AI bid recommendations + 1-click execution',
      'Budget automation (auto-pause / auto-resume)',
      'Smart alerts (spend spikes, ACoS, budget burn)',
      'Dayparting — hourly bid multipliers',
      'Marginal ROAS scoring',
      '5 team seats',
    ],
    stripePriceId: process.env.STRIPE_PRICE_GROWTH,
    limits: {
      connections:        999,
      dataWindowDays:     365,
      decisions:          true,
      aiChat:             true,
      vendorReports:      true,
      budgetAutomation:   true,
      smartAlerts:        true,
      campaignCreation:   false,
      portfolioBudgets:   false,
      apiAccess:          false,
      teamSeats:          5,
      whiteLabel:         false,
      multiBoard:         false,
    },
  },
  pro: {
    id:           'pro',
    name:         'Pro',
    price:        499,
    priceMonthly: '$499/mo',
    description:  'Full automation. AI manages and creates campaigns.',
    features: [
      'Everything in Growth',
      '3-year data history',
      'Smart campaign creation (ASIN → full campaign structure)',
      'Portfolio budget management (dynamic allocation by ROAS)',
      'Campaign cloning & seasonal scaling',
      'Anomaly detection (auto-pause runaway spend)',
      'Custom attribution windows',
      'API access',
      'Unlimited team seats',
      'Onboarding call with Abe',
    ],
    stripePriceId: process.env.STRIPE_PRICE_PRO,
    limits: {
      connections:        999,
      dataWindowDays:     1095,
      decisions:          true,
      aiChat:             true,
      vendorReports:      true,
      budgetAutomation:   true,
      smartAlerts:        true,
      campaignCreation:   true,
      portfolioBudgets:   true,
      apiAccess:          true,
      teamSeats:          999,
      whiteLabel:         false,
      multiBoard:         false,
    },
  },
  agency: {
    id:              'agency',
    name:            'Agency/Multi-Brand',
    price:           549,
    priceMonthly:    '$549 + $299/brand',
    description:     'White-label multi-brand portal for agencies.',
    stripePriceIdPerBrand: process.env.STRIPE_PRICE_AGENCY_PER_BRAND || null,
    features: [
      '$549/mo base (includes 1 brand), $299/mo per additional brand',
      'Everything in Pro (per brand)',
      'White-label portal — your logo, your domain',
      'Client login access (clients see only their data)',
      'Multi-brand switcher with portfolio overview',
      'Per-client reporting exports',
      'Unlimited team seats',
      'Dedicated onboarding with Abe',
    ],
    stripePriceId: process.env.STRIPE_PRICE_AGENCY,
    limits: {
      connections:        999,
      dataWindowDays:     1095,
      decisions:          true,
      aiChat:             true,
      vendorReports:      true,
      budgetAutomation:   true,
      smartAlerts:        true,
      campaignCreation:   true,
      portfolioBudgets:   true,
      apiAccess:          true,
      teamSeats:          999,
      whiteLabel:         true,
      multiBoard:         true,
    },
  },
};

// ─── Phase 3I: Manager context helpers ───────────────────────────────────────

/**
 * Look up manager_id for a given clientId via client_migration_map.
 * Returns null if no mapping exists (legacy client — use clients table directly).
 *
 * @param {string} clientId
 * @returns {Promise<string|null>} managerId or null
 */
async function getManagerId(clientId) {
  try {
    const rows = await query(
      'SELECT manager_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?',
      [clientId]
    );
    return rows[0]?.MANAGER_ID || rows[0]?.manager_id || null;
  } catch (err) {
    console.warn('[Billing] getManagerId lookup failed:', err.message);
    return null;
  }
}

/**
 * Read billing status from manager_accounts.
 * Returns null if not found or if the manager row has no billing data.
 *
 * @param {string} managerId
 * @returns {Promise<object|null>}
 */
async function getManagerBillingStatus(managerId) {
  try {
    const rows = await query(
      `SELECT subscription_plan, subscription_status, trial_ends_at, subscription_ends_at,
              stripe_customer_id, stripe_subscription_id
       FROM CALBRIDGE_PROD.APP.manager_accounts
       WHERE manager_id = ?`,
      [managerId]
    );
    if (!rows.length) return null;
    const r = rows[0];
    // Only return manager data if it has meaningful billing content
    if (!r.SUBSCRIPTION_PLAN && !r.STRIPE_CUSTOMER_ID && !r.STRIPE_SUBSCRIPTION_ID) {
      return null;
    }
    return r;
  } catch (err) {
    console.warn('[Billing] getManagerBillingStatus failed:', err.message);
    return null;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /billing/plans
 * Return plan definitions (public — no auth required)
 */
router.get('/plans', (req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

/**
 * GET /billing/status
 * Return current subscription status for logged-in client.
 *
 * Phase 3I: Reads from manager_accounts first (via client_migration_map),
 * falls back to clients table for legacy clients with no manager mapping.
 */
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const clientId = req.session.clientId;

    // ── Phase 3I: Try manager_accounts first ──────────────────────────────
    const managerId = await getManagerId(clientId);
    if (managerId) {
      const mgr = await getManagerBillingStatus(managerId);
      if (mgr) {
        return res.json({
          plan:               mgr.SUBSCRIPTION_PLAN    || null,
          status:             mgr.SUBSCRIPTION_STATUS  || 'none',
          trialEndsAt:        mgr.TRIAL_ENDS_AT        || null,
          subscriptionEndsAt: mgr.SUBSCRIPTION_ENDS_AT || null,
          hasCustomer:        !!mgr.STRIPE_CUSTOMER_ID,
          hasSubscription:    !!mgr.STRIPE_SUBSCRIPTION_ID,
          limits:             (PLANS[mgr.SUBSCRIPTION_PLAN || 'free'] || PLANS.free).limits,
          canUpgrade:         (mgr.SUBSCRIPTION_PLAN || 'free') !== 'pro',
          source:             'manager_accounts',
        });
      }
    }

    // ── Fallback: read from clients (legacy / no manager mapping) ─────────
    const rows = await query(`
      SELECT subscription_plan, subscription_status, trial_ends_at, subscription_ends_at,
             stripe_customer_id, stripe_subscription_id
      FROM clients WHERE client_id = ?
    `, [clientId]);

    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const r = rows[0];
    const _planId  = r.SUBSCRIPTION_PLAN || 'free';
    const _planDef = PLANS[_planId] || PLANS.free;

    res.json({
      plan:               _planId,
      status:             r.SUBSCRIPTION_STATUS  || 'active',
      trialEndsAt:        r.TRIAL_ENDS_AT        || null,
      subscriptionEndsAt: r.SUBSCRIPTION_ENDS_AT || null,
      hasCustomer:        !!r.STRIPE_CUSTOMER_ID,
      hasSubscription:    !!r.STRIPE_SUBSCRIPTION_ID,
      limits:             _planDef.limits,
      canUpgrade:         _planId !== 'pro',
      source:             'clients',
    });
  } catch (err) { next(err); }
});

/**
 * POST /billing/create-checkout
 * Create a Stripe checkout session and redirect to Stripe
 * Body: { planId: 'starter' | 'growth' | 'pro' }
 *
 * Phase 3I: Reads/writes stripe_customer_id to manager_accounts (with dual-write to clients).
 */
// Named handler so we can register on both /create-checkout and /checkout
async function handleCreateCheckout(req, res, next) {

  try {
    const { planId } = req.body;
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const clientId = req.session.clientId;

    // Fetch client details (email/name always from clients table)
    const rows = await query(`
      SELECT email, name, stripe_customer_id FROM clients WHERE client_id = ?
    `, [clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    // ── Phase 3I: resolve manager context ─────────────────────────────────
    const managerId = await getManagerId(clientId);

    // Determine existing customer ID: manager_accounts takes precedence
    let customerId = client.STRIPE_CUSTOMER_ID;
    if (managerId) {
      const mgrRows = await query(
        'SELECT stripe_customer_id FROM CALBRIDGE_PROD.APP.manager_accounts WHERE manager_id = ?',
        [managerId]
      );
      if (mgrRows.length && mgrRows[0].STRIPE_CUSTOMER_ID) {
        customerId = mgrRows[0].STRIPE_CUSTOMER_ID;
      }
    }

    // TODO: Initialize Stripe here (key is available at runtime)
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Get or create Stripe customer
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: client.EMAIL,
        name:  client.NAME,
        metadata: { clientId, managerId: managerId || clientId }
      });
      customerId = customer.id;

      // ── Phase 3I: dual-write customer ID ──────────────────────────────
      // Write to clients (legacy compat)
      await query(`UPDATE clients SET stripe_customer_id = ? WHERE client_id = ?`,
        [customerId, clientId]);

      // Write to manager_accounts if mapping exists
      if (managerId) {
        await query(
          `UPDATE CALBRIDGE_PROD.APP.manager_accounts SET stripe_customer_id = ? WHERE manager_id = ?`,
          [customerId, managerId]
        );
      }
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    const session = await stripe().checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/billing/cancel`,
      metadata: {
        clientId,
        managerId: managerId || '',
        planId:   plan.id
      }
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) { next(err); }
}

// Register checkout handler on both path names
router.post('/create-checkout', requireAuth, handleCreateCheckout);
router.post('/checkout',        requireAuth, handleCreateCheckout);

/**
 * GET /billing/success
 * Handle successful Stripe checkout redirect.
 *
 * Phase 3I: Dual-writes subscription data to both manager_accounts and clients.
 */
router.get('/success', requireAuth, async (req, res, next) => {
  // Guard: billing not configured
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.redirect('/billing.html?status=not_configured');
  }

  try {
    const { session_id } = req.query;
    if (!session_id) return res.redirect('/billing.html?status=error');

    const session = await stripe().checkout.sessions.retrieve(session_id, {
      expand: ['subscription']
    });

    if (session.payment_status === 'paid' || session.status === 'complete') {
      const sub     = session.subscription;
      const planId  = session.metadata?.planId || null;
      const clientId = req.session.clientId;

      const subId     = sub?.id     || null;
      const subStatus = sub?.status || 'active';
      const subEndsAt = sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      // ── Phase 3I: write to clients (backward compat) ──────────────────
      await query(`
        UPDATE clients
        SET stripe_subscription_id = ?,
            subscription_plan   = ?,
            subscription_status = ?,
            subscription_ends_at = ?
        WHERE client_id = ?
      `, [subId, planId, subStatus, subEndsAt, clientId]);

      // ── Phase 3I: also write to manager_accounts if mapping exists ─────
      const managerId = await getManagerId(clientId);
      if (managerId) {
        await query(`
          UPDATE CALBRIDGE_PROD.APP.manager_accounts
          SET stripe_subscription_id = ?,
              subscription_plan   = ?,
              subscription_status = ?,
              subscription_ends_at = ?
          WHERE manager_id = ?
        `, [subId, planId, subStatus, subEndsAt, managerId]);
      }

      return res.redirect('/billing.html?status=success');
    }

    res.redirect('/billing.html?status=pending');
  } catch (err) {
    console.error('[Billing] Success handler error:', err.message);
    res.redirect('/billing.html?status=error');
  }
});

/**
 * GET /billing/cancel
 * Handle cancelled Stripe checkout
 */
router.get('/cancel', requireAuth, (req, res) => {
  res.redirect('/billing.html?status=cancelled');
});

/**
 * POST /billing/webhook
 * Handle Stripe webhooks — MUST use raw body, not parsed JSON
 * Events handled:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_failed
 *
 * Phase 3I: All subscription events dual-write to manager_accounts + clients.
 * Lookup order: stripe_customer_id on manager_accounts first, then clients.
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Guard: billing not configured
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Billing not configured' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Billing] Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;

        // Determine plan from price ID
        const priceId = sub.items?.data?.[0]?.price?.id;
        const planId  = Object.values(PLANS).find(p => p.stripePriceId === priceId)?.id || null;
        const subEndsAt = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        // ── Phase 3I: try manager_accounts first ─────────────────────────
        const mgrRows = await query(
          `SELECT manager_id FROM CALBRIDGE_PROD.APP.manager_accounts WHERE stripe_customer_id = ?`,
          [sub.customer]
        );
        if (mgrRows.length) {
          await query(`
            UPDATE CALBRIDGE_PROD.APP.manager_accounts
            SET stripe_subscription_id = ?,
                subscription_plan       = ?,
                subscription_status     = ?,
                subscription_ends_at    = ?
            WHERE manager_id = ?
          `, [sub.id, planId, sub.status, subEndsAt, mgrRows[0].MANAGER_ID]);
        }

        // ── Also update clients (dual-write) ──────────────────────────────
        const clientRows = await query(
          `SELECT client_id FROM clients WHERE stripe_customer_id = ?`,
          [sub.customer]
        );
        if (clientRows.length) {
          await query(`
            UPDATE clients
            SET stripe_subscription_id = ?,
                subscription_plan       = ?,
                subscription_status     = ?,
                subscription_ends_at    = ?
            WHERE client_id = ?
          `, [sub.id, planId, sub.status, subEndsAt, clientRows[0].CLIENT_ID]);
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const sub     = event.data.object;
        const endsAt  = sub.ended_at
          ? new Date(sub.ended_at * 1000).toISOString()
          : new Date().toISOString();

        // ── Phase 3I: update manager_accounts ────────────────────────────
        const mgrRows = await query(
          `SELECT manager_id FROM CALBRIDGE_PROD.APP.manager_accounts WHERE stripe_customer_id = ?`,
          [sub.customer]
        );
        if (mgrRows.length) {
          await query(`
            UPDATE CALBRIDGE_PROD.APP.manager_accounts
            SET subscription_status  = 'cancelled',
                subscription_ends_at = ?
            WHERE manager_id = ?
          `, [endsAt, mgrRows[0].MANAGER_ID]);
        }

        // ── Also update clients ────────────────────────────────────────────
        const clientRows = await query(
          `SELECT client_id FROM clients WHERE stripe_customer_id = ?`,
          [sub.customer]
        );
        if (clientRows.length) {
          await query(`
            UPDATE clients
            SET subscription_status  = 'cancelled',
                subscription_ends_at = ?
            WHERE client_id = ?
          `, [endsAt, clientRows[0].CLIENT_ID]);
        }

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;

        // ── Phase 3I: update manager_accounts ────────────────────────────
        const mgrRows = await query(
          `SELECT manager_id FROM CALBRIDGE_PROD.APP.manager_accounts WHERE stripe_customer_id = ?`,
          [invoice.customer]
        );
        if (mgrRows.length) {
          await query(
            `UPDATE CALBRIDGE_PROD.APP.manager_accounts SET subscription_status = 'past_due' WHERE manager_id = ?`,
            [mgrRows[0].MANAGER_ID]
          );
        }

        // ── Also update clients ────────────────────────────────────────────
        const clientRows = await query(
          `SELECT client_id FROM clients WHERE stripe_customer_id = ?`,
          [invoice.customer]
        );
        if (clientRows.length) {
          await query(
            `UPDATE clients SET subscription_status = 'past_due' WHERE client_id = ?`,
            [clientRows[0].CLIENT_ID]
          );
        }

        // TODO: Send payment failure email via Resend
        console.warn('[Billing] Payment failed for customer:', invoice.customer);
        break;
      }

      default:
        // Unhandled event types — acknowledge receipt and move on
        console.log('[Billing] Unhandled webhook event:', event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Billing] Webhook handler error:', err.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});


/**
 * POST /billing/portal
 * Create a Stripe customer portal session so users can manage their subscription.
 */
router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    const clientId = req.session.clientId;

    // Find stripe_customer_id — try manager_accounts first
    let customerId = null;
    const managerId = await getManagerId(clientId);
    if (managerId) {
      const mgrRows = await query(
        'SELECT stripe_customer_id FROM CALBRIDGE_PROD.APP.manager_accounts WHERE manager_id = ?',
        [managerId]
      );
      customerId = mgrRows[0]?.STRIPE_CUSTOMER_ID || null;
    }
    if (!customerId) {
      const rows = await query(
        'SELECT stripe_customer_id FROM clients WHERE client_id = ?',
        [clientId]
      );
      customerId = rows[0]?.STRIPE_CUSTOMER_ID || null;
    }

    if (!customerId) {
      return res.status(400).json({ error: 'No billing account found. Please subscribe first.' });
    }

    const returnUrl = process.env.APP_URL
      ? `${process.env.APP_URL}/account`
      : `${req.protocol}://${req.get('host')}/account`;

    const session = await stripe().billingPortal.sessions.create({
      customer:   customerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.PLANS = PLANS;
