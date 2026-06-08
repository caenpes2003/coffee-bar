# Crown Bar 4.90 — Casos de uso y funcionalidades

Documento exhaustivo de todas las funcionalidades (funcionales y no
funcionales) del sistema. Generado a partir del recorrido del código
en `apps/backend/`, `apps/frontend/` y `packages/shared/`.

**Stack:** NestJS 11 + Prisma 6 + Postgres + Socket.io · Next.js 16 + React.

---

## Tabla de contenidos

1. [Actores del sistema](#1-actores-del-sistema)
2. [Casos de uso por actor](#2-casos-de-uso-por-actor)
3. [Endpoints del backend](#3-endpoints-del-backend)
4. [Modelo de datos](#4-modelo-de-datos)
5. [Lógica de negocio destacable](#5-lógica-de-negocio-destacable)
6. [Páginas del frontend](#6-páginas-del-frontend)
7. [Componentes admin reutilizables](#7-componentes-admin-reutilizables)
8. [Eventos realtime (Socket.io)](#8-eventos-realtime-socketio)
9. [Auditoría](#9-auditoría)
10. [Requisitos no funcionales](#10-requisitos-no-funcionales)
11. [Migraciones](#11-migraciones)
12. [Códigos de error](#12-códigos-de-error)

---

## 1. Actores del sistema

| Actor | Identificación | Token |
|---|---|---|
| **Cliente** | Entra a `/mesa/[id]` desde QR físico de mesa | `session_token` JWT (kind=`session`) + `table_token` JWT (kind=`table`) |
| **Staff** | Login admin con email + password | `admin_token` JWT (kind=`admin`, role=`staff`) |
| **Admin** | Login admin con role superior | `admin_token` JWT (kind=`admin`, role=`admin`) |
| **Player TV** | Pantalla en la barra (`/player`) | Sin auth (canal global de socket) |
| **Anónimo** | Visitante en landing o player | Sin token |
| **Sistema** | Cron, jobs internos, lazy rotation | N/A |

---

## 2. Casos de uso por actor

### 2.1 Cliente (en `/mesa/[id]`)

#### Acceso e ingreso

- **C-01** Escanea QR físico de mesa → navegador abre `/mesa/[id]?t=<table_token>`.
- **C-02** Ingresa código de acceso de 4 dígitos del bar → valida con `POST /access-code/validate`.
- **C-03** Inicia sesión de mesa (la primera vez) → `POST /table-sessions/open` con el `table_token` + `access_code`.
- **C-04** Si la mesa ya tiene sesión abierta, se une a la existente (multi-dispositivo por mesa).
- **C-05** El `session_token` se persiste en `sessionStorage` del navegador.
- **C-06** Si el token caduca, refresca con `POST /table-sessions/refresh`.

#### Catálogo y carrito

- **C-07** Ve el catálogo público de productos activos (`GET /products`).
- **C-08** Ve las recetas de productos compuestos (`GET /products/recipes`) — cubetazos, sixpacks, combos.
- **C-09** Construye el carrito localmente (cantidad por producto + composición por unidad armable).
- **C-10** Para productos compuestos armables, abre un picker de composición (`CompositionPicker`) para elegir mezcla (ej. 4 Águila + 2 Poker en un cubetazo).
- **C-11** Envía pedido (`POST /order-requests`) que queda en estado `pending`.
- **C-12** Edita un pedido pendiente antes de que el staff lo acepte (`PATCH /order-requests/:id`).
- **C-13** Cancela un pedido pendiente (`POST /order-requests/:id/cancel`).
- **C-14** El catálogo se actualiza en tiempo real cuando admin cambia precios/stock (`product:updated` socket).

#### Música

- **C-15** Busca canciones en YouTube (`GET /music/search?q=...`).
- **C-16** Agrega una canción a la cola de su mesa (`POST /queue`).
- **C-17** Tiene un límite base de **5 canciones simultáneas en cola** (`MAX_SONGS_PER_TABLE`).
- **C-18** Gana **créditos de canción extra** cuando su mesa consume ≥ $20.000 (`EXTRA_SONG_CONSUMPTION_THRESHOLD`).
- **C-19** Ve sus canciones encoladas, en reproducción e historial (`GET /queue?table_id=X&since=...&include_history=true|false`).
- **C-20** Si su canción se salta, recupera el crédito (cuando era `is_extra=true`).
- **C-21** Recibe en tiempo real el estado de la cola global (`queue:updated` socket).

#### Cuenta y pago

- **C-22** Ve la factura actual (`GET /bill/:sessionId`) con subtotal, descuentos, ajustes, refunds y pagos parciales.
- **C-23** Pide la cuenta (`POST /table-sessions/:id/request-payment`) — bloquea nuevos pedidos hasta que admin cobre o cancele.
- **C-24** Cancela la solicitud de cuenta si quiere seguir consumiendo (`POST /table-sessions/:id/cancel-payment-request`).
- **C-25** Ve en tiempo real cuando admin marca como pagado (`table-session:updated` socket).
- **C-26** Ve actualizaciones de cada orden (`order:created` / `order:updated` socket).

---

### 2.2 Staff (login admin, todas las personas con acceso al panel)

#### Autenticación

- **S-01** Login con email + password (`POST /auth/login`). Recibe JWT.
- **S-02** Si falla 5 veces → cuenta bloqueada por 20 minutos (`locked_until`).
- **S-03** Recupera contraseña olvidada (`POST /auth/forgot-password`).
- **S-04** Resetea contraseña con token (`POST /auth/reset-password`).
- **S-05** Lee su propia sesión (`GET /auth/me`).

#### Mesas y sesiones

- **S-06** Ve mapa de mesas en tiempo real (`TablesMap` en `/admin`).
- **S-07** Ve indicadores: status (available/occupied/closing), pedidos activos, solicitudes pendientes, consumo actual.
- **S-08** Abre cuenta para una mesa física manualmente (`POST /admin/table-sessions/open`) — útil cuando el cliente no escanea el QR.
- **S-09** Abre **cuenta virtual de barra (walk-in)** con un click (`POST /tables/bars/walkin`) — para clientes de pie sin mesa.
- **S-10** Crea/elimina cuentas BAR virtuales independientes (`POST/DELETE /tables/bars/[:id]`).
- **S-11** Asigna nombre personalizado a una sesión (`custom_name`) — útil para BAR (ej. "Camilo").
- **S-12** Ve la lista de pedidos pendientes en columna del dashboard.
- **S-13** Acepta un pedido pendiente (`POST /order-requests/:id/accept`) — crea Order, descuenta stock.
- **S-14** Rechaza un pedido con razón (`POST /order-requests/:id/reject`).
- **S-15** Agrega productos directamente a una cuenta sin pasar por flow del cliente (`POST /order-requests/admin/quick-add` desde `AdminBillDrawer`).

#### Operaciones sobre órdenes

- **S-16** Marca una orden como `delivered` (`PATCH /orders/:id/status`) → genera Consumption.
- **S-17** Marca una orden como `preparing` (estado intermedio, opcional).
- **S-18** Marca una orden como `ready` (estado intermedio, opcional).
- **S-19** Cancela una orden activa (`PATCH /orders/:id/status` con `cancelled`) → restaura stock incluyendo composiciones reales de productos compuestos.
- **S-20** Recibe alerta en tiempo real cuando se entrega una orden con precio diferente al actual del producto (`price-mismatch` socket).

#### Cobro y cierre

- **S-21** Abre drawer de factura al hacer click en una mesa (`AdminBillDrawer`).
- **S-22** Ve detalle de consumos: productos, ajustes, descuentos, refunds, pagos parciales.
- **S-23** Agrega un cargo manual a la cuenta (`POST /bill/:sessionId/adjustments`).
- **S-24** Agrega un descuento manual a la cuenta.
- **S-25** Registra un pago parcial en efectivo antes del cierre (`POST /bill/:sessionId/partial-payment`).
- **S-26** Reversa un consumo (`POST /consumptions/:id/refund`) — restaura stock si era producto, marca el original como `reversed_at`.
- **S-27** Marca la sesión como pagada y la cierra (`POST /table-sessions/:id/mark-paid`).
- **S-28** **Anula una sesión sin cobrar** (`POST /table-sessions/:id/void`) con razón obligatoria (`customer_left`, `admin_error`, `comp`, `other`). Si reason=`other`, requiere texto libre.

#### Ingresos extra (no operacionales)

- **S-29** Registra cobro de baño de hombre con un click ($2.000 forzado por backend) — `POST /admin/extra-income/restroom` con `subtype=male`.
- **S-30** Registra cobro de baño de mujer con un click ($2.000 forzado).
- **S-31** Registra ingreso manual con concepto + monto libre (`POST /admin/extra-income/manual`) — para bodegaje, rentas eventuales, sponsoreos.
- **S-32** Reversa un ingreso extra con razón obligatoria (`POST /admin/extra-income/:id/reverse`). No se borra: queda `status=reversed`.
- **S-33** Ve el dock flotante con cobros rápidos en `/admin` (`ExtrasDock`).
- **S-34** El dock se oculta automáticamente cuando hay un modal/drawer abierto para no taparlos.

#### Guardarropa (maletas)

- **S-35** Registra nueva maleta (`POST /admin/luggage`) con ficha física 1-30 + datos del cliente + precio fijo $5.000.
- **S-36** El sistema impide registrar 2 maletas activas con la misma ficha (partial unique index en BD).
- **S-37** Marca una maleta como pagada (`PATCH /admin/luggage/:id/payment`).
- **S-38** Entrega una maleta (`POST /admin/luggage/:id/deliver`) — solo si está `paid`. Libera la ficha al pool.
- **S-39** Si la maleta no está pagada, NO se puede entregar — bloqueo en backend y UI.
- **S-40** Reporta incidente sobre una maleta perdida o problema (`POST /admin/luggage/:id/incident`) con razón obligatoria — libera la ficha al pool y permite cortesías auditadas.
- **S-41** Busca maletas por nombre, apellido, teléfono o número de ficha (`GET /admin/luggage/search?q=...`).
- **S-42** Lista maletas activas con sus datos completos.

#### Música (control)

- **S-43** Ve la cola actual en `MusicPanel` del dashboard.
- **S-44** Inicia la reproducción de la siguiente canción (`POST /queue/play-next`).
- **S-45** Termina la canción actual (`POST /queue/finish-current`).
- **S-46** Avanza a la siguiente sin terminar la actual (`POST /queue/next`).
- **S-47** Salta un item específico (`PATCH /queue/:id/skip`) — devuelve el crédito si era `is_extra`.
- **S-48** Busca canciones en YouTube como admin.
- **S-49** Agrega canción a la cola sin restricciones (`POST /queue/admin`).
- **S-50** Reproduce una canción al instante saltando el orden (`POST /queue/admin/play-now`).

#### Códigos de acceso

- **S-51** Ve el código de acceso vigente del bar (`GET /access-code/current`) — para mostrar al cliente que pregunta cómo entrar.
- **S-52** Rota el código forzosamente (`POST /access-code/rotate`).

---

### 2.3 Admin (todo lo de staff +)

#### Productos

- **A-01** Ve catálogo completo con filtros activo/inactivo/bajo stock (`/admin/products`).
- **A-02** Busca productos por nombre/categoría.
- **A-03** Crea producto nuevo con nombre, descripción, precio (entero), stock inicial, categoría.
- **A-04** Edita metadata de producto (`PATCH /admin/products/:id`): nombre, descripción, precio, categoría, low_stock_threshold.
- **A-05** Backend rechaza precios fraccionarios (`@IsInt` en DTO) — bloquea $3.333,50 o similares.
- **A-06** Activa/desactiva producto (`PATCH /admin/products/:id/activate` o `/deactivate`).
- **A-07** Productos desactivados no aparecen en el catálogo del cliente ni en grids de venta.
- **A-08** Registra movimiento de inventario directo (`POST /admin/products/:id/stock-movements`) con tipo (`restock`, `adjustment`, `waste`, `correction`) + razón + cantidad signed.
- **A-09** Ve historial de movimientos de stock por producto.

#### Recetas (productos compuestos)

- **A-10** Ve receta actual de un producto compuesto (`GET /admin/products/:id/recipe`).
- **A-11** Edita receta completa de un producto (`PUT /admin/products/:id/recipe`) con `ProductRecipeEditor` — define slots (Cervezas, Licor) con sus opciones (componentes) y default_quantity.
- **A-12** Borrar la receta (slots = []) convierte el producto en simple — al venderse descuenta de su propio stock.
- **A-13** El sistema valida que la suma de defaults por slot iguale `slot.quantity`.
- **A-14** Las recetas se broadcastean en tiempo real al frontend (`product:updated` socket).

#### Reportes de ventas

- **A-15** Ve resumen general en `/admin/sales` tab **Resumen**:
  - KPIs: Ingresos · Extras · Total general · Tickets · Ticket promedio · Unidades
  - Charts: ingresos por día, promedio por día de semana, picos por hora
  - Top vendidos por unidades y por revenue
  - Productos por categoría
  - Productos sin rotación (con stock, 0 ventas)
  - Hero accionable de stock bajo en productos de alta demanda
  - Deltas vs período anterior
- **A-16** Ve detalle por cuenta cerrada en tab **Detalle**:
  - Lista de TableSession con `paid_at` o `voided_at` en el rango
  - Cada cuenta se expande tipo ticket térmico con monoespaciado
  - Bordes dentados arriba/abajo (efecto impresora)
  - Header con logo blackletter "Crown Bar 4.90"
  - Productos agrupados por descripción (5× Coronita aparece como una sola línea)
  - Composiciones de cubetazos expandibles si tuvieron mezclas distintas
  - Detalle de subtotales, ajustes, anticipos, total cobrado
  - Badge "Anulada" en sesiones void con razón
- **A-17** Ve catálogo con métricas en tab **Productos**:
  - Tabla con buscador, columnas clickeables para ordenar, paginación 20/página
  - Métricas: unidades vendidas (directas + via compuesto), revenue, ticket promedio, % del total
  - Cuando un producto se vendió como componente de cubetazo, muestra desglose "8 + 4c"
  - Filtro opcional para incluir productos inactivos
- **A-18** Ve ingresos extras en tab **Extras**:
  - KPIs combinados: Total extras / Baños / Maletas cobradas / Maletas activas
  - Servicio de baño con desglose por género + tabla de historial
  - Maletas activas con acciones rápidas (Pagar / Entregar / Incidente)
  - Historial reciente de maletas
  - Tabla de ingresos manuales (cuando hay)
  - Reverso de cobros con razón obligatoria
- **A-19** Selector de rango común para todos los tabs: Hoy, Ayer, 7d, Este mes, Mes pasado, 30d, Custom.
- **A-20** Ve historial de ventas día-por-día de un producto específico (`GET /admin/sales/products/:id/history`) accesible desde links de los reportes.

#### Auditoría

- **A-21** Ve log de eventos en `/admin/auditoria` (`GET /audit-log?limit=100`).
- **A-22** Cada entrada muestra: tipo, actor, timestamp, IP (solo auth), detalles.
- **A-23** Cambios en productos muestran `from → to` con monto formateado y colores (rojo viejo, verde nuevo).
- **A-24** El sistema NO crea audit row si no hay cambios reales (changes vacíos se descartan).

#### Música base (house playlist)

- **A-25** Gestiona biblioteca interna en `/admin/musica-base`.
- **A-26** Pega URL de YouTube → backend valida server-side (`GET /house-playlist/validate?url=...`) con YouTube Data API.
- **A-27** Agrega item a biblioteca (`POST /house-playlist`).
- **A-28** El backend rechaza títulos/duration enviados por el frontend — solo cree lo que vino de YouTube API.
- **A-29** Crea categorías (`POST /house-playlist/categories`).
- **A-30** Renombra/borra categorías.
- **A-31** Asigna múltiples categorías a un item (M2M, `PATCH /house-playlist/:id/categories`).
- **A-32** Activa una categoría como "fuente del fill" (`PUT /house-playlist/active-category`) — cuando no hay canciones del cliente, el sistema rellena de acá.
- **A-33** Toggle is_active de cada item, reordena con sort_order, edita título.

#### Acceso

- **A-34** Configura código de acceso para el bar (rotación manual o automática cada 24h).

---

### 2.4 Player TV (sin auth, `/player`)

- **P-01** Muestra la canción en reproducción actual (`GET /playback/current`).
- **P-02** Lista próximas en la cola global (`GET /queue/global`).
- **P-03** Muestra el código de acceso del bar (`GET /access-code/display`) para que clientes nuevos lo vean al entrar.
- **P-04** Reproduce YouTube embed.
- **P-05** Auto-avanza al terminar una canción (notifica al backend con `PATCH /playback/playing`).
- **P-06** Reporta progreso periódico (`PATCH /playback/progress` con `position_seconds`).
- **P-07** Recibe `queue:updated` y `playback:updated` por socket (canal global).
- **P-08** Si no hay canciones del cliente, el backend rellena con house-playlist de la categoría activa.

---

### 2.5 Anónimo (sin login, sin sesión)

- **AN-01** Ve la landing en `/` con instrucción "Escanea el QR".
- **AN-02** Puede entrar a `/player` (sin auth) y ver reproducción + cola pública.
- **AN-03** Puede buscar canciones (`GET /music/search`) — rate-limited 20/min por IP.
- **AN-04** Puede ver el código de acceso vigente (`GET /access-code/display`).
- **AN-05** Puede ver la cola global (`GET /queue/global`).
- **AN-06** Puede validar un código de acceso (`POST /access-code/validate`).

---

### 2.6 Sistema (jobs / automático)

- **SYS-01** Genera y rota código de acceso lazily cada 24h (`AccessCodeService.getOrRotate`).
- **SYS-02** Auto-rellena cola cuando no hay canciones del cliente con house-playlist de la categoría activa.
- **SYS-03** Calcula `priority_score` de cada queue item (fairness): `consumption/1000 + wait_score - cooldown_penalty - dominance_penalty + recent_order_bonus`.
- **SYS-04** Detecta automáticamente price-mismatch al delivering: emite socket + AuditLog.
- **SYS-05** Recalcula contadores de mesa (active_order_count, pending_request_count, credits) cuando cambia el estado de una orden (`TableProjectionService`).
- **SYS-06** Restaura stock automáticamente cuando se cancela una orden, usando OrderItemComponent para composiciones exactas.
- **SYS-07** Broadcasting de cambios de producto a clientes (`product:updated`).
- **SYS-08** Emite eventos socket a rooms correctos según contexto (global / staff / session).

---

## 3. Endpoints del backend

### Autenticación (`/auth`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| POST | `/auth/login` | público | 5/min |
| GET | `/auth/me` | admin | — |
| POST | `/auth/forgot-password` | público | 3/min |
| POST | `/auth/reset-password` | público | 5/min |

### Códigos de acceso (`/access-code`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| POST | `/access-code/validate` | público | 8/min |
| GET | `/access-code/current` | admin | — |
| GET | `/access-code/display` | público | — |
| POST | `/access-code/rotate` | admin | — |

### Mesas (`/tables`)
| Método | Ruta | Auth |
|---|---|---|
| GET | `/tables` | admin |
| GET | `/tables/:id` | admin |
| GET | `/tables/:id/detail` | admin |
| PATCH | `/tables/:id/status` | admin |
| POST | `/tables/bars` | admin |
| DELETE | `/tables/bars/:id` | admin |
| POST | `/tables/bars/walkin` | admin |

### Sesiones de mesa (`/table-sessions`)
| Método | Ruta | Auth |
|---|---|---|
| POST | `/table-sessions/open` | table |
| POST | `/table-sessions/refresh` | table |
| POST | `/admin/table-sessions/open` | admin |
| GET | `/table-sessions/:id` | admin o session |
| GET | `/tables/:id/session/current` | table o admin |
| POST | `/table-sessions/:id/close` | admin |
| POST | `/table-sessions/:id/mark-paid` | admin |
| POST | `/table-sessions/:id/void` | admin |
| POST | `/table-sessions/:id/request-payment` | session |
| POST | `/table-sessions/:id/cancel-payment-request` | session o admin |

### Pedidos pendientes (`/order-requests`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| GET | `/order-requests` | admin o session | — |
| GET | `/order-requests/:id` | admin o session | — |
| POST | `/order-requests` | session | 12/min |
| POST | `/order-requests/:id/accept` | admin | — |
| POST | `/order-requests/admin/quick-add` | admin | 12/min |
| POST | `/order-requests/:id/reject` | admin | — |
| POST | `/order-requests/:id/cancel` | session o admin | — |
| PATCH | `/order-requests/:id` | session | — |

### Órdenes (`/orders`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| GET | `/orders` | admin o session | — |
| GET | `/orders/:id` | admin o session | — |
| PATCH | `/orders/:id/status` | admin | — |

### Productos (`/products`, `/admin/products`)
| Método | Ruta | Auth |
|---|---|---|
| GET | `/products` | público |
| GET | `/products/recipes` | público |
| GET | `/admin/products` | admin |
| POST | `/admin/products` | admin |
| PATCH | `/admin/products/:id` | admin |
| PATCH | `/admin/products/:id/activate` | admin |
| PATCH | `/admin/products/:id/deactivate` | admin |
| GET | `/admin/products/:id/recipe` | admin |
| PUT | `/admin/products/:id/recipe` | admin |
| POST | `/admin/products/:id/stock-movements` | admin |
| GET | `/admin/products/:id/stock-movements` | admin |

### Consumos y factura (`/bill`, `/consumptions`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| GET | `/bill/:sessionId` | admin o session | — |
| POST | `/bill/:sessionId/adjustments` | admin | 20/min |
| POST | `/bill/:sessionId/partial-payment` | admin | 20/min |
| POST | `/consumptions/:id/refund` | admin | 10/min |

### Cola musical (`/queue`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| GET | `/queue/global` | público | — |
| GET | `/queue/current` | público | — |
| GET | `/queue/stats` | público | — |
| GET | `/queue` | admin o session | 15/min |
| POST | `/queue` | session | 15/min |
| POST | `/queue/play-next` | admin | — |
| POST | `/queue/finish-current` | admin | — |
| POST | `/queue/next` | admin | — |
| POST | `/queue/skip-and-advance` | admin | — |
| POST | `/queue/admin` | admin | — |
| POST | `/queue/admin/play-now` | admin | — |
| PATCH | `/queue/:id/skip` | admin | — |

### Música externa (`/music`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| GET | `/music/search` | público | 20/min |
| GET | `/music/budget` | admin | — |

### Playlist de la casa (`/house-playlist`)
| Método | Ruta | Auth |
|---|---|---|
| GET | `/house-playlist` | admin |
| GET | `/house-playlist/categories` | admin |
| POST | `/house-playlist/categories` | admin |
| PATCH | `/house-playlist/categories/:id` | admin |
| DELETE | `/house-playlist/categories/:id` | admin |
| GET | `/house-playlist/active-category` | admin |
| PUT | `/house-playlist/active-category` | admin |
| GET | `/house-playlist/validate?url=...` | admin |
| POST | `/house-playlist` | admin |
| PATCH | `/house-playlist/:id` | admin |
| PATCH | `/house-playlist/:id/categories` | admin |
| DELETE | `/house-playlist/:id` | admin |

### Playback (`/playback`)
| Método | Ruta | Auth |
|---|---|---|
| GET | `/playback/current` | público |
| PATCH | `/playback/playing` | público (player) |
| PATCH | `/playback/progress` | público (player) |

### Reportes de ventas (`/admin/sales`)
| Método | Ruta | Auth |
|---|---|---|
| GET | `/admin/sales/insights` | admin |
| GET | `/admin/sales/products/:id/history` | admin |
| GET | `/admin/sales/sessions` | admin |
| GET | `/admin/sales/products` | admin |

### Auditoría (`/audit-log`)
| Método | Ruta | Auth |
|---|---|---|
| GET | `/audit-log` | admin |

### Ingresos extra (`/admin/extra-income`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| POST | `/admin/extra-income/restroom` | admin | sí |
| POST | `/admin/extra-income/manual` | admin | sí |
| GET | `/admin/extra-income` | admin | — |
| GET | `/admin/extra-income/summary` | admin | — |
| POST | `/admin/extra-income/:id/reverse` | admin | — |

### Guardarropa (`/admin/luggage`)
| Método | Ruta | Auth | Rate-limit |
|---|---|---|---|
| POST | `/admin/luggage` | admin | sí |
| GET | `/admin/luggage` | admin | — |
| GET | `/admin/luggage/search` | admin | — |
| GET | `/admin/luggage/summary` | admin | — |
| POST | `/admin/luggage/:id/deliver` | admin | — |
| POST | `/admin/luggage/:id/incident` | admin | — |
| PATCH | `/admin/luggage/:id/payment` | admin | — |

### Health (`/health`)
| Método | Ruta | Auth |
|---|---|---|
| GET | `/health` | público |

---

## 4. Modelo de datos

### Identidad y auth

- **User** — `id`, `name`, `email` (unique), `password_hash`, `role` (admin/staff), `is_active`, `failed_attempts`, `locked_until`, `last_failed_at`, `reset_token_hash`, `reset_expires_at`.
- **BarAccessCode** — `id`, `code` (4 dígitos), `is_active` (partial unique cuando true), `created_at`, `expires_at`, `rotated_by`.

### Operación del bar

- **Table** — `id`, `number` (unique), `qr_code` (unique), `kind` (TABLE/BAR), `status` (available/occupied/closing), `current_session_id` (FK unique nullable), `total_consumption`, `active_order_count`, `pending_request_count`, `last_activity_at`.
- **TableSession** — `id`, `table_id`, `status` (open/ordering/closing/closed/void), `custom_name`, `opened_by` (string), `payment_requested_at`, `paid_at`, `voided_at`, `void_reason`, `void_other_detail`, `voided_by`, `total_consumption`, `last_consumption_at`.
- **OrderRequest** — `id`, `table_session_id`, `status` (pending/accepted/rejected/cancelled), `items` (Json), `rejection_reason`, timestamps de cada estado.
- **Order** — `id`, `table_session_id`, `order_request_id` (unique), `status` (accepted/preparing/ready/delivered/cancelled), timestamps.
- **OrderItem** — `id`, `order_id`, `product_id`, `quantity`, `unit_price`.
- **OrderItemComponent** — `id`, `order_item_id`, `component_product_id`, `quantity`, `unit_index` (qué unidad del compuesto). Audita composiciones reales por venta.
- **Consumption** — Ledger principal. `id`, `table_session_id`, `order_id` (FK opt), `product_id` (FK opt), `description`, `quantity`, `unit_amount`, `amount`, `type` (product/adjustment/discount/refund/partial_payment), `reversed_at`, `reverses_id` (unique FK), `reason`, `notes`, `created_by`.

### Productos e inventario

- **Product** — `id`, `sku` (unique), `name`, `description`, `price` (Decimal 10,2 entero forzado), `stock`, `low_stock_threshold`, `is_active`, `category`.
- **ProductRecipeSlot** — `id`, `product_id`, `label`, `quantity` (total a llenar), `position`.
- **ProductRecipeOption** — `id`, `slot_id`, `component_id` (FK a Product), `default_quantity`, `position`. Unique en `(slot_id, component_id)`.
- **InventoryMovement** — `id`, `product_id`, `type` (restock/adjustment/waste/correction), `quantity` (signed), `reason`, `notes`, `created_by`.

### Música

- **Song** — `id`, `youtube_id` (unique), `title`, `duration`, `requested_by_table`.
- **QueueItem** — `id`, `song_id`, `table_id` (FK opt), `priority_score`, `status` (pending/playing/played/skipped), `position`, `is_extra` (boolean), `source` (customer/house), timestamps.
- **HousePlaylistItem** — `id`, `youtube_id` (unique), `title`, `artist`, `duration`, `is_active`, `sort_order`, `last_played_at`.
- **HousePlaylistCategory** — `id`, `name` (unique). M2M con items.
- **PlaybackState** — `id`, `status` (idle/buffering/playing/paused), `queue_item_id` (FK unique opt), `started_at`, `position_seconds`. Solo 1 fila activa.

### Ingresos no operacionales

- **ExtraIncome** — `id`, `type` (restroom/manual), `subtype` (male/female para baño), `amount`, `quantity`, `total_amount`, `status` (active/reversed), `concept` (para manual), `notes`, `created_by`, `reversed_*` (cuando aplica).
- **LuggageTicket** — `id`, `ticket_number` (1-30), `customer_first_name`, `customer_last_name`, `customer_phone`, `amount` ($5.000), `payment_status` (pending/paid), `status` (active/delivered/incident), `notes`, `created_by`, `delivered_*`, `incident_*`. Partial unique en `(ticket_number, status=active)`.

### Sistema

- **AuditLog** — Append-only. `id`, `kind` (enum), `actor_id`, `actor_label`, `summary`, `metadata` (Json), `ip` (auth events).
- **Setting** — Bolsa genérica clave-valor. `key` (PK string), `value` (Json), `updated_at`. Hoy guarda `house_playlist_active_category_id`.

### Enums principales

- `TableStatus`: available, occupied, closing
- `TableKind`: TABLE, BAR
- `TableSessionStatus`: open, ordering, closing, closed, void
- `SessionVoidReason`: customer_left, admin_error, comp, other
- `OrderStatus`: accepted, preparing, ready, delivered, cancelled
- `OrderRequestStatus`: pending, accepted, rejected, cancelled
- `ConsumptionType`: product, adjustment, discount, refund, partial_payment
- `QueueStatus`: pending, playing, played, skipped
- `QueueItemSource`: customer, house
- `PlaybackStatus`: idle, buffering, playing, paused
- `InventoryMovementType`: restock, adjustment, waste, correction
- `UserRole`: admin, staff
- `ExtraIncomeType`: restroom, manual
- `ExtraIncomeStatus`: active, reversed
- `LuggageStatus`: active, delivered, incident
- `LuggagePaymentStatus`: pending, paid
- `AuditEventKind`: login_success/failed/locked, password_reset_requested/completed, access_code_rotated, session_opened_by_admin, session_marked_paid, session_closed, session_voided, session_partial_payment, walkin_account_opened, product_created/updated/activated/deactivated, inventory_movement, bill_adjustment

---

## 5. Lógica de negocio destacable

### Sesiones de mesa

- Una mesa solo puede tener una sesión `open` simultánea (constraint `Table.current_session_id` unique).
- Cuando el cliente pide la cuenta (`payment_requested_at`), NO se aceptan más pedidos hasta cancelar o cobrar.
- Sesión `paid` queda con `status=closed` y `paid_at` poblado.
- Sesión `void` queda con `status=closed`, `voided_at` poblado y `paid_at=null`. Razón obligatoria.
- Walk-in (BAR) crea Table + TableSession en una transacción (rollback si falla cualquiera).

### Stock y composiciones

- Producto **simple**: al aceptar orden, descuenta `quantity` de su propio stock. Al cancelar, repone.
- Producto **compuesto** (con receta): al aceptar, descuenta de los componentes según composición elegida. Al cancelar, restaura usando `OrderItemComponent` (composición exacta, no defaults).
- Si un compuesto fuera vendible como armable (varias opciones por slot), el cliente elige composición unidad por unidad.
- El sistema valida que `sum(option.quantity) == slot.quantity` por slot antes de aceptar.
- El backend rechaza precios fraccionarios (`@IsInt`) — el bar opera en pesos enteros.

### Factura y revenue

- **`Consumption.amount`** es la fuente de verdad para revenue. Cada línea va al ledger.
- **`Consumption.type=product`** suma al subtotal.
- **`discount`** / **`adjustment`** / **`refund`** restan o ajustan.
- **`partial_payment`** es negativo (lo que ya cobró el bar como anticipo).
- **`reverses_id`** vincula un refund con el consumo original (no se borra).
- El reporte de cuentas cerradas usa `collected = subtotal + adjustments_total` (no `total_consumption` que es el saldo del ledger).
- Cuando un refund reversa un `partial_payment`, se reclasifica como partial neto (no como descuento de productos) para no contaminar el revenue.

### Fairness de cola

- `priority_score` se calcula con: `consumption/1000 + wait_score - cooldown_penalty - dominance_penalty + recent_order_bonus`.
- Una mesa que acaba de pedir comida tiene bonus temporal.
- Una mesa dominante (mucha música seguida) tiene penalty.
- `MAX_SONGS_PER_TABLE = 5` canciones activas por mesa.
- Por cada `$20.000` consumidos, gana 1 crédito de canción extra.
- Si se salta una canción `is_extra`, se devuelve el crédito.

### Códigos de acceso

- 4 dígitos generados con RNG criptográfico.
- TTL 24h. Rotación lazy (al consultar) o manual.
- Partial unique index `(is_active=true)` garantiza máximo 1 activo.
- `POST /access-code/validate` rate-limited 8/min (bound de 10k combinaciones).
- Sistema audita rotaciones; las del sistema sin actor, las manuales con actor.

### Auditoría

- Append-only: sin update/delete.
- `metadata` por kind (session_id, table_id, product_id, amount, etc.).
- `ip` solo en eventos de auth.
- `actor_label` es snapshot del email/nombre — sobrevive borrado del User.

### Detección de price-mismatch

- Al entregar una orden, se compara `OrderItem.unit_price` con `Product.price` actual.
- Si difieren: AuditLog (kind=`bill_adjustment` con `metadata.event_subtype=price_mismatch_at_delivery`) + socket `price-mismatch` a staff.
- La orden NO se bloquea — alerta observacional.

### Socket auth

- Middleware en `afterInit` valida JWT en handshake.
- Admin auto-joins `STAFF_ROOM`.
- Session auto-joins `tableSession:{id}` room.
- Anónimo solo recibe global.
- En `/mesa/[id]` el cliente solo pasa session_token (skipping admin_token aunque exista en localStorage del mismo navegador).

### Modales

- `ExtrasDock` se oculta automáticamente cuando hay un modal/drawer abierto (`MutationObserver` busca `role="dialog"` o `aria-modal="true"`), excepto cuando el modal lo abrió el propio dock.
- Modales cortos (`LuggageNewModal`, `ManualIncomeModal`, `ReasonModal`) cierran con click-fuera, Esc y X.
- Drawers grandes con formularios largos (`AdminBillDrawer`, `ProductDetailPanel`) cierran solo con X para evitar perder cambios.
- Cierre bloqueado mientras `submitting` para no descartar operación en curso.

---

## 6. Páginas del frontend

### Públicas

| Ruta | Componente | Audiencia |
|---|---|---|
| `/` | `app/page.tsx` | Landing "Escanea el QR" |
| `/mesa/[id]` | `app/mesa/[id]/page.tsx` | Cliente con QR |
| `/player` | `app/player/page.tsx` | TV de la barra |

### Admin

| Ruta | Componente | Función |
|---|---|---|
| `/admin/login` | `app/admin/login/page.tsx` | Login |
| `/admin/forgot-password` | `app/admin/forgot-password/page.tsx` | Olvidé contraseña |
| `/admin/reset-password` | `app/admin/reset-password/page.tsx` | Reset con token |
| `/admin` | `app/admin/page.tsx` | Dashboard con mesas, pedidos, música |
| `/admin/products` | `app/admin/products/page.tsx` | Catálogo, edición, recetas |
| `/admin/sales` | `app/admin/sales/page.tsx` | Reportes (4 tabs: Resumen/Detalle/Productos/Extras) |
| `/admin/auditoria` | `app/admin/auditoria/page.tsx` | Log de eventos |
| `/admin/musica-base` | `app/admin/musica-base/page.tsx` | House playlist y categorías |

---

## 7. Componentes admin reutilizables

| Componente | Función |
|---|---|
| `KpiStrip` | Strip de 4 KPIs con animación de cambio |
| `TablesMap` | Mapa visual de mesas (grid con status + counters) |
| `MusicPanel` | Cola actual + controles play/skip + búsqueda |
| `AdminBillDrawer` | Drawer derecho de factura: consumos, mark-paid, void, ajustes, refunds, quick-add |
| `ProductDetailPanel` | Vista/edición de un producto + tabs de stock y movimientos + receta |
| `ProductRecipeEditor` | Edición de slots y opciones de receta |
| `CompositionPicker` | Modal de mezcla por unidad de un armable (usado en mesa y admin quick-add) |
| `OrderRequestCart` | Cart del cliente con recetas y composiciones |
| `ExtrasDock` | Botones flotantes para cobros rápidos (baño, maletas, manual) |
| `LuggageNewModal` | Form de nueva maleta con grid de fichas 1-30 |
| `ManualIncomeModal` | Form de ingreso manual con concepto + monto |
| `DebugConsole` | Eruda console mobile cuando `?debug=1` |

---

## 8. Eventos realtime (Socket.io)

### Canales

- **`global`**: `io.emit()` — TODOS reciben (anónimo, staff, sesión).
- **`staff`** (room `STAFF_ROOM`): solo admin/staff conectados con JWT válido.
- **`session`** (room `tableSession:{id}`): solo clientes de esa sesión + admin que se unió.

### Eventos emitidos por el backend

| Evento | Canal | Cuándo |
|---|---|---|
| `queue:updated` | global | Cualquier cambio en la cola |
| `playback:updated` | global | Cambio de estado de playback |
| `product:updated` | global | Producto creado/editado/stock cambiado/receta modificada |
| `bill:updated` | session + staff | Cambio en la factura |
| `order:created` | session + staff | Order nuevo (al aceptar OrderRequest) |
| `order:updated` | session + staff | Cambio de estado de Order |
| `order-request:created` | session + staff | OrderRequest nuevo |
| `order-request:updated` | session + staff | Cambio de estado (accepted/rejected/cancelled) |
| `table-session:opened` | session + staff | Apertura de sesión |
| `table-session:updated` | session + staff | payment_requested_at, paid_at, etc |
| `table-session:closed` | session + staff | Cierre |
| `table:updated` | global + staff | Cambio de Table (counters, status) |
| `price-mismatch` | staff | Detectado al entregar orden |

### Mensajes del cliente al servidor

- `song:request` — solicitud directa de canción (legacy, hoy se usa POST).
- `tableSession:join` — join explícito al room.
- `tableSession:leave` — leave del room.
- `staff:join` — staff se une al room (auto al conectar pero se reutiliza).
- `table:join` — legacy (depreciado).

---

## 9. Auditoría

Eventos registrados en `AuditLog`:

| Kind | Cuándo | Metadata clave |
|---|---|---|
| `login_success` | Login OK | `ip`, `user_id` |
| `login_failed` | Login fallido | `ip`, `email`, `failed_attempts` |
| `login_locked` | Lockout activado | `ip`, `email`, `locked_until` |
| `password_reset_requested` | Cliente pidió reset | sin actor (anónimo) |
| `password_reset_completed` | Reset exitoso | `user_id` |
| `access_code_rotated` | Rotación manual o sistema | `rotated_by`, `expires_at` |
| `session_opened_by_admin` | Admin abre sesión manualmente | `session_id`, `table_id`, `table_number` |
| `session_marked_paid` | Cobro registrado | `session_id`, `total` |
| `session_closed` | Cierre de sesión | `session_id`, `table_id` |
| `session_voided` | Anulación | `session_id`, `reason`, `other_detail`, `total_voided` |
| `session_partial_payment` | Pago parcial | `session_id`, `amount` |
| `walkin_account_opened` | BAR virtual creada | `session_id`, `custom_name` |
| `product_created` | Producto nuevo | `product_id`, `sku`, `name` |
| `product_updated` | Edit de producto | `product_id`, `changes.{field}.{from,to}` |
| `product_activated` / `product_deactivated` | Toggle is_active | `product_id` |
| `inventory_movement` | Ajuste manual de stock | `product_id`, `type`, `quantity`, `reason` |
| `bill_adjustment` | Cargo/descuento/refund | `session_id`, `adjustment_type`, `amount`, `description`, `reason` |

---

## 10. Requisitos no funcionales

### Autenticación

- JWT local (sin OAuth) con 3 kinds: `admin`, `session`, `table`.
- Bcrypt para password hash + reset token hash.
- Lockout: 5 intentos fallidos → bloqueo por 20 minutos.
- Sin HTTPS enforcement en código (asumido reverse proxy / Vercel).

### Rate-limiting

- Por IP (anónimo) o user_id (admin). Window rolling, en memoria (no persistente).
- Endpoints más expuestos: login, forgot-password, validate-code, queue, music-search, orders, adjustments, refunds, extras.

### Almacenamiento

- BD: Postgres 14+.
- Tokens admin: localStorage del navegador.
- Tokens session: sessionStorage del navegador (no sobreviven cierre de pestaña).
- Table tokens: sessionStorage (cargados desde query string `?t=...`).
- State del cliente: Zustand store.

### Internacionalización

- Español único (no hay i18n).
- Strings hardcoded en backend (códigos de error) y frontend (UI).
- Moneda: COP (peso colombiano), formato `$ 12.345`.

### Realtime

- Socket.io: 3 canales, 13+ eventos emitidos del server.
- Auto-reconnect del cliente con fresh auth al recuperar conexión.
- Acknowledgments no usados — fire-and-forget.

### Performance

- Índices: en FKs frecuentes y campos de búsqueda (created_at, status, kind, ticket_number, customer_phone).
- Paginación: sales-insights products (default 20).
- Sin cache de aplicación (cada query va a Postgres).
- Sin background jobs ni workers (todo síncrono o socket-driven).

### Observabilidad

- Sentry: `@sentry/nestjs` configurado en backend, filtra 4xx.
- AuditLog para acciones administrativas críticas.
- Logs: `console.log` / `console.error` (Railway lo captura).

### CORS

- `FRONTEND_URLS` env var (comma-separated). Fallback a `FRONTEND_URL`. Default `http://localhost:3000`.

### Debugging mobile

- `/mesa/[id]?debug=1` carga Eruda console para inspeccionar en celular.

---

## 11. Migraciones

Ordenadas cronológicamente (carpeta `apps/backend/prisma/migrations/`):

1. `20260419223812_init_with_sessions` — Init: User, Table, TableSession, Song, QueueItem, Order, OrderRequest, OrderItem, Consumption, PlaybackState, Product, HousePlaylistItem.
2. `20260419230916_order_request_cancelled` — `OrderRequest.cancelled_at`.
3. `20260420000255_consumption_adjustments` — Enum extension: adjustment, discount.
4. `20260423225227_user_auth` — Lockout + password reset en User.
5. `20260425031200_inventory_movements` — Tabla `InventoryMovement`.
6. `20260501050217_session_payment_flow` — `payment_requested_at`, `paid_at`, status `ordering`.
7. `20260502164223_queue_item_is_extra` — `QueueItem.is_extra`, lógica de créditos.
8. `20260502200945_house_playlist` — `HousePlaylistItem`, `HousePlaylistCategory`, `Setting`.
9. `20260506062459_house_playlist_categories` — M2M items↔categorías.
10. `20260507230658_access_code_and_auth_hardening` — `BarAccessCode`, harden auth.
11. `20260509001335_bar_kind_partial_payments` — `Table.kind`, `custom_name`, `partial_payment`.
12. `20260512053301_session_void_flow` — `voided_at`, `void_reason`, `void_other_detail`, `voided_by`, enum.
13. `20260512055151_audit_log` — Tabla `AuditLog` + enum `AuditEventKind`.
14. `20260512190000_fix_active_session_index_void` — Partial unique index sobre `BarAccessCode`.
15. `20260514210000_product_recipes_and_sku` — `Product.sku`, `ProductRecipeSlot`, `ProductRecipeOption`, `OrderItemComponent`.
16. `20260516130000_extra_income_and_luggage` — Tablas `ExtraIncome`, `LuggageTicket`.
17. `20260517210000_extra_income_manual` — Enum value `manual` + columna `concept`.

---

## 12. Códigos de error

Los errores HTTP del backend devuelven JSON `{ statusCode, message, code, ...meta }`. Códigos más relevantes:

### Autenticación
- `AUTH_TABLE_MISMATCH` — table_token no corresponde a la mesa de la URL.
- `AUTH_CROSS_SESSION` — session_token de otra sesión.
- `AUTH_SESSION_REQUIRED` — endpoint requiere session_token.
- `AUTH_NOT_ADMIN` — usuario sin rol admin.
- `BAR_CODE_INVALID` — access code incorrecto.

### Órdenes
- `ORDER_INVALID_TRANSITION` — transición de estado no permitida.
- `ORDER_RACE` — modificación concurrente detectada.

### Cola musical
- `QUEUE_INVALID_SINCE` — formato de `since` inválido.
- `QUEUE_LIMIT_REACHED` — mesa alcanzó MAX_SONGS_PER_TABLE sin créditos.
- `QUEUE_RATE_LIMITED` — rate-limit golpeado.

### Sesiones
- `TABLE_SESSION_NOT_OPEN` — mesa sin sesión activa.

### Música externa
- `SEARCH_QUOTA_EXCEEDED` — YouTube API quota agotada.
- `SEARCH_UNAVAILABLE` — error del servicio externo.
- `SEARCH_RATE_LIMITED` — demasiadas búsquedas.

### Productos
- `PRODUCT_NOT_FOUND` — id no existe.
- Validation errors de class-validator (campos vacíos, precios no enteros, etc.).

### Ingresos extra
- `EXTRA_INCOME_INVALID_TYPE` / `EXTRA_INCOME_INVALID_STATUS` / `EXTRA_INCOME_INVALID_DATE` / `EXTRA_INCOME_INVALID_PARAM`.

### Maletas
- `LUGGAGE_NOT_ACTIVE` — ya entregada o con incidente.
- `LUGGAGE_PAYMENT_PENDING` — intento de entregar sin pagar.
- `LUGGAGE_TICKET_IN_USE` — ficha 1-30 ya en uso activa.
- `LUGGAGE_INVALID_STATUS` / `LUGGAGE_INVALID_DATE` / `LUGGAGE_INVALID_PARAM`.

### House playlist
- `HOUSE_PLAYLIST_INVALID_URL` — URL de YouTube no parseable.
- `HOUSE_PLAYLIST_VALIDATION_FAILED` — YouTube API no validó el video.

### Concurrencia
- `EXTRA_INCOME_RACE` / `LUGGAGE_RACE` — modificación concurrente, retry.
- `EXTRA_INCOME_ALREADY_REVERSED` — reverso duplicado.

---

_Documento generado: 2026-05-18. Esta versión refleja el estado del repositorio al momento del último commit._
