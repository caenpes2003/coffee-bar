# QA Manual — Escenarios Multi-Mesa

## Prerrequisitos
- Backend corriendo (`yarn dev` en `apps/backend`)
- Frontend corriendo (`yarn dev` en `apps/frontend`)
- Player abierto en `/player`
- Admin abierto en `/admin`
- Al menos 3 mesas activas en la BD
- Docker con PostgreSQL corriendo

## Escenario 1: Dos mesas alternando

**Objetivo:** Validar que el sistema alterna A-B-A-B con 2 mesas.

1. Abrir mesa 1 en `/mesa/1` y mesa 2 en `/mesa/2`
2. Desde mesa 1: buscar y agregar "Coldplay Yellow"
3. Desde mesa 2: buscar y agregar "Bad Bunny Monaco"
4. Desde mesa 1: buscar y agregar "Imagine Dragons Believer"
5. Desde mesa 2: buscar y agregar "Shakira Waka Waka"
6. En admin: verificar cola → debe ser alternada (M1, M2, M1, M2)
7. En player: iniciar reproducción
8. Verificar que suenan alternando mesas

**Resultado esperado:**
- [ ] Cola muestra patrón alternado
- [ ] No hay dos canciones consecutivas de la misma mesa
- [ ] Admin muestra "en cola Xm" por cada item

## Escenario 2: Mesa dominante vs mesa nueva

**Objetivo:** Validar que fairness balancea consumo vs dominancia.

1. Mesa 1 tiene consumo alto (hacer varios pedidos)
2. Mesa 3 tiene consumo bajo
3. Mesa 1 agrega 2 canciones
4. Esperar a que suene 1 canción de mesa 1
5. Mesa 3 agrega 1 canción
6. Verificar que mesa 3 sube en la cola por wait + no-dominancia

**Resultado esperado:**
- [ ] Mesa 3 no queda al final a pesar de menor consumo
- [ ] Mesa 1 tiene penalización por dominancia

## Escenario 3: Controles admin

**Objetivo:** Validar SALTAR, FINALIZAR, REPRODUCIR SIGUIENTE.

1. Tener al menos 3 canciones en cola
2. En admin: click "REPRODUCIR SIGUIENTE" → debe iniciar primera canción
3. Verificar player muestra video y estado BUFFERING → PLAYING
4. En admin: click "SALTAR CANCIÓN" → debe saltar y avanzar a siguiente
5. Verificar que la canción saltada aparece como "SALTADA" en historial
6. En admin: click "FINALIZAR" → debe detener sin avanzar
7. Verificar estado IDLE en player

**Resultado esperado:**
- [ ] Botones muestran loading ("SALTANDO...", "FINALIZANDO...")
- [ ] Botones se deshabilitan durante acción
- [ ] Transiciones correctas en player
- [ ] Timestamps visibles en tooltip (hover sobre item de cola)

## Escenario 4: Búsqueda y errores

**Objetivo:** Validar todos los estados del buscador.

1. Abrir búsqueda desde mesa 1
2. Buscar "coldplay" → debe mostrar resultados con thumbnails
3. Agregar una canción → debe cerrar modal
4. Abrir búsqueda de nuevo, buscar "coldplay"
5. La canción agregada debe mostrar "YA EN TU COLA"
6. Buscar "asdfjklqwerty" → debe mostrar "NO ENCONTRAMOS CANCIONES"
7. Agregar hasta MAX_SONGS_PER_TABLE → botón debe cambiar a "LÍMITE"
8. Buscar canciones de más de 10 min → debe mostrar "EXCEDE LÍMITE"

**Resultado esperado:**
- [ ] Skeletons durante carga
- [ ] Cada resultado muestra estado correcto
- [ ] Errores inline en card, no banner global
- [ ] Focus trap funciona (Tab no sale del modal)
- [ ] Escape cierra modal

## Escenario 5: Mis canciones (panel de mesa)

**Objetivo:** Validar panel "MIS CANCIONES" con posición y feedback.

1. Desde mesa 1: agregar 2 canciones
2. Ir al tab "MIS CANCIONES"
3. Verificar que muestra ambas canciones con posición (#N)
4. Verificar mensaje de espera ("Tu canción es la siguiente", etc.)
5. Desde admin: iniciar reproducción
6. Verificar que la canción playing muestra "▶ Sonando ahora"
7. Finalizar canción → verificar que aparece en historial con "REPRODUCIDA"
8. Saltar canción → verificar que aparece como "SALTADA"
9. Verificar timestamps relativos en historial ("hace 2 min")

**Resultado esperado:**
- [ ] Posición real se actualiza en tiempo real
- [ ] Mensajes de espera cambian cuando la cola cambia
- [ ] Historial separado visualmente
- [ ] Timestamps relativos correctos

## Escenario 6: Búsqueda intensiva (budget/fallback)

**Objetivo:** Validar hybrid provider y cache.

1. Abrir búsqueda y hacer 5 búsquedas diferentes
2. Repetir una búsqueda anterior → debe ser instantánea (cache)
3. Revisar logs del backend → deben mostrar:
   - `source: "youtube-data-api"` para primera búsqueda
   - `source: "cache"` para repetida
   - `budget_used` y `budget_remaining`
4. Si la API key no es válida → debe caer a ytsr como fallback
5. Verificar que el frontend muestra error claro si ambos fallan

**Resultado esperado:**
- [ ] Cache funciona (búsquedas repetidas son instantáneas)
- [ ] Logs muestran provider usado
- [ ] Fallback a ytsr si YouTube API falla

## Escenario 7: Reconexión y estados vacíos

**Objetivo:** Validar resiliencia de WebSocket.

1. Abrir mesa 1 y admin
2. Apagar el backend (Ctrl+C)
3. Verificar que el frontend no se rompe
4. Encender el backend
5. Verificar que la conexión se restablece
6. Verificar que los datos se actualizan correctamente

**Resultado esperado:**
- [ ] No hay errores no manejados en consola
- [ ] Frontend muestra estado vacío/loading gracefully
- [ ] Socket reconecta automáticamente

## Escenario 8: Buffering timeout

**Objetivo:** Validar que buffering colgado se recupera.

1. Iniciar reproducción de una canción
2. Cerrar la pestaña del player (sin /player abierto)
3. Esperar 30+ segundos
4. Verificar en admin que el estado cambia de BUFFERING a PLAYING
5. Abrir player de nuevo → debe sincronizar estado

**Resultado esperado:**
- [ ] Estado no se queda colgado en BUFFERING
- [ ] Admin muestra transición correcta
