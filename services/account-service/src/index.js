require('dotenv').config();
const express = require('express');
const cors = require('cors');

const domain = require('./domain');
const bus = require('./bus');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4002;

// ---------------------------------------------------------------------------
// Entradas REST: usadas por el orchestrator-service en el modo ORQUESTADO
// ---------------------------------------------------------------------------
app.post('/debit', async (req, res) => {
  try {
    const { sagaId, idempotencyKey, cuenta, importe, mode } = req.body;
    const result = await domain.performDebit({ sagaId, idempotencyKey, cuenta, importe, mode: mode || 'orchestrated' });
    res.json(result);
  } catch (err) {
    console.error('[account-service] error en /debit:', err.message);
    res.status(500).json({ ok: false, reason: 'ERROR_INTERNO' });
  }
});

app.post('/compensate-debit', async (req, res) => {
  try {
    const { sagaId, mode } = req.body;
    const result = await domain.compensateDebit({ sagaId, mode: mode || 'orchestrated' });
    res.json(result);
  } catch (err) {
    console.error('[account-service] error en /compensate-debit:', err.message);
    res.status(500).json({ ok: false });
  }
});

app.post('/credit', async (req, res) => {
  try {
    const { sagaId, idempotencyKey, cuenta, importe, mode } = req.body;
    const result = await domain.performCredit({ sagaId, idempotencyKey, cuenta, importe, mode: mode || 'orchestrated' });
    res.json(result);
  } catch (err) {
    console.error('[account-service] error en /credit:', err.message);
    res.status(500).json({ ok: false, reason: 'ERROR_INTERNO' });
  }
});

app.get('/balance/:cuenta', (req, res) => {
  res.json({ cuenta: req.params.cuenta, balance: db.getBalance(req.params.cuenta) });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'account-service' }));

// ---------------------------------------------------------------------------
// Consumidores de eventos: usados en el modo COREOGRAFIADO.
// Reutilizan exactamente la misma logica de dominio que la via REST, sin
// que exista ningun coordinador central: el servicio reacciona de forma
// autonoma a los eventos que le interesan y publica el siguiente evento.
// ---------------------------------------------------------------------------
async function startChoreographyConsumers() {
  // 1) Se solicito una transferencia -> intento debitar la cuenta origen
  await bus.subscribe(['TransferenciaSolicitada'], async (_eventType, payload) => {
    const { sagaId, idempotencyKey, origen, importe } = payload;
    const result = await domain.performDebit({ sagaId, idempotencyKey, cuenta: origen, importe, mode: 'choreographed' });
    if (result.ok) {
      await bus.publish('SaldoDebitado', payload);
    } else {
      await bus.publish('TransferenciaFallida', { ...payload, reason: result.reason, failedStep: 'debito' });
    }
  });

  // 2) La pasarela interbancaria confirmo la liquidacion -> acredito destino
  await bus.subscribe(['LiquidacionConfirmada'], async (_eventType, payload) => {
    const { sagaId, idempotencyKey, destino, importe } = payload;
    const creditKey = idempotencyKey ? `${idempotencyKey}-credito` : undefined;
    const result = await domain.performCredit({ sagaId, idempotencyKey: creditKey, cuenta: destino, importe, mode: 'choreographed' });
    if (result.ok) {
      await bus.publish('SagaConfirmada', payload);
    } else {
      await bus.publish('TransferenciaFallida', { ...payload, reason: 'ERROR_CREDITO_DESTINO', failedStep: 'credito' });
    }
  });

  // 3) Cualquier fallo en la saga -> si yo ya debite para ese sagaId, compenso.
  // Totalmente autonomo: no depende de "failedStep", solo de si este servicio
  // tiene un commit propio pendiente de compensar.
  await bus.subscribe(['TransferenciaFallida'], async (_eventType, payload) => {
    await domain.compensateDebit({ sagaId: payload.sagaId, mode: 'choreographed' });
  });
}

startChoreographyConsumers().catch((err) => {
  console.error('[account-service] error iniciando consumidores de coreografia:', err.message);
});

app.listen(PORT, () => console.log(`[account-service] escuchando en puerto ${PORT}`));
