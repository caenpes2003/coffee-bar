"use client";

import type { QueueItem } from "@coffee-bar/shared";

const pad = (n: number) => String(n).padStart(2, "0");
const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

function getWaitMessage(item: QueueItem, allQueue: QueueItem[]): string {
  if (item.status === "playing") return "Sonando ahora";
  if (item.status === "played") return "Reproducida";
  if (item.status === "skipped") return "Saltada";
  const songsAhead = allQueue.filter(
    (q) => q.position < item.position && q.status === "pending",
  ).length;
  if (songsAhead === 0) return "Tu canción es la siguiente";
  if (songsAhead === 1) return "Tu canción está próxima";
  if (songsAhead <= 3) return "Hay pocas canciones antes que la tuya";
  return "La espera puede ser un poco mayor";
}

function getStatusLabel(status: string) {
  switch (status) {
    case "playing": return { text: "SONANDO", color: "#16a34a" };
    case "pending": return { text: "EN COLA", color: "#2563eb" };
    case "skipped": return { text: "SALTADA", color: "#dc2626" };
    case "played": return { text: "REPRODUCIDA", color: "#9ca3af" };
    default: return { text: status.toUpperCase(), color: "#9ca3af" };
  }
}

export function MySongsPanel({
  mySongs,
  globalQueue,
}: {
  mySongs: QueueItem[];
  globalQueue: QueueItem[];
}) {
  const statusOrder: Record<string, number> = { playing: 0, pending: 1, skipped: 2, played: 3 };
  const sorted = [...mySongs].sort((a, b) => {
    const orderA = statusOrder[a.status] ?? 4;
    const orderB = statusOrder[b.status] ?? 4;
    if (orderA !== orderB) return orderA - orderB;
    return a.position - b.position;
  });

  const active = sorted.filter((s) => s.status === "playing" || s.status === "pending");
  const history = sorted.filter((s) => s.status === "played" || s.status === "skipped");

  return (
    <div style={{ padding: "16px 0" }}>
      <div style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 11, letterSpacing: 3, color: "#9ca3af", marginBottom: 12 }}>
        TUS CANCIONES
      </div>
      <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace", marginBottom: 16 }}>
        Aquí puedes ver el estado de lo que has agregado a la cola.
      </div>

      {active.length === 0 && history.length === 0 && (
        <p style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontFamily: "monospace", fontSize: 11, letterSpacing: 2 }}>
          AÚN NO HAS AGREGADO CANCIONES
        </p>
      )}

      <div aria-live="polite">
        {active.map((item) => {
          const status = getStatusLabel(item.status);
          const waitMsg = getWaitMessage(item, globalQueue);
          const isPlaying = item.status === "playing";

          return (
            <div
              key={item.id}
              style={{
                padding: "14px 0",
                borderBottom: "1px solid #f3f4f6",
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                background: isPlaying ? "#f0fdf4" : "transparent",
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  width: 30, minWidth: 30,
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: isPlaying ? 20 : 16,
                  color: isPlaying ? "#16a34a" : "#d1d5db",
                  textAlign: "center", paddingTop: 2,
                }}
              >
                {isPlaying ? "▶" : `#${item.position}`}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 14, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.song?.title ?? `Song ${item.song_id}`}
                </div>
                <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{secToMin(item.song?.duration ?? 0)}</span>
                  <span style={{ color: status.color, letterSpacing: 1 }}>{status.text}</span>
                </div>
                <div
                  aria-live="polite"
                  style={{ fontSize: 10, color: isPlaying ? "#16a34a" : "#888", fontFamily: "monospace", marginTop: 4, fontStyle: "italic" }}
                >
                  {waitMsg}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {history.length > 0 && (
        <>
          <div style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 10, letterSpacing: 3, color: "#d1d5db", marginTop: 20, marginBottom: 8 }}>
            HISTORIAL
          </div>
          {history.map((item) => {
            const status = getStatusLabel(item.status);
            return (
              <div
                key={item.id}
                style={{ padding: "10px 0", borderBottom: "1px solid #f9fafb", display: "flex", gap: 12, alignItems: "center", opacity: 0.6 }}
              >
                <div style={{ width: 30, minWidth: 30, textAlign: "center", fontSize: 12, color: "#d1d5db" }}>
                  {item.status === "skipped" ? "✕" : "✓"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 12, color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.song?.title ?? `Song ${item.song_id}`}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <span style={{ fontSize: 9, color: status.color, fontFamily: "monospace", letterSpacing: 1 }}>{status.text}</span>
                  <span style={{ fontSize: 9, color: "#d1d5db", fontFamily: "monospace" }}>{timeAgo(item.updated_at)}</span>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
