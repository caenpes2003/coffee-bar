"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "@coffee-bar/shared";

type YouTubePlayerInstance = {
  destroy: () => Promise<void> | void;
  loadVideoById: (videoId: string) => Promise<void>;
  pauseVideo: () => Promise<void>;
  playVideo: () => Promise<void>;
  stopVideo: () => Promise<void>;
  on: (eventName: string, listener: () => void) => void;
};

type YouTubePlayerFactory = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => YouTubePlayerInstance;

const PLAYER_HEIGHT = 320;

function getPlayerErrorMessage(code?: number) {
  switch (code) {
    case 2:
      return "El video tiene un ID invalido.";
    case 5:
      return "YouTube no pudo reproducir este video en HTML5.";
    case 100:
      return "El video ya no esta disponible.";
    case 101:
    case 150:
      return "YouTube no permite embeber este video.";
    default:
      return "No se pudo cargar el video en el reproductor.";
  }
}

function formatDuration(duration?: number | null) {
  if (!duration) return "--:--";

  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function AdminPlaybackPlayer({
  playback,
  onPlaybackEnded,
  mode = "default",
}: {
  playback: PlaybackState | null;
  onPlaybackEnded?: () => void | Promise<void>;
  mode?: "default" | "screen";
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const playbackRef = useRef<PlaybackState | null>(playback);
  const endedCallbackRef = useRef<typeof onPlaybackEnded>(onPlaybackEnded);
  const [isReady, setIsReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const currentSong = playback?.song ?? null;
  const youtubeId = currentSong?.youtube_id ?? null;
  const isPlaying = playback?.status === "playing" && Boolean(youtubeId);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    endedCallbackRef.current = onPlaybackEnded;
  }, [onPlaybackEnded]);

  useEffect(() => {
    let cancelled = false;

    async function createPlayer() {
      if (!mountRef.current || playerRef.current) return;

      const module = (await import("youtube-player")) as {
        default: YouTubePlayerFactory;
      };

      if (cancelled || !mountRef.current) return;

      const player = module.default(mountRef.current, {
        height: "100%",
        width: "100%",
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
      });

      player.on("ready", () => {
        if (!cancelled) {
          setIsReady(true);
        }
      });

      player.on("error", (event?: { data?: number }) => {
        if (!cancelled) {
          setPlayerError(getPlayerErrorMessage(event?.data));
        }
      });

      player.on("stateChange", (event?: { data?: number }) => {
        if (event?.data !== 0) return;

        const currentPlayback = playbackRef.current;
        if (currentPlayback?.status !== "playing") return;

        void endedCallbackRef.current?.();
      });

      playerRef.current = player;
    }

    createPlayer().catch(console.error);

    return () => {
      cancelled = true;
      setIsReady(false);

      if (playerRef.current) {
        void Promise.resolve(playerRef.current.destroy()).catch(() => undefined);
        playerRef.current = null;
      }

      loadedVideoIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;

    if (!player || !isReady) return;

    const readyPlayer: YouTubePlayerInstance = player;

    async function syncPlayback() {
      if (!youtubeId) {
        setPlayerError(null);
        loadedVideoIdRef.current = null;
        await readyPlayer.stopVideo().catch(() => undefined);
        return;
      }

      if (loadedVideoIdRef.current !== youtubeId) {
        setPlayerError(null);
        await readyPlayer.loadVideoById(youtubeId);
        loadedVideoIdRef.current = youtubeId;
      }

      if (isPlaying) {
        await readyPlayer.playVideo().catch(() => undefined);
        return;
      }

      await readyPlayer.pauseVideo().catch(() => undefined);
    }

    syncPlayback().catch(console.error);
  }, [isPlaying, isReady, youtubeId]);

  return (
    <section
      className={mode === "screen" ? "playback-shell playback-shell-screen" : "playback-shell"}
      style={{
        padding: mode === "screen" ? "20px 28px 28px" : "16px 20px 20px",
        borderBottom: mode === "screen" ? "none" : "1px solid #161616",
        background: "#0b0b0b",
        display: "grid",
        gap: mode === "screen" ? 20 : 16,
        gridTemplateColumns:
          mode === "screen"
            ? "minmax(0, 2.2fr) minmax(320px, 0.8fr)"
            : "minmax(0, 1.7fr) minmax(240px, 0.9fr)",
        alignItems: "stretch",
        flex: mode === "screen" ? 1 : undefined,
      }}
    >
      <style>{`
        .playback-shell-screen {
          min-height: 100%;
        }

        .playback-shell-screen .playback-video-frame {
          min-height: clamp(420px, 72vh, 860px);
        }

        .playback-shell-screen .playback-meta-panel {
          min-height: clamp(420px, 72vh, 860px);
        }

        .playback-shell-screen .playback-title {
          font-size: clamp(30px, 3vw, 44px);
        }

        .playback-shell-screen .playback-data {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px 20px;
        }

        @media (max-width: 1180px) {
          .playback-shell-screen {
            grid-template-columns: minmax(0, 1fr);
          }

          .playback-shell-screen .playback-video-frame {
            min-height: clamp(320px, 56vh, 720px);
          }

          .playback-shell-screen .playback-meta-panel {
            min-height: auto;
          }
        }

        @media (max-width: 720px) {
          .playback-shell-screen {
            padding: 16px;
          }

          .playback-shell-screen .playback-video-frame {
            min-height: clamp(240px, 44vh, 420px);
          }

          .playback-shell-screen .playback-data {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>
      <div
        className="playback-video-frame"
        style={{
          minHeight: mode === "screen" ? undefined : PLAYER_HEIGHT,
          border: "1px solid #1f1f1f",
          background: "#050505",
          position: "relative",
          overflow: "hidden",
          boxShadow:
            mode === "screen"
              ? "0 24px 90px rgba(0,0,0,0.45)"
              : undefined,
        }}
      >
        <div
          ref={mountRef}
          style={{
            width: "100%",
            height: "100%",
            minHeight: "inherit",
          }}
        />
        {(!youtubeId || playerError) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              textAlign: "center",
              color: "#4a4a4a",
              fontFamily: "monospace",
              fontSize: 11,
              letterSpacing: 2,
              background:
                "linear-gradient(135deg, rgba(255,220,50,0.05), rgba(0,0,0,0.9))",
            }}
          >
            {playerError ?? "SIN VIDEO ACTIVO"}
          </div>
        )}
      </div>

      <div
        className="playback-meta-panel"
        style={{
          border: "1px solid #1f1f1f",
          background: "#0f0f0f",
          padding: mode === "screen" ? 24 : 18,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: mode === "screen" ? 22 : 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              color: "#555",
              letterSpacing: 2,
              fontFamily: "monospace",
              marginBottom: 8,
            }}
          >
            REPRODUCTOR
          </div>
          <div
            className="playback-title"
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: mode === "screen" ? 32 : 22,
              color: "#f5f5f5",
              lineHeight: 1.05,
            }}
          >
            {currentSong?.title ?? "Esperando siguiente cancion"}
          </div>
        </div>

        <div
          className="playback-data"
          style={{
            display: "grid",
            gap: mode === "screen" ? 16 : 10,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 9,
                color: "#444",
                letterSpacing: 2,
                fontFamily: "monospace",
              }}
            >
              ESTADO
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 18,
                color: isPlaying ? "#22c55e" : "#777",
              }}
            >
              {isPlaying ? "SONANDO AHORA" : "EN ESPERA"}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 9,
                color: "#444",
                letterSpacing: 2,
                fontFamily: "monospace",
              }}
            >
              DURACION
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 18,
                color: "#FFDC32",
              }}
            >
              {formatDuration(currentSong?.duration)}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 9,
                color: "#444",
                letterSpacing: 2,
                fontFamily: "monospace",
              }}
            >
              MESA
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 18,
                color: "#f5f5f5",
              }}
            >
              {playback?.table_id ? `Mesa ${String(playback.table_id).padStart(2, "0")}` : "--"}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 9,
                color: "#444",
                letterSpacing: 2,
                fontFamily: "monospace",
              }}
            >
              VIDEO
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "monospace",
                fontSize: 11,
                color: "#777",
                wordBreak: "break-all",
              }}
            >
              {youtubeId ?? "sin asignar"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
