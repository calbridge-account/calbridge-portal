# Amazon Marketing Stream — Setup Runbook

Amazon Marketing Stream pushes hourly ad performance data to SQS queues you own on AWS.
This gives us intraday spend data — critical for budget exhaustion detection and lost-sales estimation.

## Architecture

```
Amazon Ads API  ──push──►  SQS queue (AWS)  ──poll every 5min──►  Azure VM  ──►  Snowflake
                            (one per dataset)     marketingStreamService.js        stream_* tables
```

We run SQS polling from our existing Node.js scheduler — no Lambda, no Kinesis needed.

---

## Step 1 — Create AWS Resources

You need a minimal AWS account. One IAM user + one SQS queue per dataset.

### 1a. Create an IAM User

Create an IAM user (programmatic access only — no console login needed).

Attach this inline policy to allow our poller to read from the queues:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CalbridgeStreamPoller",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:DeleteMessageBatch",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:us-east-1:YOUR_ACCOUNT_ID:calbridge-*"
    }
  ]
}
```

Save the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` — add them to `.env`.

### 1b. Create SQS Queues

Create one Standard SQS queue per dataset. Suggested naming:

| Dataset        | Queue name                    |
|----------------|-------------------------------|
| sp-traffic     | `calbridge-sp-traffic`        |
| sp-conversion  | `calbridge-sp-conversion`     |
| budget-usage   | `calbridge-budget-usage`      |
| sb-traffic     | `calbridge-sb-traffic`        |

**Queue settings:**
- Type: Standard (not FIFO)
- Visibility timeout: 60 seconds
- Message retention: 4 days (default)
- No DLQ required for MVP

### 1c. Set the SQS Resource Policy

Each queue needs a resource policy that allows Amazon Ads (SNS) to send messages.
Replace `YOUR_ACCOUNT_ID` and `QUEUE_NAME`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAmazonAdsPublish",
      "Effect": "Allow",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Action": "SQS:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:YOUR_ACCOUNT_ID:QUEUE_NAME",
      "Condition": {
        "StringLike": {
          "aws:SourceArn": "arn:aws:sns:*:*:*"
        }
      }
    }
  ]
}
```

> **Note:** Amazon Marketing Stream uses SNS → SQS under the hood. The principal must be `sns.amazonaws.com`.

### 1d. Get the Queue ARN and URL

For each queue, from the AWS Console → SQS → queue details:
- **ARN**: `arn:aws:sqs:us-east-1:YOUR_ACCOUNT_ID:calbridge-budget-usage`
- **URL**: `https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT_ID/calbridge-budget-usage`

---

## Step 2 — Configure .env

Add your AWS credentials to `.env`:

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

The poller will no-op until these are set, so it's safe to deploy beforehand.

---

## Step 3 — Register Subscriptions

For each client profile + dataset you want to receive, call the subscription endpoint:

```bash
curl -X POST https://app.teamcalbridge.com/admin/stream/subscribe \
  -H "Content-Type: application/json" \
  -b "admin_session=..." \
  -d '{
    "clientId":    "YOUR_CLIENT_ID",
    "profileId":   "AMAZON_PROFILE_ID",
    "dataset":     "budget-usage",
    "sqsQueueArn": "arn:aws:sqs:us-east-1:YOUR_ACCOUNT_ID:calbridge-budget-usage",
    "sqsQueueUrl": "https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT_ID/calbridge-budget-usage"
  }'
```

Valid datasets: `sp-traffic`, `sp-conversion`, `budget-usage`, `sb-traffic`

Amazon will respond with a `subscriptionId`. This is stored in `stream_subscriptions`.

**Subscription confirmation:** Amazon sends a `SubscriptionConfirmation` message to the SQS queue.
The poller handles this automatically on the next 5-minute poll — it GETs the `SubscribeURL` and the subscription activates.

---

## Step 4 — Verify Data Is Flowing

After the first hour boundary (Amazon pushes at the top of each hour):

```sql
-- Check for recent messages
SELECT dataset, COUNT(*) AS msg_count, MAX(received_at) AS last_received
FROM stream_subscriptions
GROUP BY dataset;

-- Check budget data
SELECT campaign_name, ad_type, budget_pct_used, budget_exhausted, event_time
FROM stream_budget_usage
WHERE client_id = 'YOUR_CLIENT_ID'
  AND DATE(event_time) = CURRENT_DATE()
ORDER BY event_time DESC
LIMIT 20;
```

Or use the API:

```bash
curl "https://app.teamcalbridge.com/admin/stream/budget-exhaustion?clientId=YOUR_CLIENT_ID" \
  -b "admin_session=..."
```

---

## Snowflake Tables

| Table                  | Dataset        | Key columns                                      |
|------------------------|----------------|--------------------------------------------------|
| `stream_sp_traffic`    | sp-traffic     | client_id, profile_id, event_time, campaign_id, ad_group_id |
| `stream_sp_conversion` | sp-conversion  | client_id, profile_id, event_time, campaign_id, ad_group_id |
| `stream_budget_usage`  | budget-usage   | client_id, profile_id, event_time, campaign_id  |
| `stream_sb_traffic`    | sb-traffic     | client_id, profile_id, event_time, campaign_id  |
| `stream_subscriptions` | registry       | client_id, profile_id, dataset                  |

Run migration: `node src/migrations/run.js 005`

---

## Scaling Notes

- **One queue per dataset, shared across clients** is the simplest approach (the poller reads `client_id` from the message, not the queue).
- If Amazon sends messages to a shared queue, you need to route by `clientId` in the message body — check the Marketing Stream schema when testing.
- If message volume grows, consider one queue per client/dataset combo (more SQS queues but simpler routing).

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| No messages after 2+ hours | Subscription not confirmed — check if `SubscriptionConfirmation` was ACKed by the poller |
| `[Stream] Failed to load subscriptions` | `stream_subscriptions` table doesn't exist — run migration 005 |
| `CredentialsProviderError` | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` not set in `.env` |
| `AccessDenied` from SQS | IAM policy too restrictive — check queue ARN pattern matches policy |
| Data in SQS but not Snowflake | Check `batchMerge` error logs — likely a schema mismatch |
