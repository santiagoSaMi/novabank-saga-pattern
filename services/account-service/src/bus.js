const amqp = require('amqplib');

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://rabbitmq:5672';
const EXCHANGE = 'saga.events';

let channelPromise;

async function connectWithRetry(retries = 30, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await amqp.connect(RABBIT_URL);
    } catch (err) {
      console.log(`[bus] RabbitMQ no disponible aun (intento ${i + 1}/${retries}): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('No se pudo conectar a RabbitMQ tras varios intentos.');
}

async function getChannel() {
  if (!channelPromise) {
    channelPromise = (async () => {
      const conn = await connectWithRetry();
      conn.on('error', (err) => console.error('[bus] error de conexion:', err.message));
      conn.on('close', () => {
        console.error('[bus] conexion a RabbitMQ cerrada, se reintentara en el proximo uso.');
        channelPromise = null;
      });
      const ch = await conn.createChannel();
      await ch.assertExchange(EXCHANGE, 'topic', { durable: false });
      return ch;
    })();
  }
  return channelPromise;
}

// Publica un evento de dominio en el bus (usado por la coreografia)
async function publish(eventType, payload) {
  const ch = await getChannel();
  ch.publish(EXCHANGE, eventType, Buffer.from(JSON.stringify(payload)), { contentType: 'application/json' });
}

// Se suscribe a uno o mas tipos de evento con una cola exclusiva para este servicio
async function subscribe(eventTypes, handler) {
  const ch = await getChannel();
  const { queue } = await ch.assertQueue('', { exclusive: true });
  for (const type of eventTypes) {
    await ch.bindQueue(queue, EXCHANGE, type);
  }
  ch.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      const eventType = msg.fields.routingKey;
      const payload = JSON.parse(msg.content.toString());
      await handler(eventType, payload);
      ch.ack(msg);
    } catch (err) {
      console.error('[bus] error procesando mensaje:', err.message);
      ch.nack(msg, false, false);
    }
  });
  console.log(`[bus] suscrito a: ${eventTypes.join(', ')}`);
}

module.exports = { publish, subscribe };
