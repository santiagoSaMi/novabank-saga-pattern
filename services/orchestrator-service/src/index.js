require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const { postAudit } = require('./audit');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4001;

const ACCOUNT_URL = process.env.ACCOUNT_URL || 'http://account-service:4002';
const RISK_URL = process.env.RISK_URL || 'http://risk-service:4003';
const CLEARING_URL = process.env.CLEARING_URL || 'http://clearing-service:4004';

// ---------------------------------------------------------------------------
// Saga Orquestada: este coordinador central le indica explicitamente a cada
// servicio que accion ejecutar y, ante un fallo, llama el mismo, en orden
// inverso, a los endpoints de compensacion de los servicios que ya habian
// tenido exito.
// ---------------------------------------------------------------------------
async function runOrchestratedSaga(payload) {
  const { sagaId, idempotencyKey, origen, destino, importe, simulateFraud, simulateNetworkFailure } = payload;
  const mode = 'orchestrated';

  await postAudit({
    sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'running',
    message: `Saga orquestada iniciada: transferir ${importe} de ${origen} a ${destino}.`,
  });

  // Paso 1: Debito en la cuenta origen
  const debit = await axios.post(`${ACCOUNT_URL}/debit`, { sagaId, idempotencyKey, cuenta: origen, importe, mode });
  if (!debit.data.ok) {
    await postAudit({
      sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'failed',
      message: `Saga rechazada en el primer paso: ${debit.data.reason}. No se requieren compensaciones.`,
    });
    return { estado: 'RECHAZADO_FONDOS' };
  }

  // Paso 2: Validacion de riesgo / antifraude
  const risk = await axios.post(`${RISK_URL}/validate`, { sagaId, idempotencyKey, origen, importe, simulateFraud, mode });
  if (!risk.data.ok) {
    await postAudit({
      sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'compensating',
      message: 'Riesgo rechazo la operacion. Orquestando compensacion en orden inverso...',
    });
    await axios.post(`${ACCOUNT_URL}/compensate-debit`, { sagaId, mode });
    await postAudit({
      sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'failed',
      message: `Saga rechazada: ${risk.data.reason}.`,
    });
    return { estado: 'RECHAZADO_RIESGO' };
  }

  // Paso 3: Liquidacion / compensacion interbancaria externa
  const clearing = await axios.post(`${CLEARING_URL}/settle`, { sagaId, idempotencyKey, destino, importe, simulateNetworkFailure, mode });
  if (!clearing.data.ok) {
    await postAudit({
      sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'compensating',
      message: 'Fallo en la pasarela interbancaria. Orquestando compensacion en orden inverso...',
    });
    await axios.post(`${RISK_URL}/compensate`, { sagaId, mode });
    await axios.post(`${ACCOUNT_URL}/compensate-debit`, { sagaId, mode });
    await postAudit({
      sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'failed',
      message: `Saga rechazada: ${clearing.data.reason}.`,
    });
    return { estado: 'RECHAZADO_RED' };
  }

  // Paso 4: Credito en la cuenta destino
  const creditKey = idempotencyKey ? `${idempotencyKey}-credito` : undefined;
  const credit = await axios.post(`${ACCOUNT_URL}/credit`, { sagaId, idempotencyKey: creditKey, cuenta: destino, importe, mode });
  if (!credit.data.ok) {
    await postAudit({
      sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'compensating',
      message: 'Fallo al acreditar la cuenta destino. Orquestando compensacion total en orden inverso...',
    });
    await axios.post(`${CLEARING_URL}/compensate`, { sagaId, mode });
    await axios.post(`${RISK_URL}/compensate`, { sagaId, mode });
    await axios.post(`${ACCOUNT_URL}/compensate-debit`, { sagaId, mode });
    await postAudit({
      sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'failed',
      message: 'Saga rechazada: error al acreditar la cuenta destino.',
    });
    return { estado: 'RECHAZADO_ERROR_CREDITO' };
  }

  await postAudit({
    sagaId, mode, service: 'orchestrator-service', step: 'saga', status: 'success',
    message: 'Saga confirmada: transferencia completada con exito de extremo a extremo.',
  });
  return { estado: 'CONFIRMADO' };
}

// Se responde de inmediato con 202 para que el frontend pueda suscribirse a
// los eventos en tiempo real desde el primer instante; la saga se ejecuta
// en segundo plano y reporta su avance via el servicio de auditoria.
app.post('/saga', (req, res) => {
  res.status(202).json({ sagaId: req.body.sagaId, estado: 'PROCESANDO' });

  runOrchestratedSaga(req.body).catch(async (err) => {
    console.error('[orchestrator-service] error ejecutando saga:', err.message);
    await postAudit({
      sagaId: req.body.sagaId, mode: 'orchestrated', service: 'orchestrator-service', step: 'saga', status: 'failed',
      message: `Error interno del orquestador: ${err.message}`,
    });
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'orchestrator-service' }));

app.listen(PORT, () => console.log(`[orchestrator-service] escuchando en puerto ${PORT}`));
