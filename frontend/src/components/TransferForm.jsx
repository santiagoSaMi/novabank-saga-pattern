import React from 'react';

const SWITCHES = [
  {
    key: 'simulateFraud',
    label: 'Forzar fallo de riesgo (fraude)',
    help: 'CP-03 · El motor antifraude rechazara la operacion tras el debito.',
  },
  {
    key: 'simulateNetworkFailure',
    label: 'Forzar caida de red interbancaria',
    help: 'CP-04 · La pasarela de liquidacion simulara un timeout externo.',
  },
];

export default function TransferForm({ form, onChange, onToggle, onModeChange, onSubmit, onRetry, submitting, canRetry, error }) {
  return (
    <div className="panel">
      <h2 className="panel-title">Nueva transferencia</h2>
      <p className="panel-subtitle">
        Simulador de caos para el Patron Saga bancario de NovaBank International.
      </p>

      <div className="mode-toggle">
        <button
          type="button"
          className={form.mode === 'orchestrated' ? 'active' : ''}
          onClick={() => onModeChange('orchestrated')}
        >
          Saga orquestada
        </button>
        <button
          type="button"
          className={form.mode === 'choreographed' ? 'active' : ''}
          onClick={() => onModeChange('choreographed')}
        >
          Saga coreografiada
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="origen">Cuenta origen</label>
          <input id="origen" name="origen" value={form.origen} onChange={onChange} placeholder="ES00-0001-0000-01" required />
        </div>

        <div className="field">
          <label htmlFor="destino">Cuenta destino</label>
          <input id="destino" name="destino" value={form.destino} onChange={onChange} placeholder="ES00-0002-0000-02" required />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="importe">Importe (COP)</label>
            <input id="importe" name="importe" type="number" min="1" step="0.01" value={form.importe} onChange={onChange} required />
          </div>
          <div className="field">
            <label htmlFor="idempotencyKey">Idempotency key</label>
            <input id="idempotencyKey" name="idempotencyKey" value={form.idempotencyKey} readOnly />
          </div>
        </div>

        <div className="chaos-title">Simulador de caos</div>
        {SWITCHES.map((s) => (
          <div className="switch-row" key={s.key}>
            <div>
              <div className="switch-label">{s.label}</div>
              <div className="switch-help">{s.help}</div>
            </div>
            <div
              className={`switch ${form[s.key] ? 'on' : ''}`}
              role="switch"
              aria-checked={form[s.key]}
              tabIndex={0}
              onClick={() => onToggle(s.key)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle(s.key)}
            />
          </div>
        ))}

        <button className="submit-btn" type="submit" disabled={submitting}>
          {submitting ? 'Enviando...' : 'Iniciar transferencia'}
        </button>
        <button className="retry-btn" type="button" onClick={onRetry} disabled={!canRetry || submitting}>
          Reenviar mismo idempotencyKey (CP-05)
        </button>
      </form>
    </div>
  );
}
