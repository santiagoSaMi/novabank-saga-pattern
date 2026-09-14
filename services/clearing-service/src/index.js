require('dotenv').config();
const express = require('express');
const cors = require('cors');

const domain = require('./domain');
const bus = require('./bus');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4004;

// --- REST: usado por el orchestrator-service en modo ORQUESTADO ---
app.post('/settle', async (req, res) => {
  try {
    const { sagaId, idempotencyKey, destino, importe, simulateNetworkFailure, mode } = req.body;
    const result = await domain.settleClearing({ sagaId, idempotencyKey, destino, importe, simulateNetworkFailure, mode: mode || 'orchestrated' });
    res.json(result);
  } catch (err) {
    console.error('[clearing-service] error en /settle:', err.message);
    res.status(500).json({ ok: false, reason: 'ERROR_INTERNO' });
  }
});

app.post('/compensate', async (req, res) => {
  try {
    const { sagaId, mode } = req.body;
    const result = await domain.compensateClearing({ sagaId, mode: mode || 'orchestrated' });
    res.json(result);
  } catch (err) {
    console.error('[clearing-service] error en /compensate:', err.message);
    res.status(500).json({ ok: false });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'clearing-service' }));

// --- Eventos: usado en modo COREOGRAFIADO, reutiliza la misma logica de dominio ---
async function startChoreographyConsumers() {
  await bus.subscribe(['RiesgoAprobado'], async (_eventType, payload) => {
    const { sagaId, idempotencyKey, destino, importe, simulateNetworkFailure } = payload;
    const result = await domain.settleClearing({ sagaId, idempotencyKey, destino, importe, simulateNetworkFailure, mode: 'choreographed' });
    if (result.ok) {
      await bus.publish('LiquidacionConfirmada', payload);
    } else {
      await bus.publish('TransferenciaFallida', { ...payload, reason: result.reason, failedStep: 'clearing' });
    }
  });

  // Autonomo: solo compensa si yo mismo liquide para ese saga
  await bus.subscribe(['TransferenciaFallida'], async (_eventType, payload) => {
    await domain.compensateClearing({ sagaId: payload.sagaId, mode: 'choreographed' });
  });
}

startChoreographyConsumers().catch((err) => {
  console.error('[clearing-service] error iniciando consumidores de coreografia:', err.message);
});

app.listen(PORT, () => console.log(`[clearing-service] escuchando en puerto ${PORT}`));
