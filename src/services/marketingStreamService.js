/**
 * Amazon Marketing Stream — SQS Poller
 *
 * Architecture:
 *   Amazon Ads → SQS queue (AWS) → this poller (Azure VM) → Snowflake
 *
 * Polls SQS every 5 minutes, processes messages, writes to stream_* tables.
 *
 * One-time setup per client/profile:
 *   1. Create SQS queue on AWS with the correct resource policy (see docs/marketing-stream-setup.md)
 *   2. Call POST /admin/stream/subscribe to register the subscription via Amazon Ads API
 *   3. Poller handles the SubscriptionConfirmation message automatically
 *
 * Environment variables required:
 *   AWS_REGION           — e.g. us-east-1
 *   AWS_ACCESS_KEY_ID    — IAM user with sqs:ReceiveMessage, sqs:DeleteMessage on the queues
 *   AWS_SECRET_ACCESS_KEY
 */
'use strict';

const {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand
} = require('@aws-sdk/client-sqs');
const { query, batchMerge } = require('./snowflakeService');
const { getValidToken } = require('./amazonAuthService');
const axios = require('axios');

const ADS_API_BASE = 'https://advertising-api.amazon.com';

// ─── SQS client factory ───────────────────────────────────────────────────────
// One client per poll cycle (cheap, stateless).
function getSqsClient() {
  return new SQSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });
}

// ─── Poll all active queues ───────────────────────────────────────────────────

/**
 * Poll all active SQS subscriptions and process messages.
 * Called by the scheduler every 5 minutes.
 *
 * Silently no-ops if there are no active subscriptions, so it's safe
 * to register this before any queues are set up.
 */
async function pollAllQueues() {
  // Guard: skip if AWS credentials aren't configured yet
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return; // No-op until AWS is set up
  }

  let subscriptions = [];
  try {
    subscriptions = await query(`
      SELECT id, client_id, profile_id, dataset, sqs_queue_url, sqs_queue_arn
      FROM stream_subscriptions
      WHERE status = 'active'
    `);
  } catch (err) {
    console.error('[Stream] Failed to load subscriptions:', err.message);
    return;
  }

  if (!subscriptions.length) return;

  const sqs = getSqsClient();
  for (const sub of subscriptions) {
    try {
      await pollQueue(sqs, sub);
    } catch (err) {
      console.error(`[Stream] Error polling ${sub.DATASET} for client ${sub.CLIENT_ID}:`, err.message);
    }
  }
}

// ─── Poll a single queue ──────────────────────────────────────────────────────

/**
 * Poll one SQS queue, processing up to MAX_BATCHES × 10 messages per run.
 * After writing to Snowflake, messages are deleted (acknowledged).
 * Failed-to-parse messages are left in the queue for retry (visibility timeout).
 */
async function pollQueue(sqs, sub) {
  const queueUrl = sub.SQS_QUEUE_URL;
  const clientId = sub.CLIENT_ID;
  const profileId = sub.PROFILE_ID;
  const dataset = sub.DATASET;

  const MAX_BATCHES = 20; // 20 × 10 = 200 messages max per 5-minute poll cycle
  let processed = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const result = await sqs.send(new ReceiveMessageCommand({
      QueueUrl:            queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds:     1,    // short-poll — we're driven by a scheduler, not event loop
      AttributeNames:      ['All']
    }));

    const messages = result.Messages || [];
    if (!messages.length) break; // queue is empty, done

    const toDelete = [];
    const records = [];

    for (const msg of messages) {
      try {
        const body = JSON.parse(msg.Body);

        // SNS subscription confirmation — hit the URL and ack
        if (body.Type === 'SubscriptionConfirmation') {
          await confirmSubscription(body.SubscribeURL);
          toDelete.push({ Id: msg.MessageId, ReceiptHandle: msg.ReceiptHandle });
          continue;
        }

        // Parse stream payload into Snowflake rows
        const parsed = parseStreamMessage(body, dataset, clientId, profileId);
        if (parsed?.length) records.push(...parsed);
        toDelete.push({ Id: msg.MessageId, ReceiptHandle: msg.ReceiptHandle });
      } catch (err) {
        console.error(`[Stream] Failed to parse message ${msg.MessageId}:`, err.message);
        // Don't delete — leave in queue, visibility timeout will retry
      }
    }

    // Flush records to Snowflake before deleting messages
    // (ensures we don't lose data if write fails)
    if (records.length) {
      await writeStreamData(dataset, records);
      processed += records.length;
    }

    // Delete successfully processed messages
    if (toDelete.length) {
      await sqs.send(new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: toDelete
      }));
    }
  }

  if (processed > 0) {
    console.log(`[Stream] ${dataset} (${clientId}): wrote ${processed} records`);
  }
}

// ─── Message parser ───────────────────────────────────────────────────────────

/**
 * Parse an Amazon Marketing Stream message into an array of Snowflake row objects.
 *
 * Amazon wraps records in body.records or body.data (varies by dataset version).
 * Field names follow Amazon's camelCase convention; we map to snake_case here.
 */
function parseStreamMessage(body, dataset, clientId, profileId) {
  const records = body.records || body.data || (Array.isArray(body) ? body : [body]);

  switch (dataset) {
    case 'sp-traffic':
      return records.map(r => ({
        client_id:     clientId,
        profile_id:    profileId,
        event_time:    r.eventTime || r.startTime,
        campaign_id:   r.campaignId,
        campaign_name: r.campaignName || null,
        ad_group_id:   r.adGroupId || null,
        impressions:   r.impressions || 0,
        clicks:        r.clicks || 0
      }));

    case 'sp-conversion':
      return records.map(r => ({
        client_id:     clientId,
        profile_id:    profileId,
        event_time:    r.eventTime || r.startTime,
        campaign_id:   r.campaignId,
        ad_group_id:   r.adGroupId || null,
        purchases_1d:  r.purchases1d  || 0,
        purchases_7d:  r.purchases7d  || 0,
        purchases_14d: r.purchases14d || 0,
        purchases_30d: r.purchases30d || 0,
        sales_1d:      r.sales1d  || 0,
        sales_7d:      r.sales7d  || 0,
        sales_14d:     r.sales14d || 0,
        sales_30d:     r.sales30d || 0
      }));

    case 'budget-usage':
      return records.map(r => ({
        client_id:        clientId,
        profile_id:       profileId,
        event_time:       r.eventTime || r.timestamp,
        campaign_id:      r.campaignId,
        campaign_name:    r.campaignName || null,
        ad_type:          r.adType || null,
        budget_amount:    r.budgetAmount   ?? null,
        budget_used:      r.budgetUsed     ?? r.budgetConsumed ?? null,
        budget_remaining: r.budgetRemaining ?? null,
        budget_pct_used:  r.budgetPercentUsed != null ? r.budgetPercentUsed / 100 : null,
        budget_exhausted: r.budgetExhausted || false
      }));

    case 'sb-traffic':
      return records.map(r => ({
        client_id:     clientId,
        profile_id:    profileId,
        event_time:    r.eventTime || r.startTime,
        campaign_id:   r.campaignId,
        campaign_name: r.campaignName || null,
        impressions:   r.impressions || 0,
        clicks:        r.clicks || 0
      }));

    default:
      console.warn(`[Stream] Unknown dataset type: ${dataset}`);
      return [];
  }
}

// ─── Snowflake writer ─────────────────────────────────────────────────────────

const TABLE_MAP = {
  'sp-traffic':    'stream_sp_traffic',
  'sp-conversion': 'stream_sp_conversion',
  'budget-usage':  'stream_budget_usage',
  'sb-traffic':    'stream_sb_traffic'
};

const KEY_COLUMNS = {
  'sp-traffic':    ['client_id', 'profile_id', 'event_time', 'campaign_id', 'ad_group_id'],
  'sp-conversion': ['client_id', 'profile_id', 'event_time', 'campaign_id', 'ad_group_id'],
  'budget-usage':  ['client_id', 'profile_id', 'event_time', 'campaign_id'],
  'sb-traffic':    ['client_id', 'profile_id', 'event_time', 'campaign_id']
};

const DATA_COLUMNS = {
  'sp-traffic':    ['campaign_name', 'impressions', 'clicks'],
  'sp-conversion': ['purchases_1d', 'purchases_7d', 'purchases_14d', 'purchases_30d',
                    'sales_1d', 'sales_7d', 'sales_14d', 'sales_30d'],
  'budget-usage':  ['campaign_name', 'ad_type', 'budget_amount', 'budget_used',
                    'budget_remaining', 'budget_pct_used', 'budget_exhausted'],
  'sb-traffic':    ['campaign_name', 'impressions', 'clicks']
};

async function writeStreamData(dataset, records) {
  await batchMerge({
    table:       TABLE_MAP[dataset],
    keyColumns:  KEY_COLUMNS[dataset],
    dataColumns: DATA_COLUMNS[dataset],
    rows:        records
  });
}

// ─── SNS subscription confirmation ───────────────────────────────────────────

/**
 * Amazon sends a SubscriptionConfirmation message to the SQS queue when
 * a new Marketing Stream subscription is created. We must GET the SubscribeURL
 * to confirm, or the subscription won't activate.
 */
async function confirmSubscription(subscribeUrl) {
  try {
    await axios.get(subscribeUrl, { timeout: 10000 });
    console.log('[Stream] Subscription confirmed via SubscribeURL');
  } catch (err) {
    console.error('[Stream] Failed to confirm subscription:', err.message);
  }
}

// ─── Subscription management ──────────────────────────────────────────────────

/**
 * Subscribe a client/profile to a Marketing Stream dataset via Amazon Ads API.
 * Saves the subscription to stream_subscriptions so the poller picks it up.
 *
 * @param {string} clientId     - Calbridge client ID
 * @param {string} profileId    - Amazon Ads profile ID
 * @param {string} dataset      - 'sp-traffic' | 'sp-conversion' | 'budget-usage' | 'sb-traffic'
 * @param {string} sqsQueueArn  - Full ARN of the SQS queue, e.g. arn:aws:sqs:us-east-1:123456789012:calbridge-sp-traffic
 * @param {string} sqsQueueUrl  - Full URL of the SQS queue
 * @returns {string} Amazon-assigned subscriptionId
 */
async function subscribeToDataset(clientId, profileId, dataset, sqsQueueArn, sqsQueueUrl = '') {
  const token = await getValidToken(clientId, 'ads');

  const res = await axios.post(
    `${ADS_API_BASE}/streams/subscriptions`,
    {
      dataSetId:   dataset,
      destination: { sqsArn: sqsQueueArn },
      notes:       `Calbridge portal - ${clientId}`
    },
    {
      headers: {
        Authorization:                         `Bearer ${token}`,
        'Amazon-Advertising-API-ClientId':     process.env.AMAZON_CLIENT_ID,
        'Amazon-Advertising-API-Scope':        profileId,
        'Content-Type':                        'application/json'
      }
    }
  );

  const subscriptionId = res.data.subscriptionId;

  // Upsert into stream_subscriptions
  await query(`
    MERGE INTO stream_subscriptions AS target
    USING (SELECT ? AS client_id, ? AS profile_id, ? AS dataset) AS source
      ON target.client_id  = source.client_id
     AND target.profile_id = source.profile_id
     AND target.dataset    = source.dataset
    WHEN MATCHED THEN UPDATE SET
      subscription_id = ?,
      sqs_queue_arn   = ?,
      sqs_queue_url   = ?,
      status          = 'active',
      created_at      = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT
      (client_id, profile_id, dataset, subscription_id, sqs_queue_url, sqs_queue_arn, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
  `, [
    clientId, profileId, dataset,
    subscriptionId, sqsQueueArn, sqsQueueUrl,
    clientId, profileId, dataset, subscriptionId, sqsQueueUrl, sqsQueueArn
  ]);

  console.log(`[Stream] Subscribed ${clientId}/${profileId} to ${dataset}: ${subscriptionId}`);
  return subscriptionId;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Get today's budget usage summary for a client.
 * Returns campaigns ordered by budget_pct_used descending — exhausted ones first.
 *
 * @param {string} clientId
 * @returns {Array} campaign budget status objects
 */
async function getBudgetExhaustionSummary(clientId) {
  const rows = await query(`
    SELECT
      campaign_id,
      MAX(campaign_name)    AS campaign_name,
      MAX(ad_type)          AS ad_type,
      MAX(budget_amount)    AS budget_amount,
      MAX(budget_used)      AS budget_used,
      MAX(budget_remaining) AS budget_remaining,
      MAX(budget_pct_used)  AS budget_pct_used,
      MAX(budget_exhausted) AS budget_exhausted,
      MAX(event_time)       AS last_update
    FROM stream_budget_usage
    WHERE client_id = ?
      AND DATE(event_time) = CURRENT_DATE()
    GROUP BY campaign_id
    ORDER BY budget_pct_used DESC NULLS LAST
  `, [clientId]);

  return rows.map(r => ({
    campaignId:      r.CAMPAIGN_ID,
    campaignName:    r.CAMPAIGN_NAME || r.CAMPAIGN_ID,
    adType:          r.AD_TYPE,
    budgetAmount:    r.BUDGET_AMOUNT    != null ? Number(r.BUDGET_AMOUNT)    : null,
    budgetUsed:      r.BUDGET_USED      != null ? Number(r.BUDGET_USED)      : null,
    budgetRemaining: r.BUDGET_REMAINING != null ? Number(r.BUDGET_REMAINING) : null,
    budgetPctUsed:   r.BUDGET_PCT_USED  != null ? Number(r.BUDGET_PCT_USED)  : null,
    budgetExhausted: Boolean(r.BUDGET_EXHAUSTED),
    lastUpdate:      r.LAST_UPDATE
  }));
}

module.exports = {
  pollAllQueues,
  subscribeToDataset,
  getBudgetExhaustionSummary
};
