const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'audit.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  saga_id TEXT NOT NULL,
  mode TEXT,
  service TEXT,
  step TEXT,
  status TEXT,
  message TEXT,
  timestamp TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_saga ON events (saga_id);
`);

function saveEvent(event) {
  const info = db.prepare(`
    INSERT INTO events (saga_id, mode, service, step, status, message, timestamp)
    VALUES (@sagaId, @mode, @service, @step, @status, @message, @timestamp)
  `).run({
    sagaId: event.sagaId,
    mode: event.mode || null,
    service: event.service || null,
    step: event.step,
    status: event.status,
    message: event.message || null,
    timestamp: event.timestamp,
  });
  return { id: info.lastInsertRowid, ...event };
}

function getEvents(sagaId) {
  return db.prepare('SELECT * FROM events WHERE saga_id = ? ORDER BY id ASC').all(sagaId);
}

module.exports = { saveEvent, getEvents };
