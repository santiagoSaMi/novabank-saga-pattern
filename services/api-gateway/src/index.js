require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuid } = require('uuid');

const bus = require('./bus');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://orchestrator-service:4001';
const ACCOUNT_URL = process.env.ACCOUNT_URL || 'http://account-service:4002';

// ---------------------------------------------------------------------------
// Punto de entrada centralizado del sistema. Recibe la peticion del
// frontend, emite el identificador de idempotencia (UUID) y el sagaId,
// y despacha la ejecucion hacia el modo elegido (orquestado o coreografiado).
// ---------------------------------------------------------------------------
app.post('/api/transfer', async (req, res) => {
  const { origen, destino, importe, mode, simulateFraud, simulateNetworkFailure, idempotencyKey: providedKey } = req.body;

  if (!origen || !destino || !importe) {
    return res.status(400).json({ error: 'origen, destino e importe son obligatorios.' });
  }
  if (Number.isNaN(Number(importe)) || Number(importe) <= 0) {
    return res.status(400).json({ error: 'importe debe ser un numero positivo.' });
  }
  if (!['orchestrated', 'choreographed'].includes(mode)) {
    return res.status(400).json({ error: "mode debe ser 'orchestrated' o 'choreographed'." });
  }

  const sagaId = uuid();
  const idempotencyKey = providedKey || uuid();

  const payload = {
    sagaId,
    idempotencyKey,
    origen,
    destino,
    importe: Number(importe),
    simulateFraud: !!simulateFraud,
    simulateNetworkFailure: !!simulateNetworkFailure,
  };

  try {
    if (mode === 'orchestrated') {
      // No se espera (await) la finalizacion completa de la saga: el
      // orquestador responde 202 de inmediato y ejecuta en segundo plano.
      axios.post(`${ORCHESTRATOR_URL}/saga`, payload).catch((err) => {
        console.error('[api-gateway] error al invocar al orquestador:', err.message);
      });
    } else {
      await bus.publish('TransferenciaSolicitada', payload);
    }
  } catch (err) {
    console.error('[api-gateway] error al despachar la transferencia:', err.message);
    return res.status(502).json({ error: 'No se pudo iniciar la saga. Intente nuevamente.' });
  }

  res.status(202).json({ sagaId, idempotencyKey, mode });
});

// Consulta de saldo (atraviesa el gateway como unico punto de entrada publico)
app.get('/api/balance/:cuenta', async (req, res) => {
  try {
    const { data } = await axios.get(`${ACCOUNT_URL}/balance/${encodeURIComponent(req.params.cuenta)}`);
    res.json(data);
  } catch (err) {
    console.error('[api-gateway] error al consultar saldo:', err.message);
    res.status(502).json({ error: 'No se pudo consultar el saldo.' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

app.listen(PORT, () => console.log(`[api-gateway] escuchando en puerto ${PORT}`));
