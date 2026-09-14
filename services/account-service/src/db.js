const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'account.db'));
db.pragma('journal_mode = WAL');

// Base de datos propia y aislada de este microservicio (Database-per-Service)
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  cuenta TEXT PRIMARY KEY,
  balance REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idempotency_key, operation)
);

CREATE TABLE IF NOT EXISTS saga_commits (
  saga_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  cuenta TEXT NOT NULL,
  importe REAL NOT NULL,
  compensated INTEGER DEFAULT 0,
  PRIMARY KEY (saga_id, operation)
);
`);

const DEFAULT_BALANCE = parseFloat(process.env.DEFAULT_BALANCE || '5000000');

function getOrCreateAccount(cuenta) {
  let row = db.prepare('SELECT * FROM accounts WHERE cuenta = ?').get(cuenta);
  if (!row) {
    db.prepare('INSERT INTO accounts (cuenta, balance) VALUES (?, ?)').run(cuenta, DEFAULT_BALANCE);
    row = { cuenta, balance: DEFAULT_BALANCE };
  }
  return row;
}

function adjustBalance(cuenta, delta) {
  getOrCreateAccount(cuenta);
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE cuenta = ?').run(delta, cuenta);
  return getOrCreateAccount(cuenta).balance;
}

function getBalance(cuenta) {
  return getOrCreateAccount(cuenta).balance;
}

function getIdempotent(key, operation) {
  if (!key) return null;
  const row = db.prepare('SELECT result FROM idempotency WHERE idempotency_key = ? AND operation = ?').get(key, operation);
  return row ? { result: JSON.parse(row.result) } : null;
}

function saveIdempotent(key, operation, result) {
  if (!key) return;
  db.prepare(`
    INSERT OR REPLACE INTO idempotency (idempotency_key, operation, result)
    VALUES (?, ?, ?)
  `).run(key, operation, JSON.stringify(result));
}

function recordCommit(sagaId, operation, cuenta, importe) {
  db.prepare(`
    INSERT OR REPLACE INTO saga_commits (saga_id, operation, cuenta, importe, compensated)
    VALUES (?, ?, ?, ?, 0)
  `).run(sagaId, operation, cuenta, importe);
}

function getCommit(sagaId, operation) {
  return db.prepare('SELECT * FROM saga_commits WHERE saga_id = ? AND operation = ?').get(sagaId, operation);
}

function markCompensated(sagaId, operation) {
  db.prepare('UPDATE saga_commits SET compensated = 1 WHERE saga_id = ? AND operation = ?').run(sagaId, operation);
}

module.exports = {
  getOrCreateAccount,
  adjustBalance,
  getBalance,
  getIdempotent,
  saveIdempotent,
  recordCommit,
  getCommit,
  markCompensated,
};
