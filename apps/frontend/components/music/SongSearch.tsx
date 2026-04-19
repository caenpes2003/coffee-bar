"use client";

import { useState, useRef, useEffect } from "react";
import { musicApi, queueApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type { YouTubeSearchResult, QueueItem } from "@coffee-bar/shared";
import { MAX_SONG_DURATION_SECONDS } from "@coffee-bar/shared";

const pad = (n: number) => String(n).padStart(2, "0");
const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

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

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
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
    if (value.trim().length < 2) { setSearchState("idle"); setResults([]); return; }
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
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Buscar canción"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 480,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "12px 12px 0 0",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.15)",
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
            <span
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 18,
                letterSpacing: 3,
                color: "#111",
              }}
            >
              ELIGE UNA CANCIÓN
            </span>
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", marginTop: 4 }}>
              El sistema organiza tu canción en la mejor posición.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "#f3f4f6",
              border: "1px solid #d1d5db",
              color: "#888",
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

        {/* Search input */}
        <div style={{ padding: "12px 20px" }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Nombre de canción o artista..."
            aria-label="Buscar canción"
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

        {/* Error */}
        {error && (
          <div
            role="alert"
            style={{
              padding: "8px 12px",
              margin: "0 20px 8px",
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
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }} aria-live="polite">
          {searchState === "idle" && (
            <p style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontFamily: "monospace", fontSize: 11, letterSpacing: 2 }}>
              BUSCA UNA CANCIÓN PARA AGREGAR A LA COLA
            </p>
          )}

          {searchState === "loading" && (
            <div style={{ padding: "20px 0" }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ width: 48, height: 36, background: "#f3f4f6", borderRadius: 3, animation: "pulse 2s infinite" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ width: "70%", height: 12, background: "#f3f4f6", borderRadius: 2, marginBottom: 6, animation: "pulse 2s infinite" }} />
                    <div style={{ width: "30%", height: 8, background: "#f9fafb", borderRadius: 2, animation: "pulse 2s infinite" }} />
                  </div>
                </div>
              ))}
              <p style={{ textAlign: "center", padding: "12px 0", color: "#9ca3af", fontFamily: "monospace", fontSize: 11, letterSpacing: 2 }}>
                BUSCANDO CANCIONES...
              </p>
            </div>
          )}

          {searchState === "empty" && (
            <p style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontFamily: "monospace", fontSize: 11, letterSpacing: 2 }}>
              NO ENCONTRAMOS CANCIONES PARA ESA BÚSQUEDA
            </p>
          )}


          {(searchState === "success" || results.length > 0) &&
            results.map((r) => {
              const tooLong = r.duration > MAX_SONG_DURATION_SECONDS;
              const alreadyInMyQueue = myQueueYoutubeIds.has(r.youtubeId);
              const inGlobalQueue = globalQueueYoutubeIds.has(r.youtubeId);
              const isAdding = adding === r.youtubeId;

              let buttonLabel = "AGREGAR";
              let buttonBg = "#2563eb";
              let buttonColor = "#fff";
              let statusTag = "";
              let statusColor = "";
              let disabled = false;

              if (alreadyInMyQueue) {
                buttonLabel = "EN COLA"; buttonBg = "#f3f4f6"; buttonColor = "#9ca3af";
                statusTag = "YA EN TU COLA"; statusColor = "#ca8a04"; disabled = true;
              } else if (inGlobalQueue) {
                buttonLabel = "EN COLA"; buttonBg = "#f3f4f6"; buttonColor = "#9ca3af";
                statusTag = "YA EN LA COLA"; statusColor = "#ca8a04"; disabled = true;
              } else if (tooLong) {
                buttonLabel = "MUY LARGA"; buttonBg = "#f3f4f6"; buttonColor = "#9ca3af";
                statusTag = "EXCEDE LÍMITE"; statusColor = "#dc2626"; disabled = true;
              } else if (isAdding) {
                buttonLabel = "..."; buttonBg = "#e5e7eb"; buttonColor = "#9ca3af"; disabled = true;
              }

              return (
                <div
                  key={r.youtubeId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom: "1px solid #f3f4f6",
                    opacity: disabled && !isAdding ? 0.6 : 1,
                  }}
                >
                  {r.thumbnail && (
                    <img src={r.thumbnail} alt="" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 3 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: 13, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 10, color: tooLong ? "#dc2626" : "#9ca3af", fontFamily: "monospace", display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                      <span>{secToMin(r.duration)}</span>
                      {statusTag && (
                        <span style={{ color: statusColor, fontSize: 9, letterSpacing: 1 }}>
                          · {statusTag}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleAdd(r)}
                    disabled={disabled}
                    aria-disabled={disabled}
                    aria-label={disabled ? `${r.title} — ${statusTag || "no disponible"}` : `Agregar ${r.title} a la cola`}
                    style={{
                      background: buttonBg,
                      border: "none",
                      color: buttonColor,
                      padding: "6px 14px",
                      fontFamily: "'Bebas Neue',Impact,sans-serif",
                      fontSize: 11,
                      letterSpacing: 2,
                      cursor: disabled ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                      borderRadius: 4,
                    }}
                  >
                    {buttonLabel}
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
