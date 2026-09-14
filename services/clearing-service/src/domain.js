const db = require('./db');
const { postAudit } = require('./audit');

const DELAY_MIN = parseInt(process.env.DELAY_MIN_MS || '2000', 10);
const DELAY_MAX = parseInt(process.env.DELAY_MAX_MS || '4000', 10);

function randomDelay() {
  const ms = Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Paso 3 de la saga: liquidacion / compensacion bancaria externa simulada
async function settleClearing({ sagaId, idempotencyKey, destino, importe, simulateNetworkFailure, mode }) {
  const existing = db.getIdempotent(idempotencyKey, 'clearing');
  if (existing) {
    await postAudit({
      sagaId, mode, service: 'clearing-service', step: 'liquidacion-interbancaria', status: 'idempotente',
      message: `Liquidacion duplicada detectada; no se repite.`,
    });
    return existing.result;
  }

  await postAudit({
    sagaId, mode, service: 'clearing-service', step: 'liquidacion-interbancaria', status: 'running',
    message: `Enviando instruccion de liquidacion a la red interbancaria para acreditar a ${destino}...`,
  });
  await randomDelay();

  if (simulateNetworkFailure) {
    const result = { ok: false, reason: 'RED_FALLO' };
    db.saveIdempotent(idempotencyKey, 'clearing', result);
    await postAudit({
      sagaId, mode, service: 'clearing-service', step: 'liquidacion-interbancaria', status: 'failed',
      message: `Timeout / caida de red simulada al contactar la pasarela interbancaria externa.`,
    });
    return result;
  }

  db.recordCommit(sagaId, destino, importe);
  const result = { ok: true };
  db.saveIdempotent(idempotencyKey, 'clearing', result);
  await postAudit({
    sagaId, mode, service: 'clearing-service', step: 'liquidacion-interbancaria', status: 'success',
    message: `Liquidacion confirmada por la red interbancaria.`,
  });
  return result;
}

// Compensacion del paso 3: notifica la anulacion de la liquidacion (registro de auditoria)
async function compensateClearing({ sagaId, mode }) {
  const commit = db.getCommit(sagaId);
  if (!commit || commit.compensated) {
    return { ok: true, skipped: true };
  }

  await postAudit({
    sagaId, mode, service: 'clearing-service', step: 'compensacion-liquidacion', status: 'running',
    message: `Notificando anulacion de la liquidacion a la red interbancaria...`,
  });
  await randomDelay();

  db.markCompensated(sagaId);

  await postAudit({
    sagaId, mode, service: 'clearing-service', step: 'compensacion-liquidacion', status: 'compensated',
    message: `Anulacion de la liquidacion confirmada y registrada en la bitacora de auditoria.`,
  });
  return { ok: true };
}

module.exports = { settleClearing, compensateClearing };
