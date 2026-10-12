// auth.js - password hashing and token session helpers.
//
// Passwords: salted scrypt (crypto.scryptSync + 16-byte random salt).
// Stored as salt (hex) and hash (hex). Never store plaintext.
// Sessions: 32-byte random token issued at login, kept server-side in the
// sessions table. Clients send it as "Authorization: Bearer <token>".

const crypto = require('crypto');
const db = require('./db');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(storedHash, 'hex');
  // timingSafeEqual guards against timing attacks; lengths must match.
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.createSession(userId, token);
  return token;
}

// Express middleware: require a valid Bearer token on protected routes.
// Attaches req.user ({ id, name, email }) on success; 401 otherwise.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const session = db.getSession(match[1]);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const user = db.getUserById(session.user_id);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = { id: user.id, name: user.name, email: user.email };
  next();
}

module.exports = { hashPassword, verifyPassword, issueToken, requireAuth };
