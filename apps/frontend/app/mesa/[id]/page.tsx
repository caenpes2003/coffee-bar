"use client";

import { useEffect, use, useCallback, useState } from "react";
import {
  useAppStore,
  selectCurrentPlayback,
  selectMyQueueCount,
} from "@/store";
import { useSocket } from "@/lib/socket/useSocket";
import {
  tablesApi,
  queueApi,
  ordersApi,
  playbackApi,
} from "@/lib/api/services";
import type {
  QueueItem,
  Table,
  Order,
  PlaybackState,
} from "@coffee-bar/shared";
import {
  SCOREBOARD_MAX_CONSUMPTION,
  MAX_SONGS_PER_TABLE,
} from "@coffee-bar/shared";
import SongSearch from "@/components/music/SongSearch";
import { MySongsPanel } from "@/components/music/MySongsPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const pad = (n: number) => String(n).padStart(2, "0");
const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

function buildMesaQueue(tableQueue: QueueItem[], tableId: number) {
  return tableQueue
    .filter((item) => item.table_id === tableId && item.status === "pending")
    .sort((a, b) => a.position - b.position);
}

// ─── Scoreboard ───────────────────────────────────────────────────────────────
function Scoreboard({
  table,
  playback,
}: {
  table: Table;
  playback: PlaybackState | null;
}) {
  const MAX = SCOREBOARD_MAX_CONSUMPTION;
  const pct = Math.min(100, Math.round((table.total_consumption / MAX) * 100));
  const isPlaying = playback?.status === "playing" && playback.song;
  const playbackColor = isPlaying ? "#16a34a" : "#9ca3af";
  const playbackLabel = isPlaying ? "SONANDO AHORA" : "SIN REPRODUCCIÓN";

  return (
    <div
      style={{
        background: "#f9fafb",
        borderBottom: "1px solid #e5e7eb",
        padding: "20px 20px 16px",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 11,
            letterSpacing: 3,
            color: "#9ca3af",
          }}
        >
          MESA
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: playbackColor,
              animation: isPlaying ? "pulse 2s infinite" : "none",
            }}
          />
          <span
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 10,
              letterSpacing: 2,
              color: playbackColor,
            }}
          >
            {playbackLabel}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 86,
            lineHeight: 1,
            color: "#111",
            letterSpacing: -3,
          }}
        >
          {pad(table.id)}
        </span>
        <div>
          <div
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 22,
              color: "#ca8a04",
            }}
          >
            {fmt(table.total_consumption)}
          </div>
        </div>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 5,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "#9ca3af",
              letterSpacing: 2,
              fontFamily: "monospace",
            }}
          >
            CONSUMO
          </span>
          <span
            style={{ fontSize: 10, color: "#ca8a04", fontFamily: "monospace" }}
          >
            {pct}%
          </span>
        </div>
        <div
          style={{
            height: 4,
            background: "#e5e7eb",
            overflow: "hidden",
            borderRadius: 2,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "linear-gradient(90deg,#ca8a04,#ea580c)",
              transition: "width 0.8s ease",
            }}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: "10px 12px",
          border: "1px solid #e5e7eb",
          background: isPlaying ? "#f0fdf4" : "#fff",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontSize: 9,
            color: "#9ca3af",
            letterSpacing: 2,
            fontFamily: "monospace",
            marginBottom: 6,
          }}
        >
          SONANDO AHORA
        </div>
        {isPlaying ? (
          <>
            <div
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 16,
                color: "#111",
                lineHeight: 1.1,
              }}
            >
              {playback.song?.title}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#888",
                fontFamily: "monospace",
                marginTop: 4,
              }}
            >
              {secToMin(playback.song?.duration ?? 0)} · Mesa{" "}
              {playback.table_id ? pad(playback.table_id) : "ADMIN"}
            </div>
          </>
        ) : (
          <div
            style={{
              fontSize: 10,
              color: "#9ca3af",
              fontFamily: "monospace",
              letterSpacing: 1,
            }}
          >
            AÚN NO HAY UNA CANCIÓN REPRODUCIÉNDOSE
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Queue row ────────────────────────────────────────────────────────────────
function QueueRow({
  item,
  index,
  myTableId,
}: {
  item: QueueItem;
  index: number;
  myTableId: number;
}) {
  const playing = item.status === "playing";
  const isMine = item.table_id === myTableId;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 0",
        borderBottom: "1px solid #f3f4f6",
        background: playing ? "#f0fdf4" : "transparent",
      }}
    >
      <div
        style={{
          width: 26,
          minWidth: 26,
          fontFamily: "'Bebas Neue',Impact,sans-serif",
          fontSize: playing ? 20 : 15,
          color: playing ? "#16a34a" : "#d1d5db",
          textAlign: "center",
        }}
      >
        {playing ? "▶" : pad(index + 1)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 14,
            color: playing ? "#111" : "#555",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.song?.title ?? item.song_id}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#9ca3af",
            fontFamily: "monospace",
            marginTop: 2,
          }}
        >
          {secToMin(item.song?.duration ?? 0)}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
        }}
      >
        {isMine && (
          <div
            style={{
              fontSize: 9,
              fontFamily: "monospace",
              letterSpacing: 1,
              color: "#ca8a04",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              padding: "2px 6px",
              borderRadius: 3,
            }}
          >
            TU MESA
          </div>
        )}
        <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>
          {playing ? "AHORA" : ""}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MesaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const tableId = parseInt(id, 10);
  const [globalQueue, setGlobalQueue] = useState<QueueItem[]>([]);

  const {
    currentTable,
    setCurrentTable,
    queue,
    updateFromSocket,
    orders,
    setOrders,
    mySongs,
    setMySongs,
    isSearchOpen,
    setSearchOpen,
    activeTab,
    setActiveTab,
    upsertOrder,
    setCurrentPlayback,
  } = useAppStore();

  const currentPlayback = useAppStore(selectCurrentPlayback);
  const myQueueCount = useAppStore(selectMyQueueCount(tableId));

  const handleQueueUpdated = useCallback(
    (q: QueueItem[]) => {
      updateFromSocket(buildMesaQueue(q, tableId));
      setGlobalQueue(q);
      const prev = useAppStore.getState().mySongs;
      const history = prev.filter(
        (s) => s.status === "played" || s.status === "skipped",
      );
      const freshActive = q.filter((item) => item.table_id === tableId);
      setMySongs([...freshActive, ...history]);
    },
    [tableId, updateFromSocket, setMySongs],
  );
  const handleTableUpdated = useCallback(
    (t: Table) => {
      if (t.id === tableId) setCurrentTable(t);
    },
    [tableId, setCurrentTable],
  );
  const handleOrderUpdated = useCallback(
    (o: Order) => {
      if (o.table_id === tableId) upsertOrder(o);
    },
    [tableId, upsertOrder],
  );
  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );

  useSocket({
    tableId,
    onQueueUpdated: handleQueueUpdated,
    onTableUpdated: handleTableUpdated,
    onOrderUpdated: handleOrderUpdated,
    onPlaybackUpdated: handlePlaybackUpdated,
  });

  useEffect(() => {
    if (isNaN(tableId)) return;
    sessionStorage.setItem("table_id", String(tableId));
    tablesApi.getById(tableId).then(setCurrentTable).catch(console.error);
    ordersApi.getByTable(tableId).then(setOrders).catch(console.error);
    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
    queueApi
      .getByTable(tableId)
      .then((tableQueue) => {
        updateFromSocket(buildMesaQueue(tableQueue, tableId));
      })
      .catch(console.error);
    queueApi
      .getByTableWithHistory(tableId)
      .then(setMySongs)
      .catch(console.error);
    queueApi.getGlobal().then(setGlobalQueue).catch(console.error);
  }, [tableId]);

  const myOrders = orders.filter((o) => o.table_id === tableId);
  const total = myOrders.reduce((a, o) => a + o.total, 0);

  const tabStyle = (tab: string): React.CSSProperties => ({
    flex: 1,
    padding: "13px 0",
    border: "none",
    cursor: "pointer",
    background: activeTab === tab ? "#2563eb" : "#fff",
    color: activeTab === tab ? "#fff" : "#888",
    borderBottom:
      activeTab === tab ? "2px solid #2563eb" : "2px solid transparent",
    fontFamily: "'Bebas Neue',Impact,sans-serif",
    fontSize: 13,
    letterSpacing: 3,
  });

  if (!currentTable) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            color: "#9ca3af",
            fontFamily: "monospace",
            letterSpacing: 3,
            fontSize: 11,
          }}
        >
          CARGANDO MESA {pad(tableId)}...
        </span>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        * { box-sizing: border-box; }
      `}</style>

      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          minHeight: "100dvh",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Scoreboard table={currentTable} playback={currentPlayback} />

        <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
          <button style={tabStyle("cola")} onClick={() => setActiveTab("cola")}>
            COLA
          </button>
          <button
            style={tabStyle("canciones")}
            onClick={() => setActiveTab("canciones")}
          >
            MIS CANCIONES
          </button>
          <button
            style={tabStyle("pedidos")}
            onClick={() => setActiveTab("pedidos")}
          >
            PEDIDOS
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
          {activeTab === "cola" && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "12px 0 4px",
                  borderBottom: "1px solid #f3f4f6",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: "#9ca3af",
                    fontFamily: "monospace",
                    letterSpacing: 2,
                  }}
                >
                  {globalQueue.length} EN COLA
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#9ca3af",
                    fontFamily: "monospace",
                  }}
                >
                  TU MESA: {myQueueCount}/{MAX_SONGS_PER_TABLE}
                </span>
              </div>
              {globalQueue.map((item, i) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  index={i}
                  myTableId={tableId}
                />
              ))}
              {globalQueue.length === 0 && (
                <p
                  style={{
                    textAlign: "center",
                    padding: "40px 0",
                    color: "#9ca3af",
                    fontFamily: "monospace",
                    fontSize: 11,
                    letterSpacing: 2,
                  }}
                >
                  COLA VACÍA — SÉ EL PRIMERO
                </p>
              )}
            </>
          )}

          {activeTab === "canciones" && (
            <MySongsPanel mySongs={mySongs} globalQueue={queue} />
          )}

          {activeTab === "pedidos" && (
            <div style={{ padding: "16px 0 8px" }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 11,
                  letterSpacing: 3,
                  color: "#9ca3af",
                  marginBottom: 12,
                }}
              >
                PEDIDO ACTUAL
              </div>
              {myOrders.length === 0 && (
                <p
                  style={{
                    textAlign: "center",
                    padding: "40px 0",
                    color: "#9ca3af",
                    fontFamily: "monospace",
                    fontSize: 11,
                    letterSpacing: 2,
                  }}
                >
                  SIN PEDIDOS AÚN
                </p>
              )}
              {total > 0 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "16px 0 0",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Bebas Neue',Impact,sans-serif",
                      fontSize: 13,
                      letterSpacing: 3,
                      color: "#9ca3af",
                    }}
                  >
                    TOTAL MESA
                  </span>
                  <span
                    style={{
                      fontFamily: "'Bebas Neue',Impact,sans-serif",
                      fontSize: 20,
                      color: "#ca8a04",
                    }}
                  >
                    {fmt(total)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{ padding: "16px 20px 28px", borderTop: "1px solid #e5e7eb" }}
        >
          <button
            onClick={() => setSearchOpen(true)}
            disabled={myQueueCount >= MAX_SONGS_PER_TABLE}
            style={{
              width: "100%",
              padding: 16,
              background: myQueueCount >= MAX_SONGS_PER_TABLE ? "#f3f4f6" : "#2563eb",
              border: "none",
              color: myQueueCount >= MAX_SONGS_PER_TABLE ? "#9ca3af" : "#fff",
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 18,
              letterSpacing: 4,
              cursor: myQueueCount >= MAX_SONGS_PER_TABLE ? "not-allowed" : "pointer",
              borderRadius: 6,
            }}
          >
            {myQueueCount >= MAX_SONGS_PER_TABLE
              ? "LÍMITE ALCANZADO"
              : "PEDIR CANCIÓN"}
          </button>
          {myQueueCount >= MAX_SONGS_PER_TABLE && (
            <p style={{
              textAlign: "center",
              marginTop: 8,
              fontSize: 10,
              color: "#9ca3af",
              fontFamily: "monospace",
            }}>
              Espera 15 min o consume $20 mil más para agregar otra canción
            </p>
          )}
        </div>

        <SongSearch
          tableId={tableId}
          open={isSearchOpen}
          onClose={() => setSearchOpen(false)}
          onAdded={() => {
            queueApi
              .getByTable(tableId)
              .then((tableQueue) => {
                updateFromSocket(buildMesaQueue(tableQueue, tableId));
              })
              .catch(console.error);
            queueApi
              .getByTableWithHistory(tableId)
              .then(setMySongs)
              .catch(console.error);
          }}
          myQueue={queue}
          globalQueue={globalQueue}
        />
      </div>
    </>
  );
}
