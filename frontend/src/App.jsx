import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

import TransferForm from './components/TransferForm.jsx';
import BalancePanel from './components/BalancePanel.jsx';
import SagaTimeline from './components/SagaTimeline.jsx';

const GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000';
const AUDIT_URL = import.meta.env.VITE_AUDIT_URL || 'http://localhost:4005';

function newUUID() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const INITIAL_FORM = {
  origen: 'CTA-0001-ORIGEN',
  destino: 'CTA-0002-DESTINO',
  importe: '150000',
  mode: 'orchestrated',
  simulateFraud: false,
  simulateNetworkFailure: false,
  idempotencyKey: newUUID(),
};

export default function App() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [sagaId, setSagaId] = useState(null);
  const [activeMode, setActiveMode] = useState('orchestrated');
  const [events, setEvents] = useState([]);

  const [balances, setBalances] = useState({ origen: null, destino: null });
  const [balanceLoading, setBalanceLoading] = useState(false);

  const socketRef = useRef(null);
  const sagaIdRef = useRef(null);

  // Conexion unica al servicio de auditoria via Socket.IO para observabilidad en tiempo real
  useEffect(() => {
    const socket = io(AUDIT_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('saga-event', (event) => {
      if (event.sagaId !== sagaIdRef.current) return;
      setEvents((prev) => {
        if (prev.some((e) => e.id === event.id)) return prev;
        return [...prev, event].sort((a, b) => a.id - b.id);
      });
    });

    return () => socket.disconnect();
  }, []);

  // Regenerar el idempotencyKey cuando cambian los datos de la operacion (nueva intencion de transferencia)
  useEffect(() => {
    setForm((f) => ({ ...f, idempotencyKey: newUUID() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.origen, form.destino, form.importe]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function handleToggle(key) {
    setForm((f) => ({ ...f, [key]: !f[key] }));
  }

  function handleModeChange(mode) {
    setForm((f) => ({ ...f, mode }));
  }

  async function fetchBalances(origen, destino) {
    setBalanceLoading(true);
    try {
      const [rOrigen, rDestino] = await Promise.all([
        fetch(`${GATEWAY_URL}/api/balance/${encodeURIComponent(origen)}`).then((r) => r.json()),
        fetch(`${GATEWAY_URL}/api/balance/${encodeURIComponent(destino)}`).then((r) => r.json()),
      ]);
      setBalances({ origen: rOrigen.balance, destino: rDestino.balance });
    } catch (err) {
      console.error('No se pudieron consultar los saldos', err);
    } finally {
      setBalanceLoading(false);
    }
  }

  async function sendTransfer() {
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origen: form.origen,
          destino: form.destino,
          importe: Number(form.importe),
          mode: form.mode,
          simulateFraud: form.simulateFraud,
          simulateNetworkFailure: form.simulateNetworkFailure,
          idempotencyKey: form.idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo iniciar la transferencia.');
      }

      sagaIdRef.current = data.sagaId;
      setSagaId(data.sagaId);
      setActiveMode(data.mode);
      setEvents([]);
      socketRef.current?.emit('join', data.sagaId);

      // Refresco de saldos escalonado para observar debito, compensacion y credito
      setTimeout(() => fetchBalances(form.origen, form.destino), 6000);
      setTimeout(() => fetchBalances(form.origen, form.destino), 12000);
      setTimeout(() => fetchBalances(form.origen, form.destino), 18000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendTransfer();
  }

  function handleRetry() {
    sendTransfer();
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-brand">
          <div className="brand-mark">N</div>
          <div>
            <h1>NovaBank International</h1>
            <p>Consola de Sagas Distribuidas &middot; Transferencias Interbancarias de Alto Valor</p>
          </div>
        </div>
        <div className="masthead-meta">
          <div>
            <div className="meta-label">Gateway</div>
            {GATEWAY_URL}
          </div>
          <div>
            <div className="meta-label">Auditoria</div>
            {AUDIT_URL}
          </div>
        </div>
      </header>

      <div className="workbench">
        <div>
          <TransferForm
            form={form}
            onChange={handleChange}
            onToggle={handleToggle}
            onModeChange={handleModeChange}
            onSubmit={handleSubmit}
            onRetry={handleRetry}
            submitting={submitting}
            canRetry={!!sagaId}
            error={error}
          />
          <BalancePanel
            origen={form.origen}
            destino={form.destino}
            balances={balances}
            onRefresh={() => fetchBalances(form.origen, form.destino)}
            loading={balanceLoading}
          />
        </div>

        <SagaTimeline sagaId={sagaId} mode={activeMode} events={events} />
      </div>

      <footer className="notice">
        Patron Saga &middot; BASE (Basically Available, Soft State, Eventual Consistency) &middot; Taller de Arquitectura de Software Distribuida
      </footer>
    </div>
  );
}
