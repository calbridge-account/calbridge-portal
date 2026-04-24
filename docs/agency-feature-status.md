# Agency/Multi-Brand Feature Status
_Audited: 2026-04-24_

## Feature Matrix

| Feature | Status | Notes |
|---|---|---|
| White-label logo (per-client) | ✅ Built | UI in `account.html`, endpoint `POST /account/logo`, auto-BG removal, stored in `clients.logo_url` |
| White-label logo (per-brand/advertiser) | 🔶 Partial | `advertiser_accounts.logo_url` field exists, served via `/manager/active-advertiser`; no dedicated upload UI for per-brand logo |
| White-label portal branding (name + logo URL input) | 🔶 Partial | `brand-setup.html` has a "White-Label Settings" card (company name + logo URL fields, Scale+ gated), but it renders as a URL text field — no file upload, no preview, not wired to a save endpoint |
| Client login access (sub-client accounts) | ✅ Built | `auth.js` handles `linked_client_id` to look up team-member role; `agency/switch-brand` + `agency/exit-brand` let agency admins enter/exit a brand's session; brand `clients` rows auto-created by `POST /agency/brands` |
| Multi-brand switcher (nav dropdown) | ✅ Built | `#brand-switcher` / `#brand-select` in all dashboard pages; `nav.js` calls `GET /manager/advertisers/list`; agency and manager users see all their brands; switcher hidden for single-brand users |
| Agency brand management portal | ✅ Built | `agency.html` + `GET/POST /agency/brands`; add-brand modal, brand cards with connection status dots, enter/exit brand session via `switch-brand` |
| Portfolio KPI overview (aggregate across brands) | ❌ Missing | No aggregate/rollup endpoint exists. `/manager/advertisers/list` returns a list but no KPI data. Dashboard always scopes to one `clientId` at a time. Billing plan copy mentions "Multi-brand switcher with portfolio overview" but it isn't implemented. |
| Client reporting exports (CSV/PDF) | 🔶 Partial | `pdfkit` (^0.18.0) and `csv-parse` (^6.2.1) are installed. COGS export is built (`GET /cogs/template` returns CSV). Billing plan copy mentions "Report downloads (CSV/PDF)" and "Per-client reporting exports" as Scale+ features — but no `/export`, `/report`, or `/download` route exists for ad or sales data. |

---

## What Works

### ✅ White-label logo upload (per client)
- **UI:** `public/account.html` — "Branding" card with file picker, preview, and remove button.
- **Backend:** `POST /account/logo` (`src/routes/account.js`) — multer upload, 2MB limit, PNG/JPG/SVG/WebP, auto-background removal via `removeBackground` service, stores relative URL in `clients.logo_url`.
- **Delete:** `DELETE /account/logo` clears `logo_url`.
- **Display:** `GET /manager/active-advertiser` returns `logoUrl`; `nav.js` applies it to `#brand-logo` in sidebar across all pages.

### ✅ Client login / team member access
- **Sub-client login:** `auth.js` `POST /auth/login` queries `clients.linked_client_id`; if set, resolves team-member role from parent's `team_members` JSON. Session gets `clientId = parent.clientId` so sub-client sees the same data.
- **Agency session switching:** `POST /agency/switch-brand` validates brand belongs to the agency, saves `agencyClientId` on session, replaces `clientId` with brand's `clientId`. `POST /agency/exit-brand` reverses it.
- **Brand creation with invite:** `POST /agency/brands` creates `manager_accounts`, `advertiser_accounts`, `clients`, `client_migration_map`, and `users` rows, sends invite email if `contactEmail` provided.

### ✅ Multi-brand switcher
- **UI:** `#brand-switcher` / `#brand-select` dropdown rendered in sidebar on `dashboard.html`, `account.html`, `brand-setup.html`, `agency.html`.
- **Backend:** `GET /manager/advertisers/list` — agency-aware, returns all advertisers under the agency; manager-aware for manager-only accounts; falls back to per-marketplace entries for legacy clients.
- **Session:** `POST /manager/advertisers/list?advertiserId=X` (or `__switchAdvertiser()` in nav.js) stores `activeAdvertiserId` in session, downstream data routes scope queries by this.

### ✅ Agency brand management portal
- **UI:** `public/agency.html` — brand grid cards showing name, plan badge, marketplace, connection status (Ads/Seller/Vendor), "Manage →" button (enters brand session).
- **Backend:** `GET /agency/brands` joins `manager_accounts` → `client_migration_map` → `clients` → `advertiser_accounts`, resolves connection status per brand.
- **Add brand:** `POST /agency/brands` — full 5-table provisioning flow.
- **Remove brand:** `DELETE /agency/brands/:managerId` — soft detach (preserves data).
- **Agency admin user management:** `POST /agency/users/invite`, `GET /agency/users`.

### 🔶 COGS CSV export (partial reporting)
- `GET /cogs/template` returns a downloadable CSV template.
- `POST /cogs/upload` parses and stores COGS per ASIN.
- This is the only implemented data export — no ad/sales CSV or PDF reports.

---

## What Needs Work

### ❌ Portfolio KPI overview (biggest gap)
- **Gap:** There is no API endpoint that aggregates KPIs (spend, sales, ROAS, CM) _across_ all brands for an agency or manager in one call.
- **Current state:** `GET /manager/advertisers/list` returns brand metadata (name, marketplace, status) but zero metric data. The agency dashboard (`agency.html`) shows only connection status dots — no revenue, no spend, no ROAS.
- **What's needed:**
  - New endpoint `GET /agency/kpi-summary` (or similar) — queries ad and sales data grouped by `advertiser_id`, returns aggregated KPIs for each brand plus a rollup total.
  - Frontend `agency.html` update to show KPI cards per brand and a total row.
  - Billing plan copy (`billing.js` line 204) already markets this as "Multi-brand switcher with portfolio overview" — the switcher is built; the overview is not.

### 🔶 White-label settings save endpoint
- **Gap:** `brand-setup.html` has a "White-Label Settings" card (Scale+ gated) with inputs for company display name and logo URL — but `saveBrand()` in `brand-setup.js` presumably only saves brand metadata (name, marketplace, etc.) to `PUT /brands/:brandId`. There are no `white_label_name` or `white_label_logo_url` columns in the `brands` table schema, and no endpoint consumes those fields.
- **What's needed:** Add `white_label_name` + `white_label_logo_url` to the `brands` table; wire `brand-setup.js` saveBrand to include them; render white-label name/logo in the portal when the brand's client logs in.

### 🔶 Per-brand logo upload UI
- **Gap:** `advertiser_accounts.logo_url` column exists and is returned by `/manager/active-advertiser`, but there's no file-upload UI or endpoint to set it per-brand. Currently only `clients.logo_url` is settable (via Account Settings).
- **What's needed:** A logo upload component in `brand-setup.html` (similar to the one in `account.html`) that hits a `POST /brands/:brandId/logo` endpoint.

### ❌ Client reporting exports (CSV/PDF)
- **Gap:** `pdfkit` and `csv-parse` are installed, and billing plan copy promises "Report downloads (CSV/PDF)" on Scale and "Per-client reporting exports" on Agency — but there are **zero** export/download routes for advertising or sales data.
- **What's needed:**
  - `GET /reports/advertising/csv?days=30` — flattened campaign/ad data as CSV
  - `GET /reports/kpi/pdf?days=30` — KPI summary rendered with pdfkit
  - Optionally: `GET /agency/brands/:managerId/reports/...` for agency-level per-client exports
  - Download buttons in the dashboard UI (header actions or table footers)

### 🔶 Agency-level white-label (custom domain / portal name)
- **Gap:** `requirePlan.js` mentions "white-label, multi-brand portal" for agency plan, but there is no custom-domain routing, no subdomain logic, and no per-agency portal name configuration.
- **What's needed:** At minimum, a `agency_accounts.white_label_name` + `agency_accounts.logo_url` settable via an agency settings page; at scale, custom subdomain CNAME routing.

---

## Recommended Build Order

1. **Portfolio KPI overview** — highest user value for agency tier; required to make `agency.html` useful beyond a brand list. Estimate: 1 API endpoint + frontend card update.

2. **Client reporting exports (CSV)** — CSV is simpler than PDF, `csv-parse` already in deps. Start with ad data CSV export (most-requested by agencies). Add download button to the advertising table. PDF can follow.

3. **Per-brand logo upload** — small effort (reuse `account.js` upload pattern), high polish impact for agencies managing client portals. Add `POST /brands/:brandId/logo` + upload UI in `brand-setup.html`.

4. **White-label settings save** — wire the existing UI in `brand-setup.html` to actually persist `white_label_name` + `white_label_logo_url`; requires schema migration on `brands` table.

5. **Agency-level white-label (custom domain)** — longest runway, most infrastructure. Defer until the above are solid.
