const db = require('./db');
const { postAudit } = require('./audit');

const DELAY_MIN = parseInt(process.env.DELAY_MIN_MS || '2000', 10);
const DELAY_MAX = parseInt(process.env.DELAY_MAX_MS || '4000', 10);

// Simula latencia real de procesamiento bancario (2-4s configurable) para que
// la capa de observabilidad pueda mostrar el estado "en ejecucion" con claridad.
function randomDelay() {
  const ms = Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Paso 1 de la saga: debito de la cuenta origen
async function performDebit({ sagaId, idempotencyKey, cuenta, importe, mode }) {
  const existing = db.getIdempotent(idempotencyKey, 'debit');
  if (existing) {
    await postAudit({
      sagaId, mode, service: 'account-service', step: 'debito-cuenta-origen', status: 'idempotente',
      message: `Solicitud duplicada detectada (idempotencyKey=${idempotencyKey}); no se repite el debito.`,
    });
    return existing.result;
  }

  await postAudit({
    sagaId, mode, service: 'account-service', step: 'debito-cuenta-origen', status: 'running',
    message: `Verificando fondos y debitando ${importe} de la cuenta ${cuenta}...`,
  });
  await randomDelay();

  const account = db.getOrCreateAccount(cuenta);
  if (account.balance < importe) {
    const result = { ok: false, reason: 'FONDOS_INSUFICIENTES' };
    db.saveIdempotent(idempotencyKey, 'debit', result);
    await postAudit({
      sagaId, mode, service: 'account-service', step: 'debito-cuenta-origen', status: 'failed',
      message: `Fondos insuficientes en ${cuenta} (saldo: ${account.balance}, solicitado: ${importe}).`,
    });
    return result;
  }

  const newBalance = db.adjustBalance(cuenta, -importe);
  db.recordCommit(sagaId, 'debit', cuenta, importe);
  const result = { ok: true };
  db.saveIdempotent(idempotencyKey, 'debit', result);
  await postAudit({
    sagaId, mode, service: 'account-service', step: 'debito-cuenta-origen', status: 'success',
    message: `Debito de ${importe} realizado en ${cuenta}. Nuevo saldo: ${newBalance}.`,
  });
  return result;
}

// Compensacion del paso 1: reintegra el dinero debitado si una fase posterior falla
async function compensateDebit({ sagaId, mode }) {
  const commit = db.getCommit(sagaId, 'debit');
  if (!commit || commit.compensated) {
    return { ok: true, skipped: true };
  }

  await postAudit({
    sagaId, mode, service: 'account-service', step: 'compensacion-debito-cuenta-origen', status: 'running',
    message: `Revirtiendo debito de ${commit.importe} en ${commit.cuenta}...`,
  });
  await randomDelay();

  const newBalance = db.adjustBalance(commit.cuenta, commit.importe);
  db.markCompensated(sagaId, 'debit');

  await postAudit({
    sagaId, mode, service: 'account-service', step: 'compensacion-debito-cuenta-origen', status: 'compensated',
    message: `Saldo reintegrado en ${commit.cuenta}. Nuevo saldo: ${newBalance}.`,
  });
  return { ok: true };
}

// Paso final de la saga: credito en la cuenta destino, una vez confirmada la liquidacion
async function performCredit({ sagaId, idempotencyKey, cuenta, importe, mode }) {
  const existing = db.getIdempotent(idempotencyKey, 'credit');
  if (existing) {
    await postAudit({
      sagaId, mode, service: 'account-service', step: 'credito-cuenta-destino', status: 'idempotente',
      message: `Solicitud de credito duplicada detectada; no se repite.`,
    });
    return existing.result;
  }

  await postAudit({
    sagaId, mode, service: 'account-service', step: 'credito-cuenta-destino', status: 'running',
    message: `Acreditando ${importe} a la cuenta ${cuenta}...`,
  });
  await randomDelay();

  db.getOrCreateAccount(cuenta);
  const newBalance = db.adjustBalance(cuenta, importe);
  db.recordCommit(sagaId, 'credit', cuenta, importe);
  const result = { ok: true };
  db.saveIdempotent(idempotencyKey, 'credit', result);
  await postAudit({
    sagaId, mode, service: 'account-service', step: 'credito-cuenta-destino', status: 'success',
    message: `Credito aplicado en ${cuenta}. Nuevo saldo: ${newBalance}.`,
  });
  return result;
}

module.exports = { performDebit, compensateDebit, performCredit, randomDelay };
