"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "@coffee-bar/shared";
import { playbackApi } from "@/lib/api/services";

// ─── Dark stadium palette (landing + player aligned) ─────────────────────────
const D = {
  midnight: "#0B0F14",
  pitch: "#0E2A1F",
  gold: "#E9B949",
  goldHot: "#F6CF6A",
  cream: "#F5EFE2",
  burgundy: "#8B2635",
  chalk: "rgba(245,239,226,0.08)",
  chalkStrong: "rgba(245,239,226,0.14)",
  mute: "rgba(245,239,226,0.55)",
  muted2: "rgba(245,239,226,0.72)",
  surface: "rgba(11,15,20,0.6)",
  surfaceSolid: "#101720",
};
const FONT_DISPLAY = "var(--font-bebas), 'Bebas Neue', Impact, sans-serif";
const FONT_MONO = "var(--font-oswald), 'Oswald', ui-monospace, monospace";

type YouTubePlayerInstance = {
  destroy: () => Promise<void> | void;
  loadVideoById: (videoId: string) => Promise<void>;
  pauseVideo: () => Promise<void>;
  playVideo: () => Promise<void>;
  stopVideo: () => Promise<void>;
  getCurrentTime: () => Promise<number>;
  on: (eventName: string, listener: (event?: { data?: number }) => void) => void;
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
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);

  const currentSong = playback?.song ?? null;
  const youtubeId = currentSong?.youtube_id ?? null;
  const isActive =
    (playback?.status === "playing" || playback?.status === "buffering") &&
    Boolean(youtubeId);
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
        const state = event?.data;

        // YouTube states: 3 = buffering, 1 = playing, 0 = ended
        if (state === 3) {
          setIsBuffering(true);
        }

        if (state === 1) {
          // Video started playing — notify backend
          setIsBuffering(false);
          const pb = playbackRef.current;
          if (pb?.status === "buffering") {
            playbackApi.setPlaying().catch(console.error);
          }
        }

        if (state !== 0) return;

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

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      if (playerRef.current) {
        void Promise.resolve(playerRef.current.destroy()).catch(() => undefined);
        playerRef.current = null;
      }

      loadedVideoIdRef.current = null;
    };
  }, []);

  // Buffering timeout: if stuck in buffering >30s, force transition to playing
  useEffect(() => {
    if (playback?.status !== "buffering") return;

    const timeout = setTimeout(() => {
      playbackApi.setPlaying().catch(console.error);
    }, 30_000);

    return () => clearTimeout(timeout);
  }, [playback?.status]);

  // Sync position_seconds to backend every 10s while playing
  useEffect(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    if (!isPlaying || !isReady || !playerRef.current) return;

    const player = playerRef.current;
    progressIntervalRef.current = setInterval(async () => {
      try {
        // Guard: only sync if still playing (avoid race with state changes)
        if (playbackRef.current?.status !== "playing") return;
        const time = await player.getCurrentTime();
        playbackApi.updateProgress(time).catch(() => undefined);
      } catch {
        // player may be destroyed
      }
    }, 10_000);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isPlaying, isReady]);

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

      if (isActive) {
        await readyPlayer.playVideo().catch(() => undefined);
        return;
      }

      await readyPlayer.pauseVideo().catch(() => undefined);
    }

    syncPlayback().catch(console.error);
  }, [isActive, isReady, youtubeId]);

  const isScreen = mode === "screen";

  return (
    <section
      className={isScreen ? "playback-shell playback-shell-screen" : "playback-shell"}
      style={{
        padding: isScreen ? "24px 28px 28px" : "16px 20px 20px",
        borderBottom: isScreen ? "none" : `1px solid ${D.chalk}`,
        background: isScreen ? "transparent" : D.surfaceSolid,
        color: D.cream,
        display: "grid",
        gap: isScreen ? 22 : 16,
        gridTemplateColumns: isScreen
          ? "minmax(0, 2.2fr) minmax(340px, 0.8fr)"
          : "minmax(0, 1.7fr) minmax(240px, 0.9fr)",
        alignItems: "stretch",
        flex: isScreen ? 1 : undefined,
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
          minHeight: isScreen ? undefined : PLAYER_HEIGHT,
          border: `1px solid ${D.chalk}`,
          background: "#000",
          position: "relative",
          overflow: "hidden",
          borderRadius: 14,
          boxShadow: isScreen
            ? "0 18px 48px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(233,185,73,0.08)"
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
              color: playerError ? D.burgundy : D.mute,
              fontFamily: FONT_MONO,
              fontSize: 12,
              letterSpacing: 2,
              fontWeight: 600,
              textTransform: "uppercase",
              background: D.midnight,
            }}
          >
            {playerError ?? "Sin video activo"}
          </div>
        )}
      </div>

      <div
        className="playback-meta-panel"
        style={{
          border: `1px solid ${D.chalk}`,
          background: D.surface,
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          borderRadius: 14,
          padding: isScreen ? 28 : 18,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: isScreen ? 24 : 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              color: D.mute,
              letterSpacing: 3,
              fontFamily: FONT_MONO,
              fontWeight: 600,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            — Reproductor
          </div>
          <div
            className="playback-title"
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: isScreen ? 32 : 22,
              color: D.cream,
              lineHeight: 1.05,
              letterSpacing: 0.5,
            }}
          >
            {currentSong?.title ?? "Esperando siguiente canción"}
          </div>
        </div>

        <div
          className="playback-data"
          style={{
            display: "grid",
            gap: isScreen ? 18 : 10,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
        >
          <MetaField
            label="Estado"
            value={
              isBuffering
                ? "CARGANDO..."
                : isPlaying
                  ? "SONANDO"
                  : "EN ESPERA"
            }
            color={isPlaying ? D.gold : isBuffering ? D.goldHot : D.mute}
            indicator={isPlaying}
          />
          <MetaField
            label="Duración"
            value={formatDuration(currentSong?.duration)}
            color={D.goldHot}
          />
          <MetaField
            label="Mesa"
            value={
              playback?.table_id
                ? `Mesa ${String(playback.table_id).padStart(2, "0")}`
                : "ADMIN"
            }
            color={D.cream}
          />
          <MetaField
            label="Video"
            value={youtubeId ?? "sin asignar"}
            color={D.muted2}
            mono
          />
        </div>
      </div>
    </section>
  );
}

function MetaField({
  label,
  value,
  color,
  mono,
  indicator,
}: {
  label: string;
  value: string;
  color: string;
  mono?: boolean;
  indicator?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          color: D.mute,
          letterSpacing: 2.5,
          fontFamily: FONT_MONO,
          fontWeight: 600,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          fontFamily: mono ? FONT_MONO : FONT_DISPLAY,
          fontSize: mono ? 12 : 20,
          color,
          letterSpacing: mono ? 1 : 0.5,
          wordBreak: mono ? "break-all" : "normal",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {indicator && (
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: color,
              boxShadow: `0 0 10px ${color}`,
            }}
          />
        )}
        {value}
      </div>
    </div>
  );
}
