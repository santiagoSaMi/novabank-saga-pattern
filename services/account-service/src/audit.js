const axios = require('axios');

const AUDIT_URL = process.env.AUDIT_URL || 'http://audit-service:4005';

// Publica un evento de auditoria/observabilidad. Nunca debe tumbar el flujo
// principal de la saga si el servicio de auditoria esta temporalmente caido.
async function postAudit(event) {
  try {
    await axios.post(`${AUDIT_URL}/events`, { ...event, timestamp: new Date().toISOString() }, { timeout: 5000 });
  } catch (err) {
    console.error(`[audit] no se pudo registrar evento (${event.step}/${event.status}):`, err.message);
  }
}

module.exports = { postAudit };
