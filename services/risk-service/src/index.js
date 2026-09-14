require('dotenv').config();
const express = require('express');
const cors = require('cors');

const domain = require('./domain');
const bus = require('./bus');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4003;

// --- REST: usado por el orchestrator-service en modo ORQUESTADO ---
app.post('/validate', async (req, res) => {
  try {
    const { sagaId, idempotencyKey, origen, importe, simulateFraud, mode } = req.body;
    const result = await domain.validateRisk({ sagaId, idempotencyKey, origen, importe, simulateFraud, mode: mode || 'orchestrated' });
    res.json(result);
  } catch (err) {
    console.error('[risk-service] error en /validate:', err.message);
    res.status(500).json({ ok: false, reason: 'ERROR_INTERNO' });
  }
});

app.post('/compensate', async (req, res) => {
  try {
    const { sagaId, mode } = req.body;
    const result = await domain.compensateRisk({ sagaId, mode: mode || 'orchestrated' });
    res.json(result);
  } catch (err) {
    console.error('[risk-service] error en /compensate:', err.message);
    res.status(500).json({ ok: false });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'risk-service' }));

// --- Eventos: usado en modo COREOGRAFIADO, reutiliza la misma logica de dominio ---
async function startChoreographyConsumers() {
  await bus.subscribe(['SaldoDebitado'], async (_eventType, payload) => {
    const { sagaId, idempotencyKey, origen, importe, simulateFraud } = payload;
    const result = await domain.validateRisk({ sagaId, idempotencyKey, origen, importe, simulateFraud, mode: 'choreographed' });
    if (result.ok) {
      await bus.publish('RiesgoAprobado', payload);
    } else {
      await bus.publish('TransferenciaFallida', { ...payload, reason: result.reason, failedStep: 'riesgo' });
    }
  });

  // Autonomo: solo compensa si yo mismo tenia una aprobacion pendiente para ese saga
  await bus.subscribe(['TransferenciaFallida'], async (_eventType, payload) => {
    await domain.compensateRisk({ sagaId: payload.sagaId, mode: 'choreographed' });
  });
}

startChoreographyConsumers().catch((err) => {
  console.error('[risk-service] error iniciando consumidores de coreografia:', err.message);
});

app.listen(PORT, () => console.log(`[risk-service] escuchando en puerto ${PORT}`));
