const db = require('./db');
const { postAudit } = require('./audit');

const DELAY_MIN = parseInt(process.env.DELAY_MIN_MS || '2000', 10);
const DELAY_MAX = parseInt(process.env.DELAY_MAX_MS || '4000', 10);
const DAILY_LIMIT = parseFloat(process.env.DAILY_LIMIT || '50000000');

function randomDelay() {
  const ms = Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Paso 2 de la saga: validacion de riesgo / antifraude
async function validateRisk({ sagaId, idempotencyKey, origen, importe, simulateFraud, mode }) {
  const existing = db.getIdempotent(idempotencyKey, 'risk');
  if (existing) {
    await postAudit({
      sagaId, mode, service: 'risk-service', step: 'validacion-riesgo', status: 'idempotente',
      message: `Validacion duplicada detectada; no se repite.`,
    });
    return existing.result;
  }

  await postAudit({
    sagaId, mode, service: 'risk-service', step: 'validacion-riesgo', status: 'running',
    message: `Analizando reglas antifraude y limites diarios para la cuenta ${origen}...`,
  });
  await randomDelay();

  if (simulateFraud) {
    const result = { ok: false, reason: 'RIESGO_RECHAZADO' };
    db.saveIdempotent(idempotencyKey, 'risk', result);
    await postAudit({
      sagaId, mode, service: 'risk-service', step: 'validacion-riesgo', status: 'failed',
      message: `Operacion marcada como sospechosa de fraude por el simulador de caos. Rechazada.`,
    });
    return result;
  }

  if (importe > DAILY_LIMIT) {
    const result = { ok: false, reason: 'LIMITE_DIARIO_EXCEDIDO' };
    db.saveIdempotent(idempotencyKey, 'risk', result);
    await postAudit({
      sagaId, mode, service: 'risk-service', step: 'validacion-riesgo', status: 'failed',
      message: `El importe ${importe} supera el limite diario permitido (${DAILY_LIMIT}).`,
    });
    return result;
  }

  db.recordCommit(sagaId, origen, importe);
  const result = { ok: true };
  db.saveIdempotent(idempotencyKey, 'risk', result);
  await postAudit({
    sagaId, mode, service: 'risk-service', step: 'validacion-riesgo', status: 'success',
    message: `Operacion aprobada por el motor de riesgo para la cuenta ${origen}.`,
  });
  return result;
}

// Compensacion del paso 2: anula la aprobacion de riesgo (no mueve dinero, solo bitacora)
async function compensateRisk({ sagaId, mode }) {
  const commit = db.getCommit(sagaId);
  if (!commit || commit.compensated) {
    return { ok: true, skipped: true };
  }

  await postAudit({
    sagaId, mode, service: 'risk-service', step: 'compensacion-riesgo', status: 'running',
    message: `Anulando aprobacion de riesgo previamente emitida...`,
  });
  await randomDelay();

  db.markCompensated(sagaId);

  await postAudit({
    sagaId, mode, service: 'risk-service', step: 'compensacion-riesgo', status: 'compensated',
    message: `Aprobacion de riesgo anulada y registrada en la bitacora de auditoria.`,
  });
  return { ok: true };
}

module.exports = { validateRisk, compensateRisk };
