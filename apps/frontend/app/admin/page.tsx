"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useAppStore } from "@/store";
import { useSocket } from "@/lib/socket/useSocket";
import {
  tablesApi,
  queueApi,
  ordersApi,
  playbackApi,
  musicApi,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type {
  QueueItem,
  Table,
  Order,
  PlaybackState,
  YouTubeSearchResult,
} from "@coffee-bar/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const pad = (n: number) => String(n).padStart(2, "0");
const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

const statusColor: Record<string, string> = {
  available: "#3b82f6",
  active: "#16a34a",
  inactive: "#9ca3af",
  occupied: "#ea580c",
  pending: "#ca8a04",
  preparing: "#ea580c",
  ready: "#3b82f6",
  delivered: "#16a34a",
  cancelled: "#dc2626",
  played: "#9ca3af",
  skipped: "#dc2626",
};

function Badge({ label, status }: { label: string; status: string }) {
  const color = statusColor[status] ?? "#9ca3af";
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "monospace",
        letterSpacing: 1,
        color,
        border: `1px solid ${color}44`,
        background: `${color}10`,
        padding: "2px 7px",
        borderRadius: 3,
      }}
    >
      {label.toUpperCase()}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

function fmtTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Admin Search Modal ──────────────────────────────────────────────────────
function AdminSearchModal({
  open,
  onClose,
  queueLength,
}: {
  open: boolean;
  onClose: () => void;
  queueLength: number;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const search = async (q: string) => {
    if (q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const data = await musicApi.search(q);
      setResults(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleInput = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 400);
  };

  const handlePlayNow = async (r: YouTubeSearchResult) => {
    setAdding(`now:${r.youtubeId}`);
    setError(null);
    try {
      await queueApi.adminPlayNow({
        youtube_id: r.youtubeId,
        title: r.title,
        duration: r.duration,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAdding(null);
    }
  };

  const handleAddToQueue = async (r: YouTubeSearchResult, position?: number) => {
    setAdding(`queue:${r.youtubeId}`);
    setError(null);
    try {
      await queueApi.adminCreate({
        youtube_id: r.youtubeId,
        title: r.title,
        duration: r.duration,
        position,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAdding(null);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          width: "100%",
          maxWidth: 600,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 18,
                letterSpacing: 3,
                color: "#111",
              }}
            >
              AGREGAR CANCIÓN (ADMIN)
            </div>
            <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace", marginTop: 2 }}>
              Sin restricciones de duración o límite
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "#f3f4f6",
              border: "1px solid #d1d5db",
              color: "#666",
              padding: "4px 12px",
              fontFamily: "monospace",
              fontSize: 12,
              cursor: "pointer",
              borderRadius: 4,
            }}
          >
            CERRAR
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "12px 20px" }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Buscar cualquier canción..."
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "#f9fafb",
              border: "1px solid #d1d5db",
              color: "#111",
              fontFamily: "monospace",
              fontSize: 14,
              outline: "none",
              borderRadius: 4,
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              margin: "0 20px 8px",
              padding: "8px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#dc2626",
              fontFamily: "monospace",
              fontSize: 11,
              borderRadius: 4,
            }}
          >
            {error}
          </div>
        )}

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px" }}>
          {loading && (
            <p style={{ textAlign: "center", padding: 24, color: "#9ca3af", fontFamily: "monospace", fontSize: 11 }}>
              BUSCANDO...
            </p>
          )}

          {!loading && !error && query.length >= 2 && results.length === 0 && (
            <p style={{ textAlign: "center", padding: 24, color: "#9ca3af", fontFamily: "monospace", fontSize: 11 }}>
              SIN RESULTADOS
            </p>
          )}


          {results.map((r) => {
            const isAdding = adding?.includes(r.youtubeId) ?? false;
            return (
              <div
                key={r.youtubeId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                {r.thumbnail && (
                  <img
                    src={r.thumbnail}
                    alt=""
                    style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 3 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'Bebas Neue',Impact,sans-serif",
                      fontSize: 13,
                      color: "#111",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.title}
                  </div>
                  <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>
                    {secToMin(r.duration)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => handlePlayNow(r)}
                    disabled={isAdding}
                    style={{
                      padding: "5px 10px",
                      background: isAdding ? "#e5e7eb" : "#dc2626",
                      border: "none",
                      color: isAdding ? "#999" : "#fff",
                      fontFamily: "'Bebas Neue',Impact,sans-serif",
                      fontSize: 10,
                      letterSpacing: 1,
                      cursor: isAdding ? "not-allowed" : "pointer",
                      borderRadius: 3,
                    }}
                  >
                    SONAR YA
                  </button>
                  <button
                    onClick={() => handleAddToQueue(r, 1)}
                    disabled={isAdding}
                    style={{
                      padding: "5px 10px",
                      background: isAdding ? "#e5e7eb" : "#2563eb",
                      border: "none",
                      color: isAdding ? "#999" : "#fff",
                      fontFamily: "'Bebas Neue',Impact,sans-serif",
                      fontSize: 10,
                      letterSpacing: 1,
                      cursor: isAdding ? "not-allowed" : "pointer",
                      borderRadius: 3,
                    }}
                  >
                    SIGUIENTE
                  </button>
                  <button
                    onClick={() => handleAddToQueue(r)}
                    disabled={isAdding}
                    style={{
                      padding: "5px 10px",
                      background: isAdding ? "#e5e7eb" : "#f3f4f6",
                      border: "1px solid #d1d5db",
                      color: isAdding ? "#999" : "#333",
                      fontFamily: "'Bebas Neue',Impact,sans-serif",
                      fontSize: 10,
                      letterSpacing: 1,
                      cursor: isAdding ? "not-allowed" : "pointer",
                      borderRadius: 3,
                    }}
                  >
                    AL FINAL
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Columna mesas ────────────────────────────────────────────────────────────
function TablesColumn({ tables }: { tables: Table[] }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 200,
        borderRight: "1px solid #e5e7eb",
        overflowY: "auto",
      }}
    >
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 13,
            letterSpacing: 3,
            color: "#888",
          }}
        >
          MESAS
        </span>
      </div>
      {tables.map((t) => (
        <div
          key={t.id}
          style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 22,
                color: "#111",
              }}
            >
              {pad(t.id)}
            </span>
            <Badge label={t.status} status={t.status} />
          </div>
          <div
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 14,
              color: "#ca8a04",
            }}
          >
            {fmt(t.total_consumption)}
          </div>
        </div>
      ))}
      {tables.length === 0 && (
        <p style={{ padding: 24, color: "#9ca3af", fontFamily: "monospace", fontSize: 10, letterSpacing: 2 }}>
          SIN MESAS
        </p>
      )}
    </div>
  );
}

// ─── Columna cola ─────────────────────────────────────────────────────────────
function QueueColumn({ queue }: { queue: QueueItem[] }) {
  const skip = async (id: number) => {
    await queueApi.skip(id);
  };

  return (
    <div
      style={{
        flex: 1.4,
        minWidth: 240,
        borderRight: "1px solid #e5e7eb",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 13,
            letterSpacing: 3,
            color: "#888",
          }}
        >
          COLA GLOBAL
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: "#9ca3af" }}>
          {queue.length} canciones
        </span>
      </div>
      {queue.map((item, i) => {
        const playing = item.status === "playing";
        return (
          <div
            key={item.id}
            title={`Agregada: ${fmtTime(item.queued_at)}${item.started_playing_at ? ` · Inició: ${fmtTime(item.started_playing_at)}` : ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 16px",
              borderBottom: "1px solid #f3f4f6",
              background: playing ? "#f0fdf4" : "transparent",
              cursor: "default",
            }}
          >
            <span
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: playing ? 18 : 13,
                color: playing ? "#16a34a" : "#9ca3af",
                width: 22,
                textAlign: "center",
              }}
            >
              {playing ? "▶" : pad(i + 1)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 13,
                  color: playing ? "#111" : "#555",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.song?.title ?? `Song #${item.song_id}`}
              </div>
              <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>
                {item.table_id ? `Mesa ${pad(item.table_id)}` : "ADMIN"} · pos. {item.position} · {playing && item.started_playing_at ? `sonando ${timeAgo(item.started_playing_at)}` : `en cola ${timeAgo(item.created_at)}`}
              </div>
            </div>
            {!playing && (
              <button
                onClick={() => skip(item.id)}
                style={{
                  background: "#f3f4f6",
                  border: "1px solid #d1d5db",
                  color: "#888",
                  padding: "3px 8px",
                  fontFamily: "monospace",
                  fontSize: 10,
                  cursor: "pointer",
                  borderRadius: 3,
                }}
              >
                SKIP
              </button>
            )}
          </div>
        );
      })}
      {queue.length === 0 && (
        <p style={{ padding: 24, color: "#9ca3af", fontFamily: "monospace", fontSize: 10, letterSpacing: 2 }}>
          COLA VACÍA
        </p>
      )}
    </div>
  );
}

// ─── Columna pedidos ──────────────────────────────────────────────────────────
function OrdersColumn({ orders }: { orders: Order[] }) {
  const update = async (id: number, status: Order["status"]) => {
    await ordersApi.updateStatus(id, status);
  };

  return (
    <div style={{ flex: 1.4, minWidth: 240, overflowY: "auto" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 13,
            letterSpacing: 3,
            color: "#888",
          }}
        >
          PEDIDOS
        </span>
      </div>
      {orders.map((o) => (
        <div
          key={o.id}
          style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 14,
                  color: "#111",
                }}
              >
                Mesa {pad(o.table_id)}
              </span>
              <Badge label={o.status} status={o.status} />
            </div>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#ca8a04" }}>
              {fmt(o.total)}
            </span>
          </div>
          {o.status === "pending" && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button
                onClick={() => update(o.id, "preparing")}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  background: "#fffbeb",
                  border: "1px solid #ca8a04",
                  color: "#ca8a04",
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 11,
                  letterSpacing: 2,
                  cursor: "pointer",
                  borderRadius: 3,
                }}
              >
                PREPARAR
              </button>
              <button
                onClick={() => update(o.id, "cancelled")}
                style={{
                  padding: "6px 10px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#dc2626",
                  fontFamily: "monospace",
                  fontSize: 10,
                  cursor: "pointer",
                  borderRadius: 3,
                }}
              >
                ✕
              </button>
            </div>
          )}
          {o.status === "preparing" && (
            <button
              onClick={() => update(o.id, "delivered")}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "6px 0",
                background: "#f0fdf4",
                border: "1px solid #16a34a",
                color: "#16a34a",
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 11,
                letterSpacing: 2,
                cursor: "pointer",
                borderRadius: 3,
              }}
            >
              ENTREGAR
            </button>
          )}
        </div>
      ))}
      {orders.length === 0 && (
        <p style={{ padding: 24, color: "#9ca3af", fontFamily: "monospace", fontSize: 10, letterSpacing: 2 }}>
          SIN PEDIDOS
        </p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
type QueueStats = {
  songs_played_today: number;
  songs_skipped_today: number;
  songs_pending: number;
  total_songs_today: number;
  avg_wait_seconds: number | null;
  tables_participating: number;
  top_table: { table_id: number; count: number } | null;
};

export default function AdminPage() {
  const actionRef = useRef(false);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const {
    allTables,
    setAllTables,
    updateTable,
    queue,
    updateFromSocket,
    orders,
    setOrders,
    upsertOrder,
    currentPlayback,
    setCurrentPlayback,
  } = useAppStore();

  const refreshStats = useCallback(() => {
    queueApi.getStats().then(setStats).catch(console.error);
  }, []);

  const handleQueueUpdated = useCallback(
    (q: QueueItem[]) => {
      updateFromSocket(q);
      refreshStats();
    },
    [updateFromSocket, refreshStats],
  );
  const handleTableUpdated = useCallback(
    (t: Table) => updateTable(t),
    [updateTable],
  );
  const handleOrderUpdated = useCallback(
    (o: Order) => upsertOrder(o),
    [upsertOrder],
  );
  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );

  useSocket({
    onQueueUpdated: handleQueueUpdated,
    onTableUpdated: handleTableUpdated,
    onOrderUpdated: handleOrderUpdated,
    onPlaybackUpdated: handlePlaybackUpdated,
  });

  useEffect(() => {
    tablesApi.getAll().then(setAllTables).catch(console.error);
    queueApi.getGlobal().then(updateFromSocket).catch(console.error);
    ordersApi.getAll().then(setOrders).catch(console.error);
    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
    refreshStats();
  }, [refreshStats]);

  const handleSkipCurrent = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true;
    setActionInProgress("skip");
    try {
      await queueApi.skipAndAdvance();
    } catch (error) {
      console.error(error);
    } finally {
      actionRef.current = false;
      setActionInProgress(null);
    }
  }, []);

  const handlePlayNext = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true;
    setActionInProgress("play");
    try {
      await queueApi.advanceToNext();
    } catch (error) {
      console.error(error);
    } finally {
      actionRef.current = false;
      setActionInProgress(null);
    }
  }, []);

  const handleFinishCurrent = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true;
    setActionInProgress("finish");
    try {
      await queueApi.finishCurrent();
    } catch (error) {
      console.error(error);
    } finally {
      actionRef.current = false;
      setActionInProgress(null);
    }
  }, []);

  const activeOrders = orders.filter(
    (o) => o.status === "pending" || o.status === "preparing",
  );
  const revenue = allTables.reduce((a, t) => a + t.total_consumption, 0);
  const isPlaying =
    currentPlayback?.status === "playing" && Boolean(currentPlayback.song);
  const hasPendingSongs = queue.some((item) => item.status === "pending");

  const btnBase: React.CSSProperties = {
    padding: "8px 12px",
    fontFamily: "'Bebas Neue',Impact,sans-serif",
    fontSize: 12,
    letterSpacing: 2,
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <div
        style={{
          minHeight: "100dvh",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 20,
              color: "#111",
              letterSpacing: 3,
            }}
          >
            PANEL ADMIN
          </span>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[
              {
                label: "MESAS ACTIVAS",
                value: allTables.filter((t) => t.status === "active").length,
                color: "#16a34a",
              },
              { label: "EN COLA", value: queue.length, color: "#ca8a04" },
              { label: "PEDIDOS", value: activeOrders.length, color: "#ca8a04" },
              {
                label: "REPRODUCIDAS HOY",
                value: stats?.songs_played_today ?? 0,
                color: "#2563eb",
              },
              {
                label: "SALTADAS HOY",
                value: stats?.songs_skipped_today ?? 0,
                color: "#dc2626",
              },
              {
                label: "ESPERA PROM.",
                value: stats?.avg_wait_seconds != null
                  ? `${Math.floor(stats.avg_wait_seconds / 60)}m ${stats.avg_wait_seconds % 60}s`
                  : "—",
                color: "#7c3aed",
              },
              {
                label: "TOP MESA",
                value: stats?.top_table
                  ? `${pad(stats.top_table.table_id)} (${stats.top_table.count})`
                  : "—",
                color: "#ea580c",
              },
              { label: "CONSUMO TOTAL", value: fmt(revenue), color: "#ca8a04" },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 9,
                    color: "#9ca3af",
                    fontFamily: "monospace",
                    letterSpacing: 2,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontFamily: "'Bebas Neue',Impact,sans-serif",
                    fontSize: 18,
                    color: s.color,
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Playback bar */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e5e7eb",
            background: isPlaying ? "#f0fdf4" : "#f9fafb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
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
                    fontSize: 22,
                    color: "#111",
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {currentPlayback.song?.title}
                </div>
                <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace", marginTop: 4 }}>
                  {currentPlayback.table_id ? `Mesa ${pad(currentPlayback.table_id)}` : "ADMIN"}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", letterSpacing: 1 }}>
                SIN REPRODUCCIÓN ACTIVA
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: isPlaying ? "#16a34a" : "#9ca3af",
                marginRight: 8,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: isPlaying ? "#16a34a" : "#d1d5db",
                }}
              />
              <span style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 12, letterSpacing: 2 }}>
                {isPlaying ? "ACTIVA" : currentPlayback?.status === "paused" ? "PAUSADO" : "IDLE"}
              </span>
            </div>

            {!isPlaying && hasPendingSongs && (
              <button
                onClick={() => void handlePlayNext()}
                disabled={actionInProgress !== null}
                style={{
                  ...btnBase,
                  background: actionInProgress === "play" ? "#d1d5db" : "#16a34a",
                  color: actionInProgress === "play" ? "#888" : "#fff",
                  opacity: actionInProgress && actionInProgress !== "play" ? 0.5 : 1,
                  cursor: actionInProgress ? "not-allowed" : "pointer",
                }}
              >
                {actionInProgress === "play" ? "INICIANDO..." : "REPRODUCIR SIGUIENTE"}
              </button>
            )}
            {isPlaying && (
              <>
                <button
                  onClick={() => void handleSkipCurrent()}
                  disabled={actionInProgress !== null}
                  style={{
                    ...btnBase,
                    background: actionInProgress === "skip" ? "#d1d5db" : "#ca8a04",
                    color: actionInProgress === "skip" ? "#888" : "#fff",
                    opacity: actionInProgress && actionInProgress !== "skip" ? 0.5 : 1,
                    cursor: actionInProgress ? "not-allowed" : "pointer",
                  }}
                >
                  {actionInProgress === "skip" ? "SALTANDO..." : "SALTAR CANCIÓN"}
                </button>
                <button
                  onClick={() => void handleFinishCurrent()}
                  disabled={actionInProgress !== null}
                  style={{
                    ...btnBase,
                    background: actionInProgress === "finish" ? "#d1d5db" : "#f3f4f6",
                    color: actionInProgress === "finish" ? "#888" : "#555",
                    border: "1px solid #d1d5db",
                    opacity: actionInProgress && actionInProgress !== "finish" ? 0.5 : 1,
                    cursor: actionInProgress ? "not-allowed" : "pointer",
                  }}
                >
                  {actionInProgress === "finish" ? "FINALIZANDO..." : "FINALIZAR"}
                </button>
              </>
            )}
            <button
              onClick={() => setSearchOpen(true)}
              style={{
                ...btnBase,
                background: "#2563eb",
                color: "#fff",
              }}
            >
              AGREGAR CANCIÓN
            </button>
            <a
              href="/player"
              target="_blank"
              rel="noreferrer"
              style={{
                ...btnBase,
                background: "#f3f4f6",
                border: "1px solid #d1d5db",
                color: "#555",
                textDecoration: "none",
              }}
            >
              ABRIR PLAYER
            </a>
          </div>
        </div>

        {/* Columnas */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <TablesColumn tables={allTables} />
          <QueueColumn queue={queue} />
          <OrdersColumn orders={activeOrders} />
        </div>
      </div>

      <AdminSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        queueLength={queue.length}
      />
    </>
  );
}
