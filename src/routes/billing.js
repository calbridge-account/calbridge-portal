const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

// TODO: Initialize Stripe when key is available
// const Stripe = require('stripe');
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Plan definitions — single source of truth
 */
const PLANS = {
  starter: {
    id:          'starter',
    name:        'Starter',
    price:       149,
    priceMonthly: '$149/mo',
    description: 'Perfect for emerging Amazon sellers',
    features: [
      'Up to 1,000 ASINs',
      'Amazon Ads & SP-API integration',
      'Contribution margin dashboards',
      'Email support'
    ],
    // TODO: Set real Stripe price IDs after creating products in Stripe dashboard
    stripePriceId: process.env.STRIPE_PRICE_STARTER || 'price_TODO_starter'
  },
  growth: {
    id:          'growth',
    name:        'Growth',
    price:       299,
    priceMonthly: '$299/mo',
    description: 'For growing brands scaling on Amazon',
    features: [
      'Up to 10,000 ASINs',
      'All Starter features',
      'DSP advertising analytics',
      'COGS bulk import',
      'Priority support'
    ],
    stripePriceId: process.env.STRIPE_PRICE_GROWTH || 'price_TODO_growth'
  },
  pro: {
    id:          'pro',
    name:        'Pro',
    price:       499,
    priceMonthly: '$499/mo',
    description: 'Enterprise-grade for high-volume sellers',
    features: [
      'Unlimited ASINs',
      'All Growth features',
      'Custom reporting',
      'Dedicated account manager',
      'SLA guarantee'
    ],
    stripePriceId: process.env.STRIPE_PRICE_PRO || 'price_TODO_pro'
  }
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
          source:             'manager_accounts'
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

    res.json({
      plan:               r.SUBSCRIPTION_PLAN    || null,
      status:             r.SUBSCRIPTION_STATUS  || 'none',
      trialEndsAt:        r.TRIAL_ENDS_AT        || null,
      subscriptionEndsAt: r.SUBSCRIPTION_ENDS_AT || null,
      hasCustomer:        !!r.STRIPE_CUSTOMER_ID,
      hasSubscription:    !!r.STRIPE_SUBSCRIPTION_ID,
      source:             'clients'
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
router.post('/create-checkout', requireAuth, async (req, res, next) => {
  // Guard: billing not configured
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Billing not configured' });
  }

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

    // TODO: Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
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
});

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

    // TODO: Retrieve checkout session from Stripe and update subscription
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.retrieve(session_id, {
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
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    // TODO: Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
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

module.exports = router;
module.exports.PLANS = PLANS;
