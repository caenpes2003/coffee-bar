# Arquitectura — Crown Bar 4.90

> **Documento ancla.** Toda decisión de sincronización, continuidad
> operativa y deployment del sistema se justifica contra este documento.
> Cuando dudes sobre dónde corre algo o quién es autoridad, este es el
> documento que define la respuesta. Versionado en git. Actualizar antes
> de tomar decisiones que lo contradigan.

**Versión:** 1.2.0 — 2026-06-08
**Estado:** propuesta aprobada con 9 ajustes incorporados · MVP 0 (external_id + OutboxEvent + NodeRegistry) listo

---

## 1. Modelo mental: Local-primary POS

Crown Bar 4.90 opera bajo una arquitectura **Local-primary POS + Cloud
backoffice + async sync**. El nombre describe la realidad: durante el
servicio del bar, **el servidor local es la fuente de verdad runtime**;
el cloud es el archivo consolidado y el backoffice.

La frase guía es:

> El bar no debe depender de Railway para vender. Railway debe depender
> del bar para recibir la operación sincronizada.

Cuando dudes sobre cualquier decisión de arquitectura, reformulá la
pregunta como: **¿esta operación puede no suceder si Railway está
caído?** Si la respuesta es **no puede no suceder**, va al local
primero.

### Topología

```
                ┌─────────────────────────────────────┐
                │            RAILWAY (Cloud)           │
                │  ┌─────────────────────────────────┐ │
                │  │ NestJS (mismo código)            │ │
                │  │ Postgres (archivo + backoffice)  │ │
                │  │ Socket.IO                        │ │
                │  │ Sync ingestor                    │ │
                │  └─────────────────────────────────┘ │
                └──────▲────────────────────────▲─────┘
                       │ outbox push             │ HTTPS público
                       │ (asíncrono)             │
                       │                          │
        ┌──────────────┴──────────────────────────┴──────────────┐
        │                                                         │
        │         LOCAL GATEWAY (mini-PC en el bar)               │
        │         node_id = "local-crown-001"                     │
        │  ┌──────────────────────────────────────────────────┐   │
        │  │ NestJS (mismo código, env MODE=local)            │   │
        │  │ Postgres local                                    │   │
        │  │ Socket.IO local                                   │   │
        │  │ OutboxEvent table                                 │   │
        │  │ Sync worker (drena al cloud)                      │   │
        │  │ Next.js local (opcional, mismo bundle)            │   │
        │  └──────────────────────────────────────────────────┘   │
        └────▲────────────────▲────────────────▲─────────────────┘
             │                │                │
             │ WiFi local     │ WiFi local     │ WiFi local
             │                │                │
        ┌────┴────┐      ┌────┴────┐      ┌───┴─────┐
        │ Cliente │      │ Admin   │      │ Player  │
        │ mesa    │      │ tablet  │      │ TV      │
        └─────────┘      └─────────┘      └─────────┘
```

---

## 2. Autoridad por dominio

| Dominio | Fuente de verdad | Dirección de sync |
|---|---|---|
| **Catálogo** (Product, Recipe, User, Setting, HousePlaylistItem, Category, Table config) | Cloud | Cloud → Local (pull al iniciar + webhook al editar) |
| **Operación** (TableSession, Order*, Consumption, **Payment**, **PartialPayment**, **CashMovement**, InventoryMovement, ExtraIncome, LuggageTicket, AuditLog) | Local | Local → Cloud (outbox asíncrono) |
| **Runtime musical** (QueueItem, Song, PlaybackState, fairness) | Local | No se replica al cloud (cloud-only opera con su propio set) |
| **Búsqueda externa** (YouTube/Spotify Search API) | Solo disponible online | No aplica — proxy externo, no se cachea |
| **Códigos de acceso** (BarAccessCode) | Cloud | Cloud → Local (pull) — local NO rota |
| **Tokens JWT** | Cada nodo emite los suyos | No se replican |

### Reglas de autoridad

- **El catálogo no se edita desde local.** Si admin quiere cambiar
  precios o productos en contingencia, debe esperar a que cloud vuelva.
  Justificación: evitar conflictos de unique constraints (`sku`,
  `qr_code`) y mantener simple el modelo de sync.
- **La operación no se edita desde cloud durante una contingencia
  local.** Si el admin entra a cloud mientras local opera, ve datos
  congelados al último push exitoso. Cualquier edición sería rechazada
  al reconciliar (last-writer-wins favorece al local porque es la
  autoridad operativa).
- **El runtime musical es exclusivamente local** durante operación
  normal. Si el bar opera contra cloud (no hay mini-PC aún), cloud
  hace de local en ese aspecto.

### Sobre Payment / PartialPayment / CashMovement

Hoy estos conceptos viven materializados dentro de entidades
existentes:

- **Payment** (cobro al cierre de la cuenta) → `TableSession.paid_at`
  + monto en `TableSession.total_consumption`.
- **PartialPayment** (anticipo durante la operación) →
  `Consumption.type='partial_payment'` (monto negativo).
- **CashMovement** (apertura/cierre de caja, retiros, depósitos) →
  **no existe todavía**; cuando se implemente debe ser tabla propia.

Los listo explícitamente en la autoridad porque conceptualmente son
operación crítica y la arquitectura debe tratarlos como ciudadanos de
primera. Cuando se refactore a tablas propias (recomendado en MVP 3
o posterior), heredan automáticamente:

- `external_id` UUID.
- Inclusión en `OutboxEvent`.
- Autoridad local.
- Inclusión en `LocalHealthSnapshot`.

Mientras tanto, los flujos de pago se sincronizan vía los eventos de
`Consumption` y `TableSession` que ya existen.

---

## 3. Identidad y deduplicación cross-nodo

### IDs

Mantener `Int @id @default(autoincrement())` como PK interno para no
romper FKs existentes ni queries actuales.

Agregar `external_id String @unique @default(uuid())` **NOT NULL** a
toda entidad operativa. Es el ID estable cross-nodo que usa el sync
para upsertear sin colisión.

**Entidades con `external_id` obligatorio:**

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
- `QueueItem` (aunque no se replique, útil para reconciliar reportes)
- `Song` (idem)

Las entidades de catálogo (Product, User, Recipe, etc.) **no necesitan
`external_id`** porque su autoridad es cloud y se sincronizan por PK
o por `sku` (que ya es unique).

### Identidad del nodo

Cada servidor se identifica con un `node_id` (env var `NODE_ID`).

- Cloud: `NODE_ID=cloud`
- Local del bar actual: `NODE_ID=local-crown-001`
- Locales futuros: `local-crown-002`, etc.

### Llave de sync

Para **deduplicar entidades** (upsert): el cloud usa
`(node_id, aggregate_type, aggregate_id)` donde `aggregate_id` es el
`external_id` de la entidad. Dos nodos distintos podrían generar filas
con el mismo `external_id` solo si UUIDs colisionan (probabilidad
efectivamente cero).

Para **deduplicar eventos** (idempotencia de transporte): cada evento
del outbox lleva además un `idempotency_key` UUID propio. El cloud
rechaza con unique violation un `INSERT` con misma
`(node_id, idempotency_key)` — equivale a "ya procesé este evento".
Ver §4.1.

---

## 3.5 Registro formal de nodos — `NodeRegistry`

El `node_id` se referencia desde muchas tablas (`OutboxEvent`,
`OperationalMode`, `LocalHealthSnapshot`, JWT `iss`, pool de
`LuggageTicket`). Para no convertirlo en un string mágico
descentralizado, existe `NodeRegistry` como catálogo formal:

```prisma
enum NodeType {
  cloud
  local
}

model NodeRegistry {
  node_id        String   @id        // "cloud", "local-crown-001"
  name           String              // legible
  type           NodeType
  installed_at   DateTime
  last_seen_at   DateTime?           // último heartbeat
  app_version    String?             // reportado en heartbeat
  schema_version String?
  is_active      Boolean  @default(true)
  luggage_ticket_pool_start Int?
  luggage_ticket_pool_end   Int?
  notes          String?
}
```

Usos:

- **Validación de tokens:** el guard JWT verifica `iss ∈ NodeRegistry
  WHERE is_active = true`. Si un nodo se retira (`is_active=false`),
  sus tokens emitidos dejan de aceptarse.
- **Dashboard cloud:** "qué locales tengo activos, cuál fue el último
  heartbeat, cuál está en schema desactualizado".
- **Assignment de pools:** rangos de `LuggageTicket.ticket_number` por
  nodo viven acá. Cambiar el pool del local-crown-002 es un UPDATE en
  esta tabla, no un cambio de código.
- **Soft-retire:** un nodo retirado del servicio queda con
  `is_active=false`, no se borra — preservamos histórico de eventos
  que referencian ese node_id.

**NO es FK fuerte** desde `OutboxEvent.node_id` etc. al `NodeRegistry`
porque queremos que los eventos sobrevivan aunque el nodo se
desregistre. Validación blanda en el service al pushear.

Seed inicial: la migration crea automáticamente la fila `cloud` con
pool de fichas `1-99999`. Los locales se registran cuando se
aprovisionan (manual o vía endpoint admin).

---

## 4. Sincronización: Transactional Outbox

### Patrón

Cada vez que el local genera un cambio operativo, en la **misma
transacción Prisma** escribe una fila en `OutboxEvent`. Un worker
separado consume la tabla y la pushea al cloud. La atomicidad de la
transacción garantiza que nunca haya un cambio operativo sin su
correspondiente evento.

### Schema

```prisma
enum OutboxStatus {
  pending
  pushed
  quarantined  // schema_version incompatible o error permanente
}

model OutboxEvent {
  id              BigInt   @id @default(autoincrement())
  node_id         String   // siempre el local que generó (== NODE_ID)
  idempotency_key String   @default(uuid())  // ver §4.1
  event_type      String   // "session.opened", "consumption.created", etc.
  aggregate_type  String   // "TableSession", "Consumption", etc.
  aggregate_id    String   // external_id del aggregate
  payload         Json     // snapshot completo de la fila
  schema_version  String   // ej. "2026.05.18.1"
  app_version     String   // ej. "1.8.3"
  occurred_at     DateTime @default(now())
  status          OutboxStatus @default(pending)
  pushed_at       DateTime?
  push_attempts   Int      @default(0)
  last_error      String?

  @@unique([node_id, idempotency_key])
  @@index([status, occurred_at])
  @@index([aggregate_type, aggregate_id])
}
```

### 4.1 Idempotencia de transporte

El escenario clásico que mata la mayoría de las sincronizaciones
caseras: el local pushea un evento, el cloud lo procesa
correctamente, pero el ACK se pierde en la red (timeout, 502, socket
cerrado). El local cree que falló y reintenta. Sin protección, el
cloud procesa el evento dos veces.

El upsert por `aggregate_id` ayuda para entidades (un INSERT/UPDATE
queda idempotente), pero **no para eventos de transición**: dos
eventos `order.delivered` aplicados sobre el mismo Order ejecutan dos
veces el side effect (emit a socket, audit row duplicado, etc.).

**Solución:** cada evento lleva un `idempotency_key` UUID generado al
crear la fila en el outbox local. El cloud aplica un `INSERT ... ON
CONFLICT (node_id, idempotency_key) DO NOTHING` en una tabla de
recepción (`InboxEvent` o equivalente). Si choca, simplemente
responde 200 con `{ status: "duplicate" }` — el local marca el
evento como `pushed` y avanza.

Esto desacopla la idempotencia de la lógica de negocio: ni siquiera
hace falta saber qué tipo de evento es.

### Política del worker

- Drena `status=pending` ordenado por `occurred_at` ASC.
- Reintento con backoff exponencial: 1s, 5s, 30s, 2min, 10min, 1h.
- Marca `status=pushed` + `pushed_at=now()` al éxito.
- Si `push_attempts >= 10` y el error es permanente (schema rechazado,
  payload corrupto): marca `status=quarantined` y notifica a Sentry.
  **Nunca descartar silenciosamente.**
- Si el error es transitorio (network, 502, 503): mantiene `pending` y
  reintenta.

### Schema versioning

Cada evento incluye `schema_version` y `app_version` en el cuerpo. El
cloud:

- Si el evento es de schema **anterior** al cloud: aplica migración
  inline si los cambios son aditivos (campos nuevos opcionales). Si el
  cambio es destructivo, marca como `quarantined`.
- Si el evento es de schema **posterior** al cloud: rechaza con error
  claro, el outbox lo reintenta cuando cloud se actualice.
- **El cloud nunca descarta un evento silenciosamente.**

### Snapshot diario como backup

Cada noche (después del cierre del bar), el local hace un dump completo
de las tablas operativas del día y lo sube a S3 (formato Postgres dump
o JSON estructurado). Es el respaldo ante "el outbox falló silenciosa-
mente durante 8 horas" — sin esto, esa categoría de fallo es
detectable pero no recuperable.

---

## 5. Modo operativo y control

Tabla `OperationalMode` registra las transiciones entre modos. Es
crítica para postmortem: cuando preguntás "¿qué pasó anoche?", esta
tabla te da la respuesta literal.

```prisma
enum OperationalModeKind {
  CLOUD_NORMAL    // Cloud responde + local sincronizado (estado base)
  LOCAL_PRIMARY   // Cloud no responde, local operando standalone
  LOCAL_DEGRADED  // Cloud OK pero outbox atrasado > N min
  RECOVERY        // Cloud volvió, drenando outbox pendiente
  EMERGENCY       // Modo manual forzado por staff
  MAINTENANCE     // Local apagado intencionalmente
}

model OperationalMode {
  id          BigInt @id @default(autoincrement())
  node_id     String
  mode        OperationalModeKind
  reason      String?
  detected_by String  // "auto_health_check" | email del admin que cambió
  started_at  DateTime @default(now())
  ended_at    DateTime?
  // Métricas snapshot al cierre del modo, útiles para postmortem
  events_queued    Int?
  events_synced    Int?
  duration_seconds Int?

  @@index([node_id, started_at])
  @@index([mode, ended_at])
}
```

El sistema cambia de modo automáticamente:

- Healthcheck del cloud falla 3 veces seguidas (15s entre tries):
  `CLOUD_NORMAL` → `LOCAL_PRIMARY`.
- Healthcheck vuelve a responder: `LOCAL_PRIMARY` → `RECOVERY` (drena
  outbox) → `CLOUD_NORMAL` al terminar.
- Outbox tiene más de N (a definir: ~50) eventos pendientes con cloud
  respondiendo: `CLOUD_NORMAL` → `LOCAL_DEGRADED` (alerta al admin).

Cambios manuales también registran (admin fuerza modo desde panel para
test o mantenimiento programado).

---

## 5.5 Ownership de stock — regla inviolable

**El campo `Product.stock` NUNCA es fuente de verdad. La fuente de
verdad son los `InventoryMovement` (más los descuentos derivados de
`OrderItem` y `OrderItemComponent`).**

`Product.stock` es un **valor materializado** para queries rápidas
("¿cuántas Águilas hay ahora?") sin tener que sumar todo el ledger
cada vez. Pero conceptualmente es un **derivado**:

```
stock(product, t) =
    inicial(product)
  + Σ InventoryMovement.quantity (signed) ≤ t
  − Σ OrderItem.quantity donde Order.status ∈ {accepted, preparing,
      ready, delivered} ≤ t
  − Σ OrderItemComponent.quantity para compuestos vendidos ≤ t
  + Σ ajustes por cancel/refund ≤ t
```

### Consecuencias prácticas

- **Cualquier código que haga `UPDATE Product SET stock = X` directo
  está prohibido.** Si necesitás corregir el stock manualmente, creás
  un `InventoryMovement` de tipo `correction` con el delta exacto. El
  valor `Product.stock` se ajusta solo como side-effect del movimiento.
- **El sync nunca empuja `Product.stock` cross-nodo.** Solo sincroniza
  los `InventoryMovement` (autoridad local) y deriva el stock al
  aplicar. Si cloud y local difieren en `Product.stock` durante una
  contingencia, no es un conflicto — es esperado, y se resuelve
  aplicando los movimientos pendientes al volver a sincronizar.
- **Reconciliación de stock = replay del ledger.** Si dudás del valor,
  re-sumás los movimientos desde el inicial conocido. Esto solo es
  posible si los movimientos están completos (de ahí la disciplina del
  outbox).

Esta regla protege de una clase entera de bugs futuros: scripts SQL
ad-hoc, "ajustes rápidos" que pisan reconciliaciones, dos nodos
peleándose por el último valor del campo. Si se respeta, los conflictos
de stock cross-nodo no existen — siempre se resuelven sumando eventos
en el orden correcto.

---

## 6. Autenticación cross-nodo

Cada nodo emite sus propios JWT con `iss` y `aud` específicos:

- Cloud emite tokens con `iss=cloud`, `aud=cloud` o `aud=web`.
- Local emite tokens con `iss=local-crown-001`, `aud=local` o
  `aud=local-web`.
- Mismo secret entre nodos al inicio (compartido en env var). Rotación
  independiente se incorpora cuando crezca el número de locales.

Cada token incluye:

- `kind`: "admin" | "session" | "table"
- `iss`: nodo emisor
- `aud`: scope
- `token_version`: número entero (también guardado en `User.token_version`)

Validación en cada request:

- `iss` ∈ lista de nodos confiables.
- `aud` matchea el endpoint que recibe.
- `token_version` matchea la del User actual (permite force-logout
  global incrementando el número).

### Revocación

- Logout normal: cliente borra token de storage.
- Force-logout de un User: incrementar `User.token_version`. Todos sus
  tokens viejos invalidan al próximo request.
- Compromiso de un nodo: invalidar todos los tokens con `iss=<nodo>` (a
  implementar con denylist temporal si surge el caso).

---

## 7. Catálogo: sync cloud → local

Al iniciar el local (cada arranque o cada N horas configurables), se
hace un pull completo del catálogo desde cloud:

- `GET /sync/catalog?since=<last_sync_at>`
- Cloud devuelve diffs de Product, Recipe, User, Setting, etc.
- Local hace upsert por PK (que viene del cloud — no hay autoincrement
  loca para entidades de catálogo).

Durante operación, cuando admin edita catálogo en cloud:

- Cloud emite un webhook POST a `local.crown-490.com/sync/catalog-push`
  con el cambio.
- Si el webhook falla (local no responde), el cambio se queda en una
  cola interna del cloud (`CatalogPushQueue`) que reintenta hasta que
  local conteste o pase un timeout (~1 hora) — en cuyo caso se hace
  catch-up al próximo pull.

### Caveat: catálogo NO se edita desde local

Si admin abre `/admin/products` en modo `LOCAL_PRIMARY`, los endpoints
de modificación responden 503 con mensaje "Catálogo en modo lectura
hasta que vuelva cloud". El staff no puede crear productos, editar
precios ni cambiar recetas mientras cloud esté caído.

---

## 8. Recursos compartidos con unique constraints

### BarAccessCode

Solo cloud rota. Local recibe el código vigente al sincronizar
catálogo. Si cloud cae con un código vigente, ese código sigue
funcionando hasta su `expires_at` (24h). Si expira durante
contingencia, el local **mantiene el último código vigente** y no rota
hasta que cloud vuelva — es un trade-off operativo aceptable.

### LuggageTicket

Pool preasignado por nodo. Cada nodo recibe un rango exclusivo.

- Cloud: tickets `1-99999`.
- Local-crown-001: tickets `100000-109999`.
- Local-crown-002: tickets `110000-119999`.

El partial unique index pasa de `(ticket_number, status='active')` a
`(node_id, ticket_number, status='active')`. **El cliente sigue viendo
"Ficha 12"** — agregamos `ticket_pool_id` interno que combina
`(node_id, ticket_number)`. Si las fichas físicas requieren un esquema
visible (por ejemplo prefijo `L01-12`), eso es decisión operativa
posterior.

Migration aplica una columna `ticket_pool_id String` calculada como
`{node_id}:{ticket_number}` con unique partial sobre
`(ticket_pool_id, status='active')`.

---

## 9. PlaybackState — persistido localmente

El estado de reproducción se persiste en Postgres local para que el
player TV pueda reconstruir su estado tras un restart:

```prisma
model PlaybackState {
  id                Int       @id @default(autoincrement())
  current_song_id   Int?
  queue_item_id     Int?
  status            PlaybackStatus
  started_at        DateTime?
  paused_at         DateTime?
  position_ms       Int       @default(0)
  player_device_id  String?   // identifica al TV (por si hay >1)
  last_heartbeat_at DateTime?
  updated_at        DateTime  @updatedAt
}
```

- `last_heartbeat_at` se actualiza cada N segundos por el player. Si el
  worker detecta heartbeat > 60s sin actualizar, marca el playback
  como stale.
- Al reiniciar el player, lee la última fila, reproduce desde
  `position_ms` y emite heartbeats.
- NO se replica al cloud.

---

## 10. QR de mesas

Los QR físicos apuntan a una URL canónica:

```
crownbar490.com/m/{table_qr_code}?t={table_token}
```

Un **edge gateway** (Cloudflare Worker, Vercel Edge o un endpoint
ligero del propio cloud) hace health check al local:

1. `HEAD https://bar.crownbar490.com/health` con timeout 2s.
2. Si responde 200 → 302 redirect a `bar.crownbar490.com/mesa/{id}?t=...`.
3. Si falla o timeout → 302 redirect a `crownbar490.com/mesa/{id}?t=...`
   (cloud).

**MVP 1 acepta degradación graciosa:** el QR apunta a cloud puro. Si
cloud cae, los clientes ven una pantalla "Acércate a la barra para tu
pedido". El staff toma orden manual. Es subóptimo pero la
implementación del edge gateway se difiere a MVP 3.

---

## 11. Música y contingencia

La música es una propuesta de valor diferenciadora del bar. **No
desaparece** en contingencia — solo se restringe la búsqueda externa.

**Lo que sigue funcionando en modo `LOCAL_PRIMARY`:**

- `QueueItem`: cola local persistida.
- `PlaybackState`: estado de reproducción persistido (ver sección 9).
- `Player TV`: sigue reproduciendo lo que ya está en cola.
- Fairness, cooldown, anti-monopolio, prioridad por consumo: toda la
  lógica corre local (ya está implementada server-side).
- Clientes en mesa pueden agregar canciones que **ya existen en `Song`
  cacheada** (cualquier canción reproducida antes en el bar).
- Admin puede saltar, reordenar, agregar canciones de la
  `HousePlaylistItem` cacheada localmente.

**Lo que se deshabilita:**

- **Búsqueda externa** (`GET /music/search`) — requiere YouTube Data
  API que necesita internet hacia Google. Si solo cae Railway pero
  internet sigue OK, la búsqueda SÍ funciona (el local llama directo a
  `googleapis.com`). Si cae internet completo, búsqueda se deshabilita
  con mensaje claro.
- **Reproducción de canciones nuevas no cacheadas** si cae internet
  completo (YouTube IFrame requiere internet).

**Estrategia de cache:**

- `Song` se replica de cloud → local en el sync inicial.
- `HousePlaylistItem` también.
- Cada nueva `Song` agregada en cloud se pushea al local por webhook
  (sección 7).
- Local conserva metadata (`title`, `duration`, `youtube_id`) — el
  archivo de audio NO se cachea (descartado para MVP 1-3; ver MVP 4
  para "biblioteca local MP3" si el caso se vuelve crítico).

**Bluetooth como respaldo último:**

Si cae internet completo Y la cola se queda sin canciones reproducibles
del cache, el staff puede conectar Bluetooth desde su celular como
respaldo. El sistema musical NO se rompe — solo deja de generar cola
nueva hasta que vuelva el internet.

Comunicación visible al cliente solo cuando aplica:

> "Búsqueda de canciones temporalmente no disponible. Puedes seguir
> agregando canciones de las que ya están en el sistema."

---

## 12. Pagos

| Tipo | Cloud caído | Internet del local caído |
|---|---|---|
| Efectivo | ✅ Funciona | ✅ Funciona |
| Pagos parciales | ✅ Funciona (queda en local) | ✅ Funciona |
| Tarjeta con datafono físico | ✅ Funciona (es independiente) | ✅ Funciona (datafono usa su propio 4G) |
| Pagos online (PSE, Bold, Nequi) | ⚠️ Webhooks no llegan | ❌ No funciona |

Todos los pagos quedan registrados en `Consumption` (efectivo y
parciales) o `TableSession.paid_at` (cierre). Cuando cloud vuelva, los
webhooks de pasarela online se reconcilian con los registros locales
del admin (matching manual por monto y timestamp).

---

## 12.5 Observabilidad histórica — `LocalHealthSnapshot`

El sync worker captura una fotografía operativa del local cada 5
minutos. Esto te da observabilidad histórica para postmortem y para
detectar pérdida silenciosa de datos.

```prisma
model LocalHealthSnapshot {
  id                       BigInt   @id @default(autoincrement())
  node_id                  String
  taken_at                 DateTime @default(now())
  open_sessions            Int
  pending_orders           Int
  active_queue_items       Int
  pending_outbox_events    Int
  inventory_movements_today Int
  consumptions_today       Int
  total_revenue_today      Decimal  @db.Decimal(12, 2)
  active_luggage_tickets   Int
  current_mode             OperationalModeKind
  // Salud del sistema
  cloud_reachable          Boolean
  last_successful_push_at  DateTime?
  oldest_pending_event_at  DateTime?

  @@index([node_id, taken_at])
}
```

### Casos de uso

- **Postmortem "se perdieron 3 mesas"**: se puede reconstruir cuántas
  sesiones había abiertas en cada momento.
  ```
  19:05 → 12 mesas
  19:10 → 14 mesas
  19:15 → 15 mesas
  19:20 → 12 mesas  ← caída detectada acá
  ```
- **Detección de outbox stuck**: si `pending_outbox_events` crece
  monotónicamente por >30min, alerta a Sentry.
- **Detección de pérdida de stock**: cruzar `inventory_movements_today`
  con totals de Consumption esperados.
- **Reporte ejecutivo del día**: el último snapshot del día tiene el
  cierre.

### Política de retención

- En local: conservar últimos 30 días.
- En cloud (al sincronizar): conservar indefinidamente — son ~288
  snapshots/día × 365 ≈ 105K filas/año, costo despreciable.

### Implementación

Cron interno del worker, llamada cada 300s a una función pura que
hace los counts y persiste. NO se hace dentro de transacción del
service (es snapshot puro, no afecta consistencia).

---

## 13. Deployment del local

El mini-PC corre Docker Compose con los servicios:

- `backend`: imagen NestJS (misma del cloud, env `MODE=local`).
- `postgres`: Postgres 14+ con volumen en SSD.
- `nginx`: reverse proxy con cert TLS (Let's Encrypt vía DDNS).

**Actualizaciones controladas, no automáticas.**

NO se usa Watchtower ni equivalentes que auto-actualicen. El riesgo es
real: un deploy automático a las 20:30 mientras juega Colombia y el
bar está lleno detiene el servicio.

Política de actualización:

- Las imágenes Docker se publican al registry como parte del CI normal.
- El mini-PC NO las pulla automáticamente.
- Vos disparas el update manualmente con `./deploy-local.sh update`
  desde SSH, en ventanas de mantenimiento programadas (típicamente
  03:00-05:00 AM o lunes en la mañana, cuando el bar está cerrado).
- Si una actualización trae migrations, se sigue el flow de la sección
  anterior.

Esta política intercambia automatización por **previsibilidad
operativa**, que es lo correcto para un sistema crítico de operación
en vivo.

### Migrations — controladas, NUNCA automáticas al arranque

Las migrations Prisma **NO** corren automáticamente al iniciar el
contenedor. Una migration fallida al reiniciar el mini-PC en hora pico
detendría el bar entero.

Política:

1. Al arrancar, el backend verifica `schema_version` actual contra la
   esperada por el código.
2. Si **coinciden**: arranca normal.
3. Si la BD está **adelantada** respecto al código: arranca normal
   (assume rolling deploy, código viejo con schema nuevo es seguro si
   las migrations fueron aditivas).
4. Si la BD está **atrasada**: arranca en modo **`MAINTENANCE`**:
   - Backend levanta el endpoint `GET /health` con `503 + reason=schema_outdated`.
   - Frontend muestra banner rojo "Sistema en mantenimiento — ejecutar
     migración pendiente".
   - Operativa: no atiende requests de negocio.

Las migrations se aplican explícitamente con:

```bash
./deploy-local.sh migrate
# o
npm run migrate:prod
```

Que vos disparas remotamente vía SSH después de pushear la imagen
nueva. Esto te da control de **cuándo** se ejecuta (típicamente fuera
de hora de servicio).

Para releases con migrations, el orden es:

1. Pushear imagen al registry.
2. Avisar al bar que va a haber mantenimiento corto.
3. SSH al mini-PC → `./deploy-local.sh migrate`.
4. Pull de imagen + restart contenedor → migrations corren →
   verificación → arranque normal.
5. Si algo falla, el mini-PC queda en `MAINTENANCE` con backend que
   responde 503 — el QR gateway redirige a cloud automáticamente.

### Backups

- Backup primario: `pg_dump` cada noche al disco secundario SSD del
  mismo PC.
- Backup secundario: snapshot a S3 con retención 30 días.
- Restore probado mensualmente — sin verificación, no es un backup.

### Hardware mínimo

- Mini-PC tipo NUC o equivalente: 8GB RAM, 256GB SSD, Intel i3/i5 o Ryzen 3/5.
- UPS de respaldo (~$50 USD).
- WiFi del bar dedicada al equipo (no compartida con clientes).
- Conexión cableada Ethernet al router preferiblemente.

---

## 13.5 Objetivos de continuidad (RTO / RPO)

Términos estándar de continuidad de negocio aplicados a Crown Bar:

- **RTO** (Recovery Time Objective): cuánto tarda el sistema en estar
  operativo después de una falla.
- **RPO** (Recovery Point Objective): cuánta data se pierde como
  máximo aceptable en una falla catastrófica.

### Objetivos comprometidos

| Falla | RTO objetivo | RPO objetivo | Cómo se garantiza |
|---|---|---|---|
| **Cloud caído** (Railway no responde) | < 30 s | 0 | Local sigue operando standalone; transición automática a `LOCAL_PRIMARY` por health check. |
| **Internet del local caído** | < 30 s | 0 | Operación 100% local; los clientes en mesa siguen conectados al WiFi del bar. Búsqueda externa de YouTube deshabilitada (degradación controlada). |
| **Mini-PC del local apagado** (corte de luz, falla hardware) | 1-5 min con UPS · varias horas sin UPS | 0 si el UPS soportó la transición · hasta 5 min sin UPS | UPS obligatorio. Postgres con `fsync=on` (default). Outbox transaccional garantiza atomicidad. |
| **Postgres local corrupto** | 30-60 min | 24 h máximo | Restore desde snapshot diario a S3 (RPO = ventana hasta el último snapshot). Snapshots probados mensualmente. |
| **Mini-PC físicamente destruido** | 4-8 h (compra + setup + restore) | 24 h | Snapshot diario en S3 + script de provisionamiento documentado. |
| **Cloud destruido completamente** | 1-4 h | 0 | Los datos de operación viven en local. Cloud se reconstruye desde último snapshot + el outbox local replica el resto. |

### Lo que NO se compromete

- **Recuperación de transacciones individuales perdidas dentro del
  contexto de un crash entre escritura local y commit:** la
  atomicidad de Prisma protege, pero un crash del mini-PC entre el
  `INSERT` y el `COMMIT` puede perder esa transacción específica
  (Postgres rollback automático). El RPO de 0 asume crashes después
  del COMMIT.
- **Tiempo de respuesta normal del cloud durante `RECOVERY`:** mientras
  el outbox drena el backlog, las queries cloud pueden ser más lentas.
  No degrada operación local pero sí el dashboard remoto.

### Cómo medirlo

`LocalHealthSnapshot` registra `cloud_reachable` y
`last_successful_push_at`. `OperationalMode` registra duración de
cada modo. Cruzando ambos se obtienen métricas reales:

- RTO efectivo = duración promedio de `LOCAL_PRIMARY` antes de
  `RECOVERY`.
- RPO efectivo = `MAX(taken_at) - last_successful_push_at` durante
  contingencia.

Si el sistema en producción supera consistentemente los objetivos
arriba, revisar arquitectura o ajustar objetivos.

---

## 14. Plan de roadmap

| MVP | Alcance | Horas estimadas |
|---|---|---|
| **MVP 0** (este documento) | Documento ancla + migration `external_id` | 4-8 h |
| **MVP 1** | Local básico standalone: mini-PC operativo sin sync, reconciliación manual al cierre | 60-100 h |
| **MVP 2** | OutboxEvent + sync worker + endpoint cloud `/sync/ingest` + `OperationalMode` + `PlaybackState` persistido + schema versioning + auth con `iss` | 120-180 h |
| **MVP 3** | Edge gateway con health check + autoswitch del cliente + reconciliación bidireccional de catálogo + pool de fichas Luggage | 100-160 h |
| **MVP 4** | Snapshots a S3 + restore verificable + dashboard de salud del sync + caos testing | 80-140 h |
| **Total** | | **360-580 h** |

---

## 15. Decisiones explícitas (anti-revisionismo)

Esto NO se hace, y si en el futuro alguien lo propone, debe justificar
por qué se invierte la decisión:

- **NO** event sourcing puro — Consumption ledger ya cumple para
  trazabilidad financiera; reescribir todo a eventos es overkill.
- **NO** CRDTs — entidades operativas no compiten cross-nodo en la
  realidad operativa (una mesa solo vive en un nodo a la vez).
- **NO** replicación master-master de Postgres — operativamente
  inmanejable.
- **NO** microservicios — el monolito actual es apropiado para el
  volumen del bar.
- **NO** Kubernetes — Railway + mini-PC con Docker Compose es
  suficiente.
- **NO** Kafka — `OutboxEvent` con polling cada 5s es suficiente para
  el volumen.
- **NO** GraphQL — REST + tipos compartidos en `packages/shared`
  resuelve.
- **NO** cache distribuido (Redis) — Postgres con índices alcanza.

---

## 16. Glosario

- **Cloud**: Railway hosting el backend principal y Postgres archivo.
- **Local**: mini-PC en el bar con backend + Postgres + sync worker.
- **Nodo**: cualquier instancia del backend (cloud o uno de los locales).
- **Outbox**: tabla local que registra cambios pendientes de pushear al
  cloud.
- **External_id**: UUID estable cross-nodo de una entidad operativa.
- **Modo operativo**: estado actual del sistema (CLOUD_NORMAL,
  LOCAL_PRIMARY, etc.).
- **Catálogo**: entidades cuya autoridad es cloud (productos, recetas,
  usuarios).
- **Operación**: entidades cuya autoridad es local (sesiones, órdenes,
  consumos).
- **Drenado**: proceso del sync worker que vacía el outbox al cloud.
- **Quarantine**: estado de un evento del outbox que no puede aplicarse
  al cloud por incompatibilidad de schema o error permanente.

---

_Última actualización: 2026-06-08 — versión 1.2.0. Toda PR de
sincronización, deployment o continuidad debe referenciar la sección
de este documento que aplica._

### Changelog

- **1.2.0** (2026-06-08): aplicados 4 refuerzos — (A) `NodeRegistry`
  como catálogo formal de nodos con heartbeat, versionado y pool de
  fichas Luggage por nodo (§3.5); (B) `idempotency_key` UUID en
  `OutboxEvent` con unique `(node_id, idempotency_key)` para
  deduplicar reintentos de transporte (§4.1); (C) ownership de stock
  declarado inviolable — `Product.stock` materialización, no autoridad;
  prohibido `UPDATE stock=X` directo (§5.5); (D) objetivos RTO/RPO
  explícitos por tipo de falla (§13.5).
- **1.1.0** (2026-05-18): aplicados 5 ajustes — (1) música no muere en
  modo local: cola/playback/fairness siguen, solo búsqueda externa se
  deshabilita si no hay internet; (2) migrations no automáticas al
  arrancar contenedor — flujo `MAINTENANCE` explícito y `deploy-local.sh
  migrate` manual; (3) sin Watchtower — updates manuales en ventanas
  programadas; (4) agregado `LocalHealthSnapshot` cada 5 min; (5) Payment,
  PartialPayment, CashMovement declarados explícitamente como dominio
  operativo aunque hoy se materialicen vía Consumption + TableSession.
- **1.0.0** (2026-05-18): versión inicial.
