# LEARNINGS.md — Ash's Continuous Improvement Log

---

## [LRN-20260325-001] knowledge_gap

**Logged**: 2026-03-25T05:39:00Z
**Priority**: high
**Status**: resolved

### Summary
Failed to check codebase before asking Abe about pricing tiers that were already defined in billing.js

### Details
Abe asked about GTM for the Starter tier. I asked "do you remember the pricing?" when the full plan definitions (Starter $149, Growth $299, Pro $499) were sitting in `src/routes/billing.js` the whole time. Should have grepped the codebase first.

### Suggested Action
Before asking Abe about product/business details, always check: billing.js, MEMORY.md, memory/*.md, and do a codebase search.

### Resolution
- **Resolved**: 2026-03-25T05:35:00Z
- **Notes**: Found pricing in billing.js, updated MEMORY.md with full tier details

### Metadata
- Source: user_feedback
- Related Files: src/routes/billing.js, MEMORY.md
- Tags: memory, product-knowledge, codebase-search

---

## [LRN-20260325-002] knowledge_gap

**Logged**: 2026-03-25T05:39:00Z
**Priority**: high
**Status**: resolved

### Summary
Business context from prior sessions not captured in memory, causing repeated questions

### Details
Abe said "Why don't you remember any of this stuff? We talked about it before." Session memory wasn't being written to MEMORY.md or daily memory files, so product context, GTM discussions, and business goals were lost between sessions.

### Suggested Action
At the end of every substantive session: write key facts, decisions, and context to memory/YYYY-MM-DD.md and promote important items to MEMORY.md. Don't rely on session context surviving.

### Resolution
- **Resolved**: 2026-03-25T05:32:00Z
- **Notes**: Created MEMORY.md with full Calbridge business context

### Metadata
- Source: user_feedback
- Related Files: MEMORY.md, memory/2026-03-25.md
- Tags: memory, continuity, session-management

---

## [LRN-20260325-003] best_practice

**Logged**: 2026-03-25T05:39:00Z
**Priority**: high
**Status**: pending

### Summary
Helmet CSP blocks all inline scripts silently — always use external JS files

### Details
All inline `<script>` blocks across the entire app were silently blocked by Helmet's `script-src 'self'` CSP header. No browser error visible to user, buttons just did nothing. Affected platform-costs.html, ash-ops.html, admin.html, billing.html, onboarding.html, brand-setup.html, reset-password.html.

### Suggested Action
Never write inline `<script>` blocks in HTML files for this project. Always use external `/public/js/*.js` files. Add this as a project convention.

### Metadata
- Source: error
- Related Files: public/*.html, public/js/*, src/app.js
- Tags: csp, helmet, frontend, security
- Pattern-Key: harden.no-inline-scripts
