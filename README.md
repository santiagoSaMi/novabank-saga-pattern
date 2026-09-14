# NovaBank International — Patrón Saga Bancario

Implementación del taller **"Implementación del Patrón Saga Bancario, Coreografía vs. Orquestación y Observabilidad"**.

Transferencias interbancarias de alto valor sin bloqueos globales (2PC), usando el **Patrón Saga** bajo el
modelo **BASE**, con **Orquestación** y **Coreografía** implementadas y demostrables lado a lado.

## 1. Arquitectura

```
                                   ┌────────────────────┐
                                   │   Frontend (React)  │
                                   │  Simulador de Caos   │
                                   └──────────┬───────────┘
                                              │ REST
                                   ┌──────────▼───────────┐
                                   │     API Gateway       │  (Node/Express)
                                   │  UUID idempotencia    │
                                   └──────┬─────────┬──────┘
                       orquestada  ┌──────▼───┐   ┌─▼────────────┐  coreografiada
                                   │Orchestrator│   │  RabbitMQ    │
                                   │  Service   │   │ saga.events  │
                                   └─┬────┬────┬┘   └─┬─────┬─────┬┘
                                     │    │    │      │     │     │
                              ┌──────▼┐ ┌─▼───┐┌▼─────▼┐ ┌──▼───┐ │
                              │Account│ │Risk ││Clearing│ │(mismos servicios,
                              │Service│ │Svc  ││Gateway │ │ vía eventos)
                              └───┬───┘ └──┬──┘└───┬────┘
                                  │  cada uno con su propia base SQLite
                                  └───────────┬───────────┘
                                              ▼
                                     Audit Service (Socket.IO)
                                     Observabilidad en tiempo real
```

- **Frontend**: React + Vite, servido por Nginx.
- **API Gateway**: Node.js/Express — punto de entrada único, genera `sagaId` e `idempotencyKey` (UUID).
- **Orchestrator Service**: Node.js/Express — coordinador central del modo orquestado.
- **Account Service**, **Risk Service**, **Clearing Gateway**: Node.js/Express, cada uno con su propia
  base de datos SQLite embebida (Database-per-Service). Exponen tanto endpoints REST (para orquestación)
  como consumidores de eventos RabbitMQ (para coreografía), reutilizando la **misma lógica de dominio**
  en ambos casos.
- **RabbitMQ**: bus de eventos de dominio para la saga coreografiada (exchange `saga.events`, tipo topic).
- **Audit Service**: recibe cada paso/éxito/fallo/compensación y lo transmite en tiempo real por
  Socket.IO al frontend; persiste todo en su propia base SQLite (bitácora de auditoría).

Cada paso de negocio introduce una demora aleatoria configurable de **2 a 4 segundos**
(`DELAY_MIN_MS` / `DELAY_MAX_MS`) para poder apreciar visualmente los estados "en ejecución",
"fallido" y "compensado" en la línea de tiempo del frontend.

## 2. Cómo ejecutar

Requisitos: Docker y Docker Compose.

```bash
docker compose up --build
```

Espera a que todos los contenedores estén arriba (RabbitMQ tarda unos segundos en healthcheck) y abre:

- **Frontend**: http://localhost:3000
- API Gateway: http://localhost:4000/api/health
- Orchestrator: http://localhost:4001/health
- Account Service: http://localhost:4002/health
- Risk Service: http://localhost:4003/health
- Clearing Gateway: http://localhost:4004/health
- Audit Service: http://localhost:4005/health
- Panel de administración de RabbitMQ: http://localhost:15672 (usuario/clave: `guest` / `guest`)

Para detener y limpiar:

```bash
docker compose down -v
```

## 3. Cómo probar los casos de prueba obligatorios

Todos se disparan desde el formulario del frontend (http://localhost:3000). Alterna el selector
**Saga orquestada / Saga coreografiada** para repetir cada caso en ambos modos.

| Caso | Cómo reproducirlo en el frontend | Resultado esperado |
| --- | --- | --- |
| **CP-01** Camino feliz | Deja los dos switches apagados y envía. | Línea de tiempo: débito → riesgo → liquidación → crédito, todos en éxito. Estado `CONFIRMADO`. |
| **CP-02** Fondos insuficientes | Escribe un `importe` mayor al saldo inicial de la cuenta (por defecto `5.000.000`). | Solo aparece el paso de débito, en `failed`. No hay compensaciones. Estado `RECHAZADO_FONDOS`. |
| **CP-03** Fallo de riesgo | Activa el switch **"Forzar fallo de riesgo (fraude)"**. | Débito exitoso → riesgo `failed` → compensación de débito (`compensated`). Estado `RECHAZADO_RIESGO`. |
| **CP-04** Caída de red interbancaria | Activa el switch **"Forzar caída de red interbancaria"**. | Débito y riesgo exitosos → liquidación `failed` → compensaciones de riesgo y débito en orden inverso. Estado `RECHAZADO_RED`. |
| **CP-05** Idempotencia | Envía una transferencia y, sin cambiar los campos, pulsa **"Reenviar mismo idempotencyKey"**. | En el segundo envío todos los pasos aparecen con la etiqueta `idempotente`: no hay doble débito ni doble crédito. Verifícalo con el panel de saldos. |

El panel **"Saldos en vivo"** permite comprobar antes/después de cada prueba que el dinero nunca queda
en un estado intermedio perdido: siempre termina íntegro en el origen (si hubo rechazo) o correctamente
repartido entre origen y destino (si hubo éxito).

## 4. Orquestación vs. Coreografía

Ver [`docs/orquestacion-vs-coreografia.md`](docs/orquestacion-vs-coreografia.md) para el documento
explicativo comparando ambos enfoques, tal como lo exige el numeral 5 (Entregables) del taller.

Resumen rápido de cómo está implementado cada uno:

- **Orquestada**: `orchestrator-service` llama secuencialmente, vía REST, a `account-service`,
  `risk-service` y `clearing-service`; si algún paso falla, el propio orquestador invoca
  explícitamente los endpoints `/compensate*` de los servicios que ya habían tenido éxito, en
  **orden inverso**.
- **Coreografiada**: no existe coordinador. `api-gateway` publica `TransferenciaSolicitada` en
  RabbitMQ. Cada servicio escucha únicamente el evento que le interesa, ejecuta su acción local y
  publica el siguiente evento (`SaldoDebitado` → `RiesgoAprobado` → `LiquidacionConfirmada` →
  `SagaConfirmada`) o, ante un fallo, `TransferenciaFallida`. Todos los servicios están también
  suscritos a `TransferenciaFallida` y, de forma **autónoma**, revisan si tienen un commit propio
  pendiente para ese `sagaId` y lo compensan — sin que nadie se lo ordene.

## 5. Estructura del repositorio

```
saga-bank-workshop/
├── docker-compose.yml
├── docs/orquestacion-vs-coreografia.md   # Documento comparativo (entregable)
├── frontend/                              # React + Vite + Nginx
└── services/
    ├── api-gateway/                       # Node/Express — entrada única
    ├── orchestrator-service/              # Node/Express — saga orquestada
    ├── account-service/                   # Node/Express + SQLite propio
    ├── risk-service/                      # Node/Express + SQLite propio
    ├── clearing-service/                  # Node/Express + SQLite propio
    └── audit-service/                     # Node/Express + SQLite + Socket.IO
```

## 6. Notas de diseño relevantes para la rúbrica

- **Compensaciones estrictas en orden inverso** (criterio 1): tanto el orquestador como la coreografía
  deshacen los pasos ya confirmados en orden exactamente inverso al de ejecución, y usan tablas
  `saga_commits` por servicio para no compensar dos veces ni perder dinero.
- **Ambos enfoques conviven de verdad** (criterio 2): la lógica de negocio (`domain.js` en cada
  microservicio) es la misma para ambos modos; solo cambia el "disparador" (HTTP vs. evento). Esto evita
  divergencias entre lo que se demuestra en orquestación y en coreografía.
- **Observabilidad** (criterio 3): cada transición de estado (`running` → `success`/`failed` →
  `compensated`) queda en la bitácora del `audit-service` y se transmite en vivo por Socket.IO, con
  las demoras de 2-4s visibles en la interfaz.
- **Frontend** (criterio 4): formulario con switches de caos, selector de modo, línea de tiempo en vivo
  y panel de saldos para verificar la consistencia final.
- **Aislamiento de datos e idempotencia** (criterio 5): cada microservicio tiene su propio archivo
  SQLite (volumen Docker independiente) y una tabla de idempotencia por `idempotencyKey` + operación.
