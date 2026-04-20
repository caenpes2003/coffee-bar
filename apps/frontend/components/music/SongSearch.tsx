"use client";

import { useState, useRef, useEffect } from "react";
import { musicApi, queueApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type { YouTubeSearchResult, QueueItem } from "@coffee-bar/shared";
import { MAX_SONG_DURATION_SECONDS } from "@coffee-bar/shared";

const pad = (n: number) => String(n).padStart(2, "0");
const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

// Warm premium palette — mirrors apps/frontend/app/mesa/[id]/page.tsx
const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  terracotta: "#8B2635",
  terracottaSoft: "#E8CDD2",
  olive: "#6B7E4A",
  oliveSoft: "#E5EAD3",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
  paper: "#FFFDF8",
  shadow: "0 1px 0 rgba(43,29,20,0.04), 0 12px 32px -18px rgba(107,78,46,0.28)",
  shadowLift: "0 2px 0 rgba(43,29,20,0.05), 0 22px 40px -18px rgba(184,137,74,0.55)",
  shadowModal: "0 30px 80px -20px rgba(43,29,20,0.45), 0 10px 32px -12px rgba(107,78,46,0.35)",
};
const FONT_DISPLAY = "var(--font-bebas), 'Bebas Neue', Impact, sans-serif";
const FONT_UI = "var(--font-manrope), system-ui, sans-serif";
const FONT_MONO = "var(--font-oswald), 'Oswald', ui-monospace, monospace";

type SearchState = "idle" | "loading" | "success" | "empty" | "error";

interface SongSearchProps {
  tableId: number;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  myQueue: QueueItem[];
  globalQueue: QueueItem[];
}

export default function SongSearch({
  tableId,
  open,
  onClose,
  onAdded,
  myQueue,
  globalQueue,
}: SongSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myQueueYoutubeIds = new Set(
    myQueue
      .filter((item) => item.status === "pending" || item.status === "playing")
      .map((item) => item.song?.youtube_id)
      .filter(Boolean),
  );

  const globalQueueYoutubeIds = new Set(
    globalQueue
      .filter((item) => item.status === "playing" || item.status === "pending")
      .map((item) => item.song?.youtube_id)
      .filter(Boolean),
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setError(null);
      setSearchState("idle");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const search = async (q: string) => {
    if (q.trim().length < 2) return;
    setSearchState("loading");
    setError(null);
    try {
      const data = await musicApi.search(q);
      setSearchState(data.length === 0 ? "empty" : "success");
      setResults(data);
    } catch (err) {
      setSearchState("error");
      setError(getErrorMessage(err));
    }
  };

  const handleInput = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim().length < 2) {
      setSearchState("idle");
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(() => search(value), 400);
  };

  const handleAdd = async (result: YouTubeSearchResult) => {
    setAdding(result.youtubeId);
    setError(null);
    try {
      await queueApi.addSong({
        youtube_id: result.youtubeId,
        title: result.title,
        duration: result.duration,
        table_id: tableId,
      });
      onAdded();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAdding(null);
    }
  };

  if (!open) return null;

  return (
    <>
      <style>{modalStyles}</style>
      <div
        className="ss-overlay"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label="Buscar canción"
          className="ss-modal"
        >
          {/* Header */}
          <div className="ss-header">
            <div className="ss-header-text">
              <div className="ss-caption">— Buscar música</div>
              <h2 className="ss-title">ELIGE UNA CANCIÓN</h2>
              <p className="ss-subtitle">
                El sistema organiza tu canción en la mejor posición.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="ss-close"
            >
              ×
            </button>
          </div>

          {/* Search input */}
          <div className="ss-search">
            <span className="ss-search-icon" aria-hidden>
              ⌕
            </span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              placeholder="Nombre de canción o artista..."
              aria-label="Buscar canción"
              className="ss-input"
            />
            {query && (
              <button
                type="button"
                onClick={() => handleInput("")}
                aria-label="Limpiar búsqueda"
                className="ss-clear"
              >
                ×
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div role="alert" className="ss-error">
              {error}
            </div>
          )}

          {/* Results */}
          <div className="ss-results" aria-live="polite">
            {searchState === "idle" && (
              <div className="ss-empty">
                <div className="ss-empty-icon">♪</div>
                <p className="ss-empty-title">Busca una canción</p>
                <p className="ss-empty-body">
                  Escribe el nombre o el artista para comenzar
                </p>
              </div>
            )}

            {searchState === "loading" && (
              <div className="ss-skeletons">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="ss-skeleton-row">
                    <div className="ss-skeleton-thumb" />
                    <div className="ss-skeleton-text">
                      <div className="ss-skeleton-line ss-skeleton-line-1" />
                      <div className="ss-skeleton-line ss-skeleton-line-2" />
                    </div>
                  </div>
                ))}
                <p className="ss-loading-label">Buscando canciones...</p>
              </div>
            )}

            {searchState === "empty" && (
              <div className="ss-empty">
                <div className="ss-empty-icon">∅</div>
                <p className="ss-empty-title">Sin resultados</p>
                <p className="ss-empty-body">
                  Intenta con otro nombre o artista
                </p>
              </div>
            )}

            {(searchState === "success" || results.length > 0) &&
              results.map((r) => {
                const tooLong = r.duration > MAX_SONG_DURATION_SECONDS;
                const alreadyInMyQueue = myQueueYoutubeIds.has(r.youtubeId);
                const inGlobalQueue = globalQueueYoutubeIds.has(r.youtubeId);
                const isAdding = adding === r.youtubeId;

                let buttonLabel = "AGREGAR";
                let statusTag = "";
                let statusColor = "";
                let disabled = false;
                let buttonVariant: "primary" | "muted" | "loading" = "primary";

                if (alreadyInMyQueue) {
                  buttonLabel = "EN COLA";
                  statusTag = "YA EN TU COLA";
                  statusColor = C.gold;
                  disabled = true;
                  buttonVariant = "muted";
                } else if (inGlobalQueue) {
                  buttonLabel = "EN COLA";
                  statusTag = "YA EN LA COLA";
                  statusColor = C.gold;
                  disabled = true;
                  buttonVariant = "muted";
                } else if (tooLong) {
                  buttonLabel = "MUY LARGA";
                  statusTag = "EXCEDE LÍMITE";
                  statusColor = C.terracotta;
                  disabled = true;
                  buttonVariant = "muted";
                } else if (isAdding) {
                  buttonLabel = "...";
                  disabled = true;
                  buttonVariant = "loading";
                }

                return (
                  <div
                    key={r.youtubeId}
                    className={`ss-row ${disabled && !isAdding ? "is-disabled" : ""}`}
                  >
                    {r.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.thumbnail}
                        alt=""
                        className="ss-row-thumb"
                      />
                    ) : (
                      <div className="ss-row-thumb ss-row-thumb-placeholder" aria-hidden>
                        ♪
                      </div>
                    )}
                    <div className="ss-row-text">
                      <div className="ss-row-title">{r.title}</div>
                      <div className="ss-row-meta">
                        <span>{secToMin(r.duration)}</span>
                        {statusTag && (
                          <span
                            className="ss-row-tag"
                            style={{ color: statusColor, borderColor: statusColor }}
                          >
                            · {statusTag}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAdd(r)}
                      disabled={disabled}
                      aria-disabled={disabled}
                      aria-label={
                        disabled
                          ? `${r.title} — ${statusTag || "no disponible"}`
                          : `Agregar ${r.title} a la cola`
                      }
                      className={`ss-row-btn ss-row-btn-${buttonVariant}`}
                    >
                      {buttonLabel}
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </>
  );
}

const modalStyles = `
  @keyframes ss-overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes ss-modal-in {
    from { opacity: 0; transform: translateY(12px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes ss-pulse {
    0%, 100% { opacity: 0.55; }
    50%      { opacity: 1;    }
  }

  .ss-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background:
      radial-gradient(ellipse at 30% 20%, rgba(184,137,74,0.15), transparent 60%),
      radial-gradient(ellipse at 80% 80%, rgba(197,90,60,0.12), transparent 55%),
      rgba(43,29,20,0.55);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    animation: ss-overlay-in 0.2s ease-out;
    overflow-y: auto;
  }

  .ss-modal {
    font-family: ${FONT_UI};
    color: ${C.ink};
    width: 100%;
    max-width: 560px;
    max-height: min(680px, calc(100dvh - 32px));
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, ${C.paper} 0%, ${C.parchment} 100%);
    border: 1px solid ${C.sand};
    border-radius: 20px;
    box-shadow: ${C.shadowModal};
    overflow: hidden;
    animation: ss-modal-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .ss-caption {
    font-family: ${FONT_MONO};
    font-size: 9px;
    letter-spacing: 3px;
    color: ${C.mute};
    text-transform: uppercase;
    font-weight: 600;
  }

  /* Header */
  .ss-header {
    padding: 20px 22px 16px;
    border-bottom: 1px solid ${C.sand};
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    background: linear-gradient(180deg, ${C.paper} 0%, transparent 100%);
  }
  .ss-header-text { flex: 1; min-width: 0; }
  .ss-title {
    font-family: ${FONT_DISPLAY};
    font-size: 24px;
    letter-spacing: 3px;
    color: ${C.ink};
    margin: 6px 0 4px;
    line-height: 1;
  }
  .ss-subtitle {
    font-size: 11px;
    color: ${C.cacao};
    font-family: ${FONT_MONO};
    letter-spacing: 1px;
    margin: 0;
    line-height: 1.5;
  }
  .ss-close {
    background: ${C.paper};
    border: 1px solid ${C.sand};
    color: ${C.cacao};
    width: 34px;
    height: 34px;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.15s ease;
    font-family: ${FONT_UI};
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
  }
  .ss-close:hover {
    background: ${C.terracottaSoft};
    border-color: ${C.terracotta};
    color: ${C.terracotta};
  }
  .ss-close:active { transform: scale(0.94); }
  .ss-close:focus-visible {
    outline: 2px solid ${C.gold};
    outline-offset: 2px;
  }

  /* Search */
  .ss-search {
    position: relative;
    padding: 14px 22px 6px;
  }
  .ss-search-icon {
    position: absolute;
    left: 34px;
    top: 50%;
    transform: translateY(calc(-50% + 2px));
    font-size: 16px;
    color: ${C.mute};
    pointer-events: none;
  }
  .ss-input {
    width: 100%;
    padding: 13px 40px 13px 40px;
    background: ${C.paper};
    border: 1px solid ${C.sand};
    color: ${C.ink};
    font-family: ${FONT_UI};
    font-size: 14px;
    outline: none;
    border-radius: 12px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .ss-input::placeholder {
    color: ${C.mute};
    font-family: ${FONT_UI};
  }
  .ss-input:focus {
    border-color: ${C.gold};
    box-shadow: 0 0 0 3px rgba(184,137,74,0.18);
  }
  .ss-clear {
    position: absolute;
    right: 32px;
    top: 50%;
    transform: translateY(calc(-50% + 2px));
    background: ${C.sand};
    border: none;
    color: ${C.cacao};
    width: 22px;
    height: 22px;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: ${FONT_UI};
    -webkit-tap-highlight-color: transparent;
  }
  .ss-clear:hover { background: ${C.sandDark}; color: ${C.ink}; }

  /* Error */
  .ss-error {
    margin: 10px 22px 0;
    padding: 10px 12px;
    background: ${C.terracottaSoft};
    border: 1px solid ${C.terracotta};
    color: ${C.terracotta};
    font-family: ${FONT_MONO};
    font-size: 11px;
    letter-spacing: 1px;
    border-radius: 10px;
  }

  /* Results scroll area */
  .ss-results {
    flex: 1;
    overflow-y: auto;
    padding: 10px 22px 20px;
    min-height: 0;
  }
  .ss-results::-webkit-scrollbar { width: 6px; }
  .ss-results::-webkit-scrollbar-thumb {
    background: ${C.sandDark};
    border-radius: 999px;
  }

  /* Empty state */
  .ss-empty {
    text-align: center;
    padding: 48px 24px;
  }
  .ss-empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: ${C.goldSoft}80;
    border: 1px solid ${C.goldSoft};
    color: ${C.gold};
    font-family: ${FONT_DISPLAY};
    font-size: 26px;
    margin-bottom: 14px;
  }
  .ss-empty-title {
    font-family: ${FONT_DISPLAY};
    font-size: 16px;
    color: ${C.cacao};
    letter-spacing: 2.5px;
    margin: 0;
    text-transform: uppercase;
  }
  .ss-empty-body {
    font-family: ${FONT_MONO};
    font-size: 10px;
    color: ${C.mute};
    letter-spacing: 1.5px;
    margin: 8px 0 0;
    text-transform: uppercase;
  }

  /* Skeletons */
  .ss-skeletons { padding: 12px 0; }
  .ss-skeleton-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid ${C.sand};
  }
  .ss-skeleton-thumb {
    width: 56px;
    height: 42px;
    background: ${C.sand};
    border-radius: 8px;
    animation: ss-pulse 1.6s ease-in-out infinite;
  }
  .ss-skeleton-text { flex: 1; }
  .ss-skeleton-line {
    height: 11px;
    background: ${C.sand};
    border-radius: 4px;
    animation: ss-pulse 1.6s ease-in-out infinite;
  }
  .ss-skeleton-line-1 { width: 75%; margin-bottom: 6px; }
  .ss-skeleton-line-2 { width: 35%; height: 8px; background: ${C.parchment}; }
  .ss-loading-label {
    text-align: center;
    padding: 14px 0 4px;
    color: ${C.mute};
    font-family: ${FONT_MONO};
    font-size: 11px;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    margin: 0;
  }

  /* Result row */
  .ss-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 10px;
    margin: 0 -10px;
    border-radius: 10px;
    border-bottom: 1px solid ${C.sand};
    transition: background 0.2s ease;
  }
  .ss-row:last-child { border-bottom: none; }
  .ss-row:hover { background: ${C.parchment}; }
  .ss-row.is-disabled { opacity: 0.55; }

  .ss-row-thumb {
    width: 56px;
    height: 42px;
    object-fit: cover;
    border-radius: 8px;
    background: ${C.sand};
    flex-shrink: 0;
    box-shadow: 0 4px 10px -6px rgba(43,29,20,0.3);
  }
  .ss-row-thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: ${FONT_DISPLAY};
    color: ${C.gold};
    background: linear-gradient(135deg, ${C.goldSoft} 0%, ${C.terracottaSoft} 100%);
  }

  .ss-row-text { flex: 1; min-width: 0; }
  .ss-row-title {
    font-family: ${FONT_DISPLAY};
    font-size: 15px;
    color: ${C.ink};
    letter-spacing: 0.4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }
  .ss-row-meta {
    font-size: 10px;
    color: ${C.mute};
    font-family: ${FONT_MONO};
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 4px;
    letter-spacing: 1px;
  }
  .ss-row-tag {
    font-size: 9px;
    letter-spacing: 1.2px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .ss-row-btn {
    flex-shrink: 0;
    border: none;
    padding: 8px 14px;
    font-family: ${FONT_DISPLAY};
    font-size: 12px;
    letter-spacing: 2.5px;
    cursor: pointer;
    white-space: nowrap;
    border-radius: 999px;
    transition: transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .ss-row-btn-primary {
    background: linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%);
    color: ${C.paper};
    box-shadow: 0 6px 16px -8px ${C.gold};
  }
  .ss-row-btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 22px -8px ${C.gold};
  }
  .ss-row-btn-primary:active {
    transform: translateY(0) scale(0.96);
    background: ${C.terracotta};
  }
  .ss-row-btn-muted {
    background: ${C.sand};
    color: ${C.mute};
    cursor: not-allowed;
  }
  .ss-row-btn-loading {
    background: ${C.sandDark};
    color: ${C.cacao};
    cursor: wait;
  }
  .ss-row-btn:focus-visible {
    outline: 2px solid ${C.ink};
    outline-offset: 2px;
  }

  /* Mobile refinements */
  @media (max-width: 520px) {
    .ss-overlay { padding: 12px; }
    .ss-modal {
      max-height: calc(100dvh - 24px);
      border-radius: 18px;
    }
    .ss-header { padding: 16px 18px 14px; }
    .ss-title { font-size: 20px; }
    .ss-search { padding: 12px 18px 4px; }
    .ss-search-icon { left: 30px; }
    .ss-clear { right: 28px; }
    .ss-results { padding: 8px 18px 16px; }
    .ss-row { gap: 10px; padding: 11px 8px; margin: 0 -8px; }
    .ss-row-thumb { width: 48px; height: 36px; }
    .ss-row-btn { padding: 7px 11px; font-size: 11px; letter-spacing: 2px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ss-overlay, .ss-modal { animation: none !important; }
    .ss-skeleton-thumb, .ss-skeleton-line { animation: none !important; }
    .ss-row, .ss-row-btn, .ss-input, .ss-close { transition: none !important; }
  }
`;
