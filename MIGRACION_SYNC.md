# Migración a Local-primary POS + Cloud backoffice — estado actual

> Documento de seguimiento. Refleja el estado real de la migración al
> momento del último commit. Se actualiza con cada paso significativo
> del roadmap. Documento ancla: [ARQUITECTURA.md](./ARQUITECTURA.md).

**Última actualización:** 2026-06-09
**Versión MVP en curso:** MVP 2 (sincronización Local → Cloud)
**Próximo hito:** Fase A+ (Payment + CashRegisterSession) antes de
seguir con productores.

---

## Resumen ejecutivo

La arquitectura objetivo está documentada en [ARQUITECTURA.md](./ARQUITECTURA.md):
**Local-primary POS + Cloud backoffice + async sync** via Transactional
Outbox. La migración se ejecuta en fases (MVP 0 → MVP 4) descritas en
§14 de ese documento.

**Estado actual:** MVP 0 cerrado en producción. MVP 2 al ~30%
(2 de ~16 productores conectados al outbox). Antes de continuar con
los siguientes productores, pausa para implementar Fase A+ (sistema
de Payment + CashRegisterSession) que resuelve un problema operativo
crítico (descuadre de caja).

---

## Línea de tiempo

| Fecha | Commit | Alcance | Estado en prod |
|---|---|---|---|
| 2026-05-18 | `ddfb3e8` | docs: ARQUITECTURA.md + CASOS_DE_USO.md | ✅ |
| 2026-05-18 | `56a8ced` | feat(sync): external_id foundation | ✅ |
| 2026-05-18 | `985a8d1` | feat(sync): OutboxEvent + OperationalMode + LocalHealthSnapshot + NodeRegistry | ✅ |
| 2026-06-08 | `0f44052` | feat(sync): OutboxEventService | ✅ |
| 2026-06-08 | `369d341` | feat(sync): productores consumption.created (4 sitios) | ✅ |
| 2026-06-09 | `2d4aa4c` | feat(sync): productores session.* (4 sitios) | ⏳ pendiente verificación post-deploy |

---

## MVP 0 — Foundation (cerrado)

### Decisión de identidad

Cada entidad operativa tiene una columna `external_id String @unique
@default(uuid())` además del PK `Int @autoincrement`. Esto permite
deduplicar cross-nodo sin colisión de IDs autoincrement, manteniendo
el PK interno intacto para no romper FKs ni queries existentes.

**Entidades con `external_id`:**

- `TableSession`
- `OrderRequest`
- `Order`
- `OrderItem`
- `OrderItemComponent`
- `Consumption`
- `InventoryMovement`
- `ExtraIncome`
- `LuggageTicket`
- `AuditLog`
- `QueueItem`
- `Song`

### Tablas de infraestructura de sync

Creadas vacías, esperando productores y worker:

- **`OutboxEvent`** — registra cada cambio operativo que debe pushearse
  al cloud. Patrón Transactional Outbox. Incluye `idempotency_key`
  UUID con `UNIQUE(node_id, idempotency_key)` para deduplicar
  reintentos. Lleva `schema_version` y `app_version` por evento.
- **`OperationalMode`** — track de transiciones cloud_normal ↔
  local_primary ↔ recovery. Para postmortem.
- **`LocalHealthSnapshot`** — foto operativa cada ~5 min del local.
  Observabilidad histórica.
- **`NodeRegistry`** — catálogo formal de nodos (cloud + cada local).
  Heartbeat, versionado, soft-delete, pool de fichas Luggage por nodo.
  Seed inicial: fila `cloud` con pool `1-99999`.

### Servicio fundacional

**`OutboxEventService`** (módulo `@Global`):

- API: `enqueue(tx, input)` — transacción obligatoria por contrato.
- Validación: cada `event_type` debe estar registrado en
  `OUTBOX_EVENT_REGISTRY` con un validador de payload. Si el
  event_type es desconocido o el payload no cumple, throw 400 y la
  transacción del caller revierte. **Nunca un cambio operativo sin
  su evento, ni viceversa.**
- Lee `node_id`, `schema_version`, `app_version` desde
  `OutboxConfigService` (env vars o defaults).
- Genera `idempotency_key` automáticamente vía Prisma `@default(uuid())`.

### Estado actual de producción (verificado)

Sample del log de boot (deploy del 8/6):

```
[OutboxConfigService] Outbox config — node_id=cloud
  schema_version=2026.06.08.1 app_version=0.1.0
```

`NodeRegistry` contiene la fila `cloud` con su pool. Todas las
entidades operativas tienen `external_id` populated. Cero impacto en
operación.

---

## MVP 2 — Productores conectados al outbox (en curso)

### Convención

Cada productor sigue el mismo patrón:

1. Service inyecta `OutboxEventService`.
2. Dentro de la transacción existente, **después** del create/update
   de la entidad y **antes** de side effects (socket emits, audit
   logs externos, projections), llamar `await outbox.enqueue(tx, ...)`.
3. Si el enqueue falla, la transacción revierte: la entidad NO se
   persiste y el evento NO se emite. Invariante consistencia.
4. Helper `serialize<Entity>ForOutbox()` por dominio para
   homogeneizar el shape entre call sites.

### Productores `consumption.created` (commit `369d341`) ✅

Validados en producción con 6 filas generadas en test controlado el
9/6. Helper: `consumptions/outbox-payload.ts`.

| Productor | Service | Método | Estado |
|---|---|---|---|
| #1 | `ConsumptionsService` | `createAdjustment` | ✅ Validado |
| #2 | `ConsumptionsService` | `recordPartialPayment` | ✅ Validado |
| #3 | `ConsumptionsService` | `refundConsumption` | ✅ Validado |
| #4 | `OrdersService` | `emitConsumptions` | ✅ Validado |

**Payload (`ConsumptionCreatedPayload`):**

```
id, external_id, table_session_id, order_id, product_id, type,
description, quantity, unit_amount, amount, reverses_id, reason,
notes, created_by, created_at
```

`Decimal` → `number`, `DateTime` → ISO string. Nullables preservados
como `null`.

### Productores `session.*` (commit `2d4aa4c`) ⏳

Pusheados, pendiente verificación post-deploy. Helper:
`table-sessions/outbox-payload.ts`.

| Productor | Service | Método | event_type | Estado |
|---|---|---|---|---|
| #5 | `TableSessionsService` | `createAndProject` (open path) | `session.opened` | ⏳ |
| #6 | `TableSessionsService` | `markPaid` | `session.marked_paid` | ⏳ |
| #7 | `TableSessionsService` | `voidSession` | `session.voided` | ⏳ |
| #8 | `TableSessionsService` | `close` | `session.closed` | ⏳ |

**Notas de modelado:**

- `markPaid` emite UN solo evento `session.marked_paid` aunque
  internamente setee `paid_at + closed_at + status=closed`. El
  consumer cloud infiere el cierre desde `payload.status = 'closed'`.
- `voidSession` idem: UN evento `session.voided` que ya incluye cierre.
- `session.opened` NO se emite cuando un device se une a sesión
  existente (refleja la lógica del socket emit existente).

**Plan de verificación post-deploy:**

1. Abrir mesa de prueba → `session.opened`.
2. Agregar producto + entregar → `consumption.created (product)`.
3. `markPaid` → `session.marked_paid`.
4. Abrir otra mesa → `session.opened`.
5. `void` → `session.voided`.

---

## Productores pendientes del roadmap MVP 2

Lista priorizada según ARQUITECTURA.md §4 y conversaciones de diseño:

| Productor | Service | Método | event_type | Comentarios |
|---|---|---|---|---|
| `order.status_changed` | `OrdersService` | `updateStatus` | `order.status_changed` | Transición accepted ↔ preparing ↔ ready ↔ delivered ↔ cancelled. Próximo commit típico del roadmap. |
| `inventory.recorded` | `InventoryMovementsService` | `record` | `inventory.recorded` | Cada InventoryMovement (restock, adjustment, waste, correction). |
| `extra_income.created` / `extra_income.reversed` | `ExtraIncomeService` | `createRestroom`, `createManual`, `reverse` | (nuevo en registry) | Ingresos baño + manuales. |
| `luggage.*` | `LuggageService` | `create`, `deliver`, `incident`, `updatePayment` | (nuevo en registry) | Lifecycle de fichas. |
| `audit_log.created` | `AuditLogService` | `record` | (nuevo en registry) | Replicar log completo a cloud. |
| `payment.created` | (nuevo) `PaymentsService` | (Fase A+) | (nuevo en registry) | **Pendiente: depende de Fase A+.** |
| `cash_register.opened/closed` | (nuevo) `CashRegisterService` | (Fase A+) | (nuevos en registry) | **Pendiente: depende de Fase A+.** |

---

## Pausa actual: Fase A+ (Payment + CashRegisterSession)

### Por qué se pausó el roadmap

Problema operativo real: descuadre de caja al cierre del día. El
sistema actual no diferencia métodos de pago, no registra base de
caja inicial ni cobros divididos, y no tiene un "cierre de día"
contable persistido.

Aprovechando que el sync todavía no está moviendo datos masivos y
que `ARQUITECTURA.md §2` ya tenía declarado el dominio `Payment` /
`PartialPayment` / `CashMovement` como pendiente de materializar a
tablas propias, **es el momento técnico correcto** para hacerlo
antes de seguir agregando productores.

### Alcance Fase A+ (aprobado)

**Schema nuevo:**

- Enums: `PaymentMethod` (efectivo, tarjeta_bold, qr_bold), `PaymentKind`
  (partial, final), `CashRegisterStatus` (open, closed).
- Tabla `Payment`: registro de cada cobro con método, monto, kind,
  FK opcional a Consumption (para parciales) y FK a CashRegisterSession.
- Tabla `CashRegisterSession`: día contable con opening_balance,
  closing_balance_declared, closing_balance_expected, difference.
  Solo 1 row con `status=open` simultáneamente (partial unique index).

**Asociación de entidades a CashRegisterSession (decisión Opción A):**

Las siguientes tablas agregan `cash_register_session_id` (FK):

- `Consumption`
- `Payment` (nativo)
- `ExtraIncome`
- `LuggageTicket`

Esto hace que los filtros "Hoy / Ayer / 7d" de `/admin/sales` operen
sobre sesiones de caja en vez de rango calendario. Resuelve el
problema de noches que cruzan medianoche: las ventas se atribuyen
al día comercial, no al día calendario fragmentado.

**Backend:**

- `CashRegisterService.openDay(opening_balance, actor)`.
- `CashRegisterService.closeDay(declared_balance, actor)`.
- `CashRegisterService.requireOpen()` helper invocado por endpoints
  bloqueados (412 `CASH_REGISTER_CLOSED` si no hay día abierto).
- `PaymentsService.recordPartial(tx, ...)` y `recordFinal(tx, ...)`.
- Refactor de `markPaid` (cambia firma: recibe `payments: Array<{method, amount}>`).
- Refactor de `recordPartialPayment` (recibe `payment_method` obligatorio).

**Endpoints bloqueados sin día abierto:**

POST a: order-requests, orders status transitions, bill adjustments,
partial payments, table-sessions open, walkin BAR, queue, extra-income,
luggage. Total ~10 endpoints.

NO bloqueados: login, abrir/cerrar día, GETs de lectura, refunds,
markPaid/void/close de mesas (deben poder terminar in-flight),
markdelivered (idem).

**Outbox:**

- Nuevos event_types: `payment.created`, `cash_register.opened`,
  `cash_register.closed` en `OUTBOX_EVENT_REGISTRY`.
- Productores en cada operación.

**Frontend:**

- Banner rojo permanente en `/admin` si NO hay día abierto.
- Modal "Abrir día" con input de base + botón "Bypass (sin base)" con
  razón obligatoria como red de seguridad.
- Modal bloqueante de método de pago: 3 botones (EFECTIVO / TARJETA
  BOLD / QR BOLD), no se cierra con Esc ni click-fuera, escape de
  emergencia "Cancelar pago" con confirmación.
- UI de cobros divididos en `markPaid`: agregar métodos hasta cubrir
  el total.
- Modal "Cerrar día" con ticket completo + input de conteo declarado
  + diferencia visible.
- Sección "Cierre de caja" en `/admin/sales` tab Resumen.
- Métodos de pago visibles en el ticket térmico del tab Detalle.
- Tab nuevo "Caja" en `/admin/sales` con histórico de cierres.

**Mitigaciones de seguridad (aprobadas):**

1. **Bypass de apertura:** botón "Abrir día sin base declarada" con
   razón obligatoria. Marcado en reportes.
2. **Auto-día al deploy:** la migration crea automáticamente UNA
   `CashRegisterSession` con `opening_balance=0` y notas "Auto-creado
   por migration" para que el sistema tenga continuidad inmediatamente
   al subir el código. El admin la cierra cuando pueda y abre la real.

### Plan de partición en 3 commits

Cada commit deployable y validable independientemente:

| Commit | Alcance | Riesgo |
|---|---|---|
| **B1** | Schema + migrations (tablas + enums + FKs en entidades existentes + auto-día) + outbox payloads + registry. Sin cambios en services. | Bajo. Solo agrega tablas y columnas nullable. |
| **B2** | Backend: PaymentsService + CashRegisterService + integración con markPaid/recordPartialPayment + requireOpen() en endpoints bloqueados. | Medio-alto. Acá empieza a aplicar "TODO bloqueado". El auto-día protege el deploy. |
| **B3** | Frontend completo: banner, modales, UI cobros divididos, sección Resumen, ticket Detalle, tab Caja histórico. | Bajo (frontend, sin migrations). |

### Estimación

~16-20 horas totales. Distribuidas: B1 ~3h, B2 ~6-8h, B3 ~7-9h.

---

## Decisiones registradas

### Que el "día" sea sesión de caja, no calendario (Opción A)

Aprobado para todos los reportes de `/admin/sales`. Razón: alinea
el reporte con el cierre de caja físico y elimina el problema de
ventas que cruzan medianoche apareciendo en 2 días distintos.

Trade-off aceptado: el filtro "Hoy" pierde semántica calendario y
pasa a significar "sesión activa". Mitigado con label explícito en
el selector ("Hoy — Día abierto el 8/6 18:30").

### Tabla `Payment` separada (no campo en Consumption)

Aprobado. Habilita cobros divididos al cierre, trazabilidad sin
tocar el ledger, modelo limpio para extensiones (referencia de
datafono, propina). Coherente con `ARQUITECTURA.md §2` que ya tenía
declarado el dominio Payment.

`Consumption.type='partial_payment'` sigue existiendo para no romper
el ledger histórico — `Payment` es complementaria con FK opcional.

### "TODO bloqueado" sin día abierto

Aprobado. Máxima disciplina contable. Mitigaciones obligatorias:
bypass de apertura + auto-día al deploy.

### Cierre manual, sin corte horario automático

Aprobado. Vos decidís cuándo termina el día. Permite operar pasadas
las 12:00 sin que el sistema cambie de día en medio del turno.

---

## Próximos pasos inmediatos

1. **Verificar deploy de commit `2d4aa4c`** (session.*) en producción
   con el plan de 5 pasos descrito arriba.
2. **Implementar B1** (schema + migration + outbox infra de Payment +
   CashRegisterSession).
3. **Implementar B2** (servicios + bloqueos).
4. **Implementar B3** (frontend completo).
5. **Retomar roadmap MVP 2**: productores `order.status_changed`,
   `inventory.recorded`, `extra_income.*`, `luggage.*`, `audit_log.*`,
   `payment.*`, `cash_register.*`.
6. **Construir el worker de drain del outbox** (MVP 2 completo
   requiere worker + endpoint cloud `/sync/ingest`).
7. **MVP 1 deployment del local** (mini-PC físico).
8. **MVP 3 failover + QR inteligente**.

---

## Referencias

- [ARQUITECTURA.md](./ARQUITECTURA.md) — documento ancla con la
  decisión arquitectónica completa.
- [CASOS_DE_USO.md](./CASOS_DE_USO.md) — mapa exhaustivo de
  funcionalidades del sistema.

---

_Documento mantenido por el equipo. Actualizar después de cada
commit significativo del roadmap o cuando una decisión arquitectónica
cambie._
