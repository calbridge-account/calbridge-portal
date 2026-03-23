const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

/**
 * In-memory store for development/sandbox.
 * Replace with Postgres queries when DB is wired up.
 */
const clients = new Map();

async function signup({ email, password, name }) {
  const existing = [...clients.values()].find(c => c.email === email);
  if (existing) {
    const err = new Error('EMAIL_TAKEN');
    err.status = 409;
    throw err;
  }
  const hash = await bcrypt.hash(password, 12);
  const client = {
    id: uuidv4(),
    email,
    name,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
    connections: {}    // keyed by type: ads | dsp | seller | vendor
  };
  clients.set(client.id, client);
  return client;
}

async function login({ email, password }) {
  const client = [...clients.values()].find(c => c.email === email);
  if (!client) throw new Error('INVALID_CREDENTIALS');
  const valid = await bcrypt.compare(password, client.passwordHash);
  if (!valid) throw new Error('INVALID_CREDENTIALS');
  return client;
}

async function getById(id) {
  const client = clients.get(id);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }
  return client;
}

async function updateClient(id, updates) {
  const client = clients.get(id);
  if (!client) throw new Error('Client not found');
  Object.assign(client, updates);
  clients.set(id, client);
  return client;
}

module.exports = { signup, login, getById, updateClient };
