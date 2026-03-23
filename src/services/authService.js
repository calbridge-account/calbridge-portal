const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('./snowflakeService');

/**
 * Auth service — Snowflake-backed client accounts
 */

async function signup({ email, password, name }) {
  email = email.toLowerCase().trim();
  // Check existing
  const existing = await query(
    `SELECT client_id FROM clients WHERE email = ?`, [email]
  );
  if (existing.length) {
    const err = new Error('EMAIL_TAKEN'); err.status = 409; throw err;
  }

  const id = uuidv4();
  const hash = await bcrypt.hash(password, 12);

  await query(`
    INSERT INTO clients (client_id, email, name, password_hash, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [id, email, name, hash]);

  return { id, email, name };
}

async function login({ email, password }) {
  email = email.toLowerCase().trim();
  const rows = await query(
    `SELECT client_id, email, name, password_hash FROM clients WHERE email = ?`, [email]
  );
  if (!rows.length) throw new Error('INVALID_CREDENTIALS');
  const row = rows[0];
  const valid = await bcrypt.compare(password, row.PASSWORD_HASH);
  if (!valid) throw new Error('INVALID_CREDENTIALS');
  return { id: row.CLIENT_ID, email: row.EMAIL, name: row.NAME };
}

async function getById(id) {
  const rows = await query(
    `SELECT client_id, email, name, connections FROM clients WHERE client_id = ?`, [id]
  );
  if (!rows.length) {
    const err = new Error('Client not found'); err.status = 404; throw err;
  }
  const row = rows[0];
  return {
    id: row.CLIENT_ID,
    email: row.EMAIL,
    name: row.NAME,
    connections: row.CONNECTIONS
      ? (typeof row.CONNECTIONS === 'string' ? JSON.parse(row.CONNECTIONS) : row.CONNECTIONS)
      : {}
  };
}

async function updateClient(id, updates) {
  if (updates.connections !== undefined) {
    const val = typeof updates.connections === 'string'
      ? updates.connections
      : JSON.stringify(updates.connections);
    await query(`UPDATE clients SET connections = PARSE_JSON(?) WHERE client_id = ?`, [val, id]);
  }
  return getById(id);
}

module.exports = { signup, login, getById, updateClient };
