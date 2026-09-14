const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'risk.db'));
db.pragma('journal_mode = WAL');

// Base de datos propia y aislada de este microservicio (Database-per-Service)
db.exec(`
CREATE TABLE IF NOT EXISTS idempotency (
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idempotency_key, operation)
);

CREATE TABLE IF NOT EXISTS saga_commits (
  saga_id TEXT PRIMARY KEY,
  origen TEXT,
  importe REAL,
  compensated INTEGER DEFAULT 0
);
`);

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

function recordCommit(sagaId, origen, importe) {
  db.prepare(`
    INSERT OR REPLACE INTO saga_commits (saga_id, origen, importe, compensated)
    VALUES (?, ?, ?, 0)
  `).run(sagaId, origen, importe);
}

function getCommit(sagaId) {
  return db.prepare('SELECT * FROM saga_commits WHERE saga_id = ?').get(sagaId);
}

function markCompensated(sagaId) {
  db.prepare('UPDATE saga_commits SET compensated = 1 WHERE saga_id = ?').run(sagaId);
}

module.exports = { getIdempotent, saveIdempotent, recordCommit, getCommit, markCompensated };
