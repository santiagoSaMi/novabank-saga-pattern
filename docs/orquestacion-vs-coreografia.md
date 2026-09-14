# Orquestación vs. Coreografía en la Saga Bancaria de NovaBank International

## 1. Por qué Saga y no 2PC

Two-Phase Commit exige que un coordinador bloquee simultáneamente los recursos de todos los
participantes hasta que todos confirmen. En un banco con servicios independientes (cuentas, riesgo,
pasarela interbancaria), eso implica bloqueos distribuidos de larga duración: si un participante cae,
los demás quedan bloqueados. El Patrón Saga reemplaza esa atomicidad "dura" por una secuencia de
transacciones locales, cada una con su propia **transacción de compensación**, logrando **BASE**
(Basically Available, Soft State, Eventual Consistency) en lugar de ACID distribuido.

## 2. Saga Orquestada

Un componente central (`orchestrator-service`) conoce el flujo completo y le indica explícitamente a
cada servicio qué hacer, paso a paso:

1. Llama a `account-service` para debitar la cuenta origen.
2. Llama a `risk-service` para validar la operación.
3. Llama a `clearing-service` para liquidar con la red interbancaria.
4. Llama de nuevo a `account-service` para acreditar la cuenta destino.

Si cualquier paso falla, el propio orquestador decide qué compensar y en qué orden, llamando
explícitamente a los endpoints `/compensate*` de los servicios que ya habían tenido éxito, siempre en
**orden inverso** al de ejecución.

**Ventajas observadas:**
- El flujo de negocio es explícito y fácil de leer en un solo lugar (`runOrchestratedSaga`).
- Es sencillo razonar sobre qué compensar ante cada fallo: el orquestador tiene visibilidad total.
- Facilita pruebas de extremo a extremo y trazabilidad, porque hay un único punto que conoce el estado
  global de la saga en cada instante.

**Desventajas observadas:**
- El orquestador conoce y depende de los contratos de los tres servicios de dominio: mayor acoplamiento.
- Es un punto único de coordinación (aunque no de fallo catastrófico, ya que es sin estado y se puede
  replicar horizontalmente).
- Añadir un nuevo paso al flujo obliga a modificar el orquestador.

## 3. Saga Coreografiada

No existe coordinador. Cada servicio reacciona de forma autónoma a los eventos de dominio que le
interesan y publica el siguiente evento en el bus (`saga.events` sobre RabbitMQ):

`TransferenciaSolicitada` → (`account-service`) → `SaldoDebitado` → (`risk-service`) →
`RiesgoAprobado` → (`clearing-service`) → `LiquidacionConfirmada` → (`account-service`) →
`SagaConfirmada`.

Ante cualquier fallo, el servicio que lo detecta publica `TransferenciaFallida`. Los tres servicios de
dominio están suscritos a ese evento y, **cada uno por su cuenta**, revisa si tiene un compromiso
(`saga_commit`) propio pendiente para ese `sagaId`; si lo tiene, ejecuta su compensación local. Nadie
les ordena compensar: lo deciden de forma autónoma en función de su propio estado.

**Ventajas observadas:**
- Bajo acoplamiento: ningún servicio conoce a los demás, solo los eventos a los que se suscribe.
- Es trivial añadir un nuevo participante a la saga (por ejemplo, notificaciones) sin tocar a nadie más:
  basta con suscribirlo a los eventos que le interesen.
- Cada servicio escala y evoluciona de forma independiente.

**Desventajas observadas:**
- El flujo de negocio queda "disperso" entre varios servicios; entenderlo requiere leer los
  consumidores de cada uno.
- Depurar y trazar una saga concreta es más difícil sin una capa de observabilidad centralizada (por
  eso el `audit-service` es imprescindible en este modo).
- Riesgo de acoplamiento implícito por el orden de los eventos: si dos servicios necesitan reaccionar
  al mismo evento con efectos que dependen entre sí, aparece un acoplamiento oculto que no se ve en el
  código de ningún servicio individual.

## 4. Conclusión

Para este taller, ambos enfoques comparten exactamente la misma lógica de negocio por servicio (el
mismo `domain.js`), lo único que cambia es el mecanismo de activación (llamada REST directa vs. evento
recibido). Esta decisión de diseño permite demostrar, con el mismo dinero y las mismas reglas de
negocio, cómo cambia el control de flujo y el acoplamiento entre ambos estilos, cumpliendo con el
objetivo del taller de contrastarlos activamente y no solo implementarlos por separado.
