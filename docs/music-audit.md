# Music Queue Audit Trail

## 1. Objetivo

Registrar el ciclo de vida completo de cada canción en la cola para trazabilidad operativa y análisis.

## 2. Campos de auditoría (QueueItem)

| Campo | Tipo | Cuándo se escribe | Significado |
|---|---|---|---|
| `created_at` | DateTime | Al crear el queue item | Momento en que la mesa pidió la canción |
| `started_playing_at` | DateTime? | Al pasar a `playing` | Momento en que empezó a sonar |
| `finished_at` | DateTime? | Al pasar a `played` | Momento en que terminó normalmente |
| `skipped_at` | DateTime? | Al pasar a `skipped` | Momento en que fue saltada |
| `updated_at` | DateTime | Automático (Prisma) | Última modificación del registro |

## 3. Flujo de vida de una canción

```
Mesa pide canción
  → created_at = now()
  → status = pending

Canción empieza a sonar
  → started_playing_at = now()
  → status = playing

Canción termina normalmente
  → finished_at = now()
  → status = played

--- O ---

Canción es saltada
  → skipped_at = now()
  → status = skipped
```

## 4. Métodos que persisten timestamps

| Método | Timestamp | Transición |
|---|---|---|
| `create()` | `created_at` (auto) | → pending |
| `playNext()` | `finished_at` (current), `started_playing_at` (next) | playing → played, pending → playing |
| `advanceToNext()` | `finished_at` (current), `started_playing_at` (next) | playing → played, pending → playing |
| `skip()` | `skipped_at` | pending/playing → skipped |
| `finishCurrent()` | `finished_at` | playing → played |

## 5. Métricas derivadas

### Tiempo de espera en cola
```
wait_time = started_playing_at - created_at
```

### Duración efectiva de reproducción
```
playback_time = finished_at - started_playing_at
```

### Tasa de skip
```
skip_rate = songs_skipped / (songs_played + songs_skipped)
```

## 6. Endpoint de estadísticas

`GET /queue/stats` retorna:

```json
{
  "songs_played_today": 15,
  "songs_skipped_today": 3,
  "songs_pending": 4,
  "total_songs_today": 22,
  "avg_wait_seconds": 480,
  "tables_participating": 5,
  "top_table": { "table_id": 3, "count": 6 }
}
```

## 7. Campos expuestos en API

Los timestamps de auditoría se incluyen automáticamente en las respuestas de:
- `GET /queue/global`
- `GET /queue?table_id=X`
- `GET /queue?table_id=X&include_history=true`
- `GET /queue/current`

## 8. Proveedor de búsqueda musical

| Proveedor | Configuración | Estabilidad |
|---|---|---|
| `ytsr` (default) | Sin API key | Frágil (scraping) |
| YouTube Data API v3 | `YOUTUBE_API_KEY` env | Estable, 100 búsquedas/día (free) |

Selección automática: si `YOUTUBE_API_KEY` está configurada, se usa YouTube Data API; si no, ytsr.

Logs estructurados por búsqueda:
```json
{
  "event": "music_search",
  "provider": "youtube-data-api",
  "query": "coldplay",
  "limit": 10,
  "results_count": 8,
  "duration_ms": 342
}
```
