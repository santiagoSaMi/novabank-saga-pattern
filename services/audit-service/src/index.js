require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4005;

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// El frontend se une a una "sala" identificada por el sagaId para recibir
// en tiempo real unicamente los eventos de la transferencia que le interesa.
io.on('connection', (socket) => {
  socket.on('join', (sagaId) => {
    if (typeof sagaId === 'string') {
      socket.join(sagaId);
    }
  });
});

// Todos los microservicios (y el orquestador) reportan aqui cada paso,
// exito, fallo o compensacion, incluyendo los delays de 2-4s simulados.
app.post('/events', (req, res) => {
  const event = req.body;
  if (!event.sagaId || !event.step || !event.status) {
    return res.status(400).json({ error: 'sagaId, step y status son obligatorios.' });
  }
  const saved = db.saveEvent(event);
  io.to(event.sagaId).emit('saga-event', saved);
  console.log(`[audit-service] ${event.sagaId} :: ${event.service || '-'} :: ${event.step} :: ${event.status}`);
  res.status(201).json(saved);
});

app.get('/events/:sagaId', (req, res) => {
  res.json(db.getEvents(req.params.sagaId));
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'audit-service' }));

server.listen(PORT, () => console.log(`[audit-service] escuchando en puerto ${PORT}`));
