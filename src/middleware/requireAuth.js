/**
 * Middleware: require an authenticated session.
 * Attach to any route that needs a logged-in client.
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.clientId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

module.exports = { requireAuth };
