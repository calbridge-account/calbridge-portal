# ERRORS.md — Ash's Error Log

---

## [ERR-20260325-001] snowflake-storage-query

**Logged**: 2026-03-25T04:48:00Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Wrong column name used for Snowflake STORAGE_USAGE table

### Error
SQL compilation error: error line 3 at position 10 invalid identifier 'AVERAGE_STAGE_BYTES'

### Context
- Query: `SELECT AVERAGE_STAGE_BYTES / ... FROM SNOWFLAKE.ACCOUNT_USAGE.STORAGE_USAGE`
- Actual column name is `STAGE_BYTES` not `AVERAGE_STAGE_BYTES`

### Suggested Fix
Always verify Snowflake column names with `SELECT * FROM <table> LIMIT 1` before writing queries against ACCOUNT_USAGE views.

### Resolution
- **Resolved**: 2026-03-25T04:50:00Z
- **Commit**: 39f468c
- **Notes**: Changed AVERAGE_STAGE_BYTES → STAGE_BYTES

### Metadata
- Reproducible: yes
- Related Files: src/routes/adminOps.js
- Tags: snowflake, sql, column-names

---

## [ERR-20260325-002] azure-tenant-id

**Logged**: 2026-03-25T04:43:00Z
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
Wrong Azure tenant ID — Directory ID from App Registration != Tenant ID from Tenant Properties

### Error
AADSTS90002: Tenant '2e14e950-...' not found

### Context
- Used Directory ID from App Registrations page
- Correct ID comes from Azure Portal → Search "Tenant Properties" → Tenant ID
- These can be different when account uses Microsoft personal account (MSA)

### Suggested Fix
Always get Azure Tenant ID from Tenant Properties page, not from the App Registration directory ID.

### Resolution
- **Resolved**: 2026-03-25T04:45:00Z
- **Notes**: Correct tenant ID: d01026fb-c90a-4a64-8671-35c39410069e

### Metadata
- Reproducible: yes
- Related Files: .env, src/routes/adminOps.js
- Tags: azure, auth, tenant
