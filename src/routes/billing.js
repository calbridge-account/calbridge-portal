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

/**
 * GET /billing/plans
 * Return plan definitions (public — no auth required)
 */
router.get('/plans', (req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

/**
 * GET /billing/status
 * Return current subscription status for logged-in client
 */
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT subscription_plan, subscription_status, trial_ends_at, subscription_ends_at,
             stripe_customer_id, stripe_subscription_id
      FROM clients WHERE client_id = ?
    `, [req.session.clientId]);

    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const r = rows[0];

    res.json({
      plan:               r.SUBSCRIPTION_PLAN    || null,
      status:             r.SUBSCRIPTION_STATUS  || 'none',
      trialEndsAt:        r.TRIAL_ENDS_AT        || null,
      subscriptionEndsAt: r.SUBSCRIPTION_ENDS_AT || null,
      hasCustomer:        !!r.STRIPE_CUSTOMER_ID,
      hasSubscription:    !!r.STRIPE_SUBSCRIPTION_ID
    });
  } catch (err) { next(err); }
});

/**
 * POST /billing/create-checkout
 * Create a Stripe checkout session and redirect to Stripe
 * Body: { planId: 'starter' | 'growth' | 'pro' }
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

    // Fetch client details
    const rows = await query(`
      SELECT email, name, stripe_customer_id FROM clients WHERE client_id = ?
    `, [req.session.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    // TODO: Initialize Stripe here (key is available at runtime)
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Get or create Stripe customer
    let customerId = client.STRIPE_CUSTOMER_ID;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: client.EMAIL,
        name:  client.NAME,
        metadata: { clientId: req.session.clientId }
      });
      customerId = customer.id;
      await query(`UPDATE clients SET stripe_customer_id = ? WHERE client_id = ?`,
        [customerId, req.session.clientId]);
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
        clientId: req.session.clientId,
        planId:   plan.id
      }
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) { next(err); }
});

/**
 * GET /billing/success
 * Handle successful Stripe checkout redirect
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
      const sub = session.subscription;
      const planId = session.metadata?.planId || null;

      await query(`
        UPDATE clients
        SET stripe_subscription_id = ?,
            subscription_plan   = ?,
            subscription_status = ?,
            subscription_ends_at = ?
        WHERE client_id = ?
      `, [
        sub?.id || null,
        planId,
        sub?.status || 'active',
        sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        req.session.clientId
      ]);

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
        // Look up client by Stripe customer ID
        const rows = await query(
          `SELECT client_id FROM clients WHERE stripe_customer_id = ?`,
          [sub.customer]
        );
        if (rows.length) {
          // Determine plan from price metadata or product
          // TODO: Map Stripe price IDs back to plan IDs via PLANS lookup
          const priceId = sub.items?.data?.[0]?.price?.id;
          const planId = Object.values(PLANS).find(p => p.stripePriceId === priceId)?.id || null;

          await query(`
            UPDATE clients
            SET stripe_subscription_id = ?,
                subscription_plan       = ?,
                subscription_status     = ?,
                subscription_ends_at    = ?
            WHERE client_id = ?
          `, [
            sub.id,
            planId,
            sub.status,
            sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
            rows[0].CLIENT_ID
          ]);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const rows = await query(
          `SELECT client_id FROM clients WHERE stripe_customer_id = ?`,
          [sub.customer]
        );
        if (rows.length) {
          await query(`
            UPDATE clients
            SET subscription_status  = 'cancelled',
                subscription_ends_at = ?
            WHERE client_id = ?
          `, [
            sub.ended_at ? new Date(sub.ended_at * 1000).toISOString() : new Date().toISOString(),
            rows[0].CLIENT_ID
          ]);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const rows = await query(
          `SELECT client_id FROM clients WHERE stripe_customer_id = ?`,
          [invoice.customer]
        );
        if (rows.length) {
          await query(`
            UPDATE clients SET subscription_status = 'past_due' WHERE client_id = ?
          `, [rows[0].CLIENT_ID]);
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
