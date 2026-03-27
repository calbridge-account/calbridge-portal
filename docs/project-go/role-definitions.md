# User Role Definitions

For use in FAQ, onboarding guides, and help documentation.

## Roles

| Role | Description | Audience |
|---|---|---|
| `viewer` | Read-only access to reporting and dashboards | Client team members, stakeholders |
| `analyst` | Reporting + view AI recommendations (cannot approve) | Client analysts, marketing managers |
| `manager` | Full campaign management, AI enrollment, approve changes | Calbridge account managers |
| `admin` | Everything including billing, credentials, client setup | Calbridge leadership |
| `super_admin` | System-level access across all clients | Calbridge engineering/ops |

## Permission Matrix

| Feature | viewer | analyst | manager | admin | super_admin |
|---|---|---|---|---|---|
| Dashboard & reporting | ✅ | ✅ | ✅ | ✅ | ✅ |
| PDF export | ✅ | ✅ | ✅ | ✅ | ✅ |
| View AI recommendations | ❌ | ✅ | ✅ | ✅ | ✅ |
| Approve AI recommendations | ❌ | ❌ | ✅ | ✅ | ✅ |
| Campaign management | ❌ | ❌ | ✅ | ✅ | ✅ |
| AI enrollment & groups | ❌ | ❌ | ✅ | ✅ | ✅ |
| Dayparting scheduler | ❌ | ❌ | ✅ | ✅ | ✅ |
| Account setup / credentials | ❌ | ❌ | ❌ | ✅ | ✅ |
| Billing | ❌ | ❌ | ❌ | ✅ | ✅ |
| Multi-client access | ❌ | ❌ | ❌ | ❌ | ✅ |

## Notes
- `viewer` and `analyst` are client-facing roles only
- `manager`, `admin`, `super_admin` are Calbridge internal roles only
- Clients never see campaign management, AI management, or setup features
- White-label agencies get their own `admin` scoped to their client_id hierarchy only
