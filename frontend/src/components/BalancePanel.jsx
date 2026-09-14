import React from 'react';

function formatAmount(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
}

export default function BalancePanel({ origen, destino, balances, onRefresh, loading }) {
  return (
    <div className="panel">
      <h2 className="panel-title">Saldos en vivo</h2>
      <p className="panel-subtitle">Consulta directa al Servicio de Cuentas y Saldos, a traves del API Gateway.</p>

      <div className="balance-grid">
        <div className="balance-card">
          <div className="balance-label">Origen</div>
          <div className="balance-account">{origen || '—'}</div>
          <div className="balance-amount">{formatAmount(balances.origen)}</div>
        </div>
        <div className="balance-card">
          <div className="balance-label">Destino</div>
          <div className="balance-account">{destino || '—'}</div>
          <div className="balance-amount">{formatAmount(balances.destino)}</div>
        </div>
      </div>

      <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
        {loading ? 'Consultando...' : 'Actualizar saldos'}
      </button>
    </div>
  );
}
