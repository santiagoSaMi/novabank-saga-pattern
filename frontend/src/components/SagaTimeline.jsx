import React from 'react';

const STATUS_LABELS = {
  running: 'En ejecucion',
  success: 'Exito',
  failed: 'Fallido',
  compensated: 'Compensado',
  compensating: 'Compensando',
  idempotente: 'Idempotente',
};

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('es-CO', { hour12: false });
}

function deriveSagaState(events) {
  const sagaEvents = events.filter((e) => e.step === 'saga');
  const last = sagaEvents[sagaEvents.length - 1];
  if (!last) return { label: 'Sin iniciar', cls: '' };
  if (last.status === 'success') return { label: 'CONFIRMADO', cls: 'confirmado' };
  if (last.status === 'failed') return { label: 'RECHAZADO', cls: 'rechazado' };
  return { label: 'PROCESANDO', cls: 'procesando' };
}

export default function SagaTimeline({ sagaId, mode, events }) {
  const sagaState = deriveSagaState(events);
  const visibleEvents = events.filter((e) => e.step !== 'saga');

  return (
    <div className="panel" style={{ minHeight: 480 }}>
      <div className="timeline-header">
        <div>
          <h2 className="panel-title">Linea de tiempo de la saga</h2>
          <p className="panel-subtitle" style={{ marginBottom: 0 }}>
            {sagaId ? (
              <>
                sagaId <span className="mode-tag">{sagaId}</span> · modo{' '}
                <span className="mode-tag">{mode === 'orchestrated' ? 'orquestada' : 'coreografiada'}</span>
              </>
            ) : (
              'Inicia una transferencia para ver el avance paso a paso en tiempo real.'
            )}
          </p>
        </div>
        {sagaId && <span className={`saga-status-pill ${sagaState.cls}`}>{sagaState.label}</span>}
      </div>

      {visibleEvents.length === 0 && (
        <div className="empty-state">
          <div className="empty-glyph">§</div>
          <div>Aun no hay eventos que mostrar.</div>
        </div>
      )}

      {visibleEvents.length > 0 && (
        <div className="timeline">
          {visibleEvents.map((e) => (
            <div className="timeline-item" key={e.id}>
              <div className={`timeline-dot ${e.status}`} />
              <div className="timeline-card">
                <div className="timeline-card-top">
                  <span className="timeline-service">{e.service}</span>
                  <span className="timeline-time">{formatTime(e.timestamp)}</span>
                </div>
                <div className="timeline-step">{e.step.replace(/-/g, ' ')}</div>
                <span className={`timeline-status-tag ${e.status}`}>{STATUS_LABELS[e.status] || e.status}</span>
                <div className="timeline-message">{e.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
