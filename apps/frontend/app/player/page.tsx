"use client";

import { useCallback, useEffect, useRef } from "react";
import { AdminPlaybackPlayer } from "@/components/music/AdminPlaybackPlayer";
import { playbackApi, queueApi } from "@/lib/api/services";
import { useSocket } from "@/lib/socket/useSocket";
import { useAppStore } from "@/store";
import type { PlaybackState, QueueItem } from "@coffee-bar/shared";

export default function PlayerPage() {
  const autoplayRef = useRef(false);
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
    queueApi.getGlobal().then(updateFromSocket).catch(console.error);
    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
  }, [setCurrentPlayback, updateFromSocket]);

  const handlePlaybackEnded = useCallback(async () => {
    if (autoplayRef.current) return;

    autoplayRef.current = true;

    try {
      await queueApi.finishCurrent();
      await queueApi.playNext();
    } catch (error) {
      console.error(error);
    } finally {
      autoplayRef.current = false;
    }
  }, []);

  useEffect(() => {
    const hasPendingSongs = queue.some((item) => item.status === "pending");
    const isIdle = !currentPlayback || currentPlayback.status === "idle";

    if (!hasPendingSongs || !isIdle || autoplayRef.current) {
      return;
    }

    autoplayRef.current = true;

    queueApi
      .playNext()
      .catch(console.error)
      .finally(() => {
        autoplayRef.current = false;
      });
  }, [currentPlayback, queue]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; }
        html, body { background: #050505; }
      `}</style>

      <main
        style={{
          minHeight: "100dvh",
          background:
            "radial-gradient(circle at top, rgba(255,220,50,0.08), transparent 35%), #050505",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "18px 28px",
            borderBottom: "1px solid #151515",
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
                color: "#555",
                letterSpacing: 3,
                fontFamily: "monospace",
                marginBottom: 6,
              }}
            >
              PANTALLA DE REPRODUCCION
            </div>
            <div
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 28,
                color: "#f5f5f5",
                letterSpacing: 2,
              }}
            >
              {currentPlayback?.status === "playing"
                ? "SONANDO AHORA"
                : "ESPERANDO CANCION"}
            </div>
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              letterSpacing: 2,
              color:
                currentPlayback?.status === "playing" ? "#22c55e" : "#666",
            }}
          >
            {currentPlayback?.status === "playing"
              ? "REPRODUCCION ACTIVA"
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
