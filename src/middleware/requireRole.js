/**
 * Role-based access control middleware.
 *
 * Role hierarchy (ascending privilege):
 *   viewer < analyst < manager < owner
 *
 * Usage:
 *   router.patch('/profile', requireAuth, requireRole('manager'), handler)
 */
'use strict';

const ROLE_LEVELS = { viewer: 1, analyst: 2, manager: 3, owner: 4 };

/**
 * Returns middleware that requires the session role to be >= minRole.
 * Falls back to 'owner' if no role is set (backwards-compat for existing sessions).
 */
function requireRole(minRole) {
  return (req, res, next) => {
    const role  = req.session?.userRole || 'owner';
    const level = ROLE_LEVELS[role]    ?? 4;
    const min   = ROLE_LEVELS[minRole] ?? 1;
    if (level >= min) return next();
    return res.status(403).json({
      error:    'Insufficient permissions',
      required: minRole,
      current:  role,
    });
  };
}

module.exports = { requireRole, ROLE_LEVELS };
