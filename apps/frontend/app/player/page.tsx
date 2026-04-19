"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminPlaybackPlayer } from "@/components/music/AdminPlaybackPlayer";
import { playbackApi, queueApi } from "@/lib/api/services";
import { useSocket } from "@/lib/socket/useSocket";
import { useAppStore } from "@/store";
import type { PlaybackState, QueueItem } from "@coffee-bar/shared";

export default function PlayerPage() {
  const autoplayRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const { currentPlayback, setCurrentPlayback, queue, updateFromSocket } =
    useAppStore();

  const handleQueueUpdated = useCallback(
    (items: QueueItem[]) => updateFromSocket(items),
    [updateFromSocket],
  );

  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );

  useSocket({
    onQueueUpdated: handleQueueUpdated,
    onPlaybackUpdated: handlePlaybackUpdated,
  });

  useEffect(() => {
    Promise.all([
      queueApi.getGlobal().then(updateFromSocket),
      playbackApi.getCurrent().then(setCurrentPlayback),
    ])
      .catch(console.error)
      .finally(() => setLoaded(true));
  }, [setCurrentPlayback, updateFromSocket]);

  const handlePlaybackEnded = useCallback(async () => {
    if (autoplayRef.current) return;
    autoplayRef.current = true;

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await queueApi.advanceToNext();
        break;
      } catch (error) {
        console.error(`[autoplay] advance failed (attempt ${attempt + 1}):`, error);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    autoplayRef.current = false;
  }, []);

  useEffect(() => {
    if (!loaded) return;

    const hasPendingSongs = queue.some((item) => item.status === "pending");
    const isIdle = !currentPlayback || currentPlayback.status === "idle";

    if (!hasPendingSongs || !isIdle || autoplayRef.current) return;

    autoplayRef.current = true;
    queueApi
      .advanceToNext()
      .catch(console.error)
      .finally(() => { autoplayRef.current = false; });
  }, [currentPlayback, queue]);

  const status = currentPlayback?.status;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; }
        html, body { background: #fff; }
      `}</style>

      <main
        style={{
          minHeight: "100dvh",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "18px 28px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                color: "#9ca3af",
                letterSpacing: 3,
                fontFamily: "monospace",
                marginBottom: 6,
              }}
            >
              PANTALLA DE REPRODUCCIÓN
            </div>
            <div
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 28,
                color: "#111",
                letterSpacing: 2,
              }}
            >
              {status === "buffering"
                ? "CARGANDO..."
                : status === "playing"
                  ? "SONANDO AHORA"
                  : status === "paused"
                    ? "PAUSADO"
                    : "ESPERANDO CANCIÓN"}
            </div>
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              letterSpacing: 2,
              color: status === "playing" ? "#16a34a" : status === "buffering" ? "#ca8a04" : status === "paused" ? "#ca8a04" : "#9ca3af",
            }}
          >
            {status === "buffering"
              ? "BUFFERING"
              : status === "playing"
                ? "REPRODUCCIÓN ACTIVA"
                : status === "paused"
                  ? "PAUSADO"
                  : "IDLE"}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "stretch" }}>
          <div style={{ flex: 1 }}>
            <AdminPlaybackPlayer
              playback={currentPlayback}
              onPlaybackEnded={handlePlaybackEnded}
              mode="screen"
            />
          </div>
        </div>
      </main>
    </>
  );
}
