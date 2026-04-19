# Music Queue Fairness Algorithm

## 1. Objetivo

El algoritmo de fairness busca balancear **consumo**, **equidad** y **experiencia** en la cola musical del Coffee Bar. En vez de una cola FIFO simple, cada canción se inserta en la posición correcta basándose en un **priority score** calculado dinámicamente.

## 2. Variables de entrada

| Variable | Fuente | Descripción |
|---|---|---|
| `total_consumption` | `table.total_consumption` | Total consumido por la mesa (COP) |
| `minutesSinceLastPlayed` | Último `queue_item.updated_at` con status `played` | Minutos desde que la mesa tuvo una canción reproducida |
| `recentSongsByTable` | Últimas N canciones `played` | Canciones de la mesa en la ventana de dominancia |
| `activeQueueItemsByTable` | `queue_item` con status `pending`/`playing` | Items activos de la mesa en cola |
| `activeTablesCount` | Mesas con canciones activas o pedidos recientes | Cantidad de mesas participando |
| `hasRecentOrder` | `order.created_at` en últimos 15 min | Si la mesa hizo un pedido reciente |

## 3. Fórmula

```
priority_score =
    (total_consumption / PRIORITY_SCORE_DIVISOR)
  + (minutesSinceLastPlayed * WAIT_SCORE_PER_MINUTE)
  + (hasRecentOrder ? RECENT_ORDER_BONUS : 0)
  - (isInCooldown ? COOLDOWN_PENALTY : 0)
  - (recentSongsByTable * DOMINANCE_PENALTY_PER_SONG)
  - (activeQueueItemsByTable * QUEUE_LOAD_PENALTY)
```

### Desglose de componentes

| Componente | Efecto | Ejemplo |
|---|---|---|
| **consumption_score** | Premia consumo | 20.000 COP → +20 pts |
| **wait_score** | Premia espera | 10 min sin sonar → +20 pts |
| **activity_score** | Premia pedidos recientes | Pidió hace 5 min → +8 pts |
| **cooldown_penalty** | Castiga repetición inmediata | Sonó hace 1 canción → -100 pts |
| **dominance_penalty** | Castiga dominancia | 2 canciones recientes → -50 pts |
| **queue_load_penalty** | Castiga acumulación | 2 items en cola → -30 pts |

## 4. Reglas de cooldown

**Constante:** `COOLDOWN_SLOTS = 2`

Una mesa no debería volver al tope de la cola hasta que hayan sonado al menos 2 canciones de **otras** mesas.

**Regla operativa:**
- Si hay otras mesas elegibles: la mesa en cooldown recibe penalización fuerte (-100 pts por defecto)
- Si no hay otras mesas elegibles: se permite (el sistema no se detiene)
- El cooldown es una **preferencia fuerte**, no una prohibición absoluta

## 5. Reglas anti monopolio

**Constante:** `DOMINANCE_WINDOW = 5`

Se revisan las últimas 5 canciones reproducidas. Por cada canción de la misma mesa en esa ventana, se aplica una penalización.

| Canciones en ventana | Penalización |
|---|---|
| 0 | 0 |
| 1 | -25 pts |
| 2 | -50 pts |
| 3 | -75 pts |

## 6. Inserción dinámica

Cuando entra una nueva canción, **no va al final automáticamente**. El algoritmo:

1. Calcula el `priority_score` de la mesa que agrega la canción
2. Recorre los items `pending` ordenados por posición
3. Busca la primera posición donde:
   - El score del nuevo item es **mayor** que el del item existente
   - No crearía **dos canciones consecutivas** de la misma mesa
   - No viola reglas de **cooldown** o **monopolio**
4. Inserta en esa posición y reordena

**Restricciones de seguridad:**
- Nunca se inserta delante de la canción `playing`
- Se evitan dos canciones consecutivas de la misma mesa

## 7. Adaptación por mesas activas

El algoritmo se adapta automáticamente según cuántas mesas están participando.

| Mesas activas | Cooldown | Dominance window | Penalización dom. | Estrategia |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | Cola simple, sin fairness |
| 2 | 2 slots | 4 canciones | x1.5 (37.5/canción) | Alternancia fuerte |
| 3+ | 2 slots | 5 canciones | x1.0 (25/canción) | Fairness ponderada |

### Detalle por caso

**1 mesa activa:** No se aplica fairness. La mesa puede repetir sin restricción.

**2 mesas activas:** Alternancia fuerte. Se busca patrón A-B-A-B. Cooldown y dominancia amplificados x1.5.

**3+ mesas activas:** Fairness completa con todos los factores balanceados.

## 8. Constantes

```typescript
PRIORITY_SCORE_DIVISOR     = 1_000   // consumption / divisor
WAIT_SCORE_PER_MINUTE      = 2       // pts por minuto de espera
RECENT_ORDER_BONUS         = 8       // pts por pedido reciente
RECENT_ORDER_WINDOW_MINUTES = 15     // ventana de "pedido reciente"
COOLDOWN_SLOTS             = 2       // canciones antes de repetir mesa
COOLDOWN_PENALTY           = 100     // pts de penalización en cooldown
DOMINANCE_WINDOW           = 5       // canciones recientes a revisar
DOMINANCE_PENALTY_PER_SONG = 25      // pts por canción en ventana
QUEUE_LOAD_PENALTY         = 15      // pts por item activo en cola
```

Definidas en `packages/shared/src/constants/index.ts`.

## 9. Casos ejemplo

### Ejemplo 1: Mesa nueva vs mesa dominante

| Mesa | Consumo | Última canción | Canciones recientes | Score |
|---|---|---|---|---|
| Mesa 3 | 40.000 COP | Hace 15 min | 0 | 40 + 30 + 0 - 0 - 0 - 0 = **70** |
| Mesa 1 | 60.000 COP | Hace 2 min | 3 | 60 + 4 + 0 - 100 - 75 - 15 = **-126** |

→ Mesa 3 pasa primero aunque consumió menos.

### Ejemplo 2: Dos mesas alternando

| Mesa | Consumo | Última canción | En cooldown | Score |
|---|---|---|---|---|
| Mesa 2 | 30.000 COP | Hace 8 min | No | 30 + 16 + 0 - 0 - 37.5 - 0 = **8.5** |
| Mesa 5 | 25.000 COP | Hace 1 canción | Sí | 25 + 2 + 8 - 150 - 37.5 - 0 = **-152.5** |

→ Mesa 2 pasa primero. Mesa 5 debe esperar el cooldown.

### Ejemplo 3: Una sola mesa activa

Con 1 mesa activa, todos los factores de fairness se desactivan. La cola funciona como FIFO simple.

## 10. Implementación

| Archivo | Responsabilidad |
|---|---|
| `packages/shared/src/constants/index.ts` | Constantes del algoritmo |
| `apps/backend/src/modules/queue/fairness.service.ts` | Lógica de fairness (score, cooldown, dominancia, inserción) |
| `apps/backend/src/modules/queue/queue.service.ts` | Usa `FairnessService` en `create()` para inserción dinámica |
