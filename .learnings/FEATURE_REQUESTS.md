# FEATURE_REQUESTS.md — Ash's Feature Request Log

---

## [FEAT-20260325-001] gtm-plan

**Logged**: 2026-03-25T05:30:00Z
**Priority**: high
**Status**: pending
**Area**: docs

### Requested Capability
Go-to-market plan for Calbridge Starter tier — target 1000 brands at $149/mo

### User Context
Abe wants to take the portal from consulting-bundled to self-serve SaaS. Needs a concrete GTM strategy covering ICP, channels, messaging, and execution plan.

### Complexity Estimate
medium

### Suggested Implementation
Needs more info from Abe first:
- Current client count + case study availability
- Abe's existing audience/distribution
- Timeline to 1000 brands
- ICP definition for Starter (solo sellers? small teams? revenue range?)

### Metadata
- Frequency: first_time
- Related Features: billing tiers, onboarding flow

---

## [FEAT-20260325-002] bullmq-job-queue

**Logged**: 2026-03-25T05:27:00Z
**Priority**: high
**Status**: pending
**Area**: backend

### Requested Capability
Replace setInterval scheduler with BullMQ + Redis job queue for scale

### User Context
Abe wants to sign up 1000 brands. Current scheduler runs in the Express process, has no persistence, no concurrency control, and will fall over at scale.

### Complexity Estimate
complex

### Suggested Implementation
- Install BullMQ + ioredis
- Redis on same Azure VM (free)
- Migrate ingestionRunner jobs to BullMQ workers
- Add job visibility to ash-ops dashboard
- Concurrency limit: max 10 ingestion jobs at once
- Rate limiting per client built in

### Metadata
- Frequency: first_time
- Related Features: scheduler.js, ingestionRunner.js, ash-ops dashboard
