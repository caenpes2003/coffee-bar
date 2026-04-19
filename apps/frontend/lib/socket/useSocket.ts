"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { SocketEvents } from "@coffee-bar/shared";

// ─── Singleton ────────────────────────────────────────────────────────────────
let socket: Socket | null = null;

function resolveSocketUrl() {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) {
    return process.env.NEXT_PUBLIC_SOCKET_URL;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;

    return `${protocol}//${hostname}:3001`;
  }

  return "http://localhost:3001";
}

function getSocket(): Socket {
  if (!socket) {
    socket = io(resolveSocketUrl(), {
      transports: ["websocket"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on("connect", () => {
      console.log("[Socket] conectado →", socket?.id);
    });

    socket.on("disconnect", (reason) => {
      console.warn("[Socket] desconectado →", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket] error de conexión →", err.message);
    });

    socket.io.on("reconnect", (attempt) => {
      console.log(`[Socket] reconectado después de ${attempt} intentos`);
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      if (attempt <= 3 || attempt % 5 === 0) {
        console.log(`[Socket] reintentando conexión (intento ${attempt})...`);
      }
    });
  }
  return socket;
}

// ─── Tipos de listeners ───────────────────────────────────────────────────────
type SocketListener<K extends keyof SocketEvents> = (
  payload: SocketEvents[K],
) => void;

// ─── Opciones del hook ────────────────────────────────────────────────────────
interface UseSocketOptions {
  tableId?: number;
  onQueueUpdated?: SocketListener<"queue:updated">;
  onTableUpdated?: SocketListener<"table:updated">;
  onOrderUpdated?: SocketListener<"order:updated">;
  onPlaybackUpdated?: SocketListener<"playback:updated">;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSocket(options: UseSocketOptions = {}) {
  const {
    tableId,
    onQueueUpdated,
    onTableUpdated,
    onOrderUpdated,
    onPlaybackUpdated,
  } = options;
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;

    if (!s.connected) s.connect();

    // Join room on connect and re-join on reconnect
    const joinRoom = () => {
      if (tableId !== undefined) {
        s.emit("table:join", tableId);
      }
    };

    joinRoom();
    s.on("connect", joinRoom);

    if (onQueueUpdated) s.on("queue:updated", onQueueUpdated);
    if (onTableUpdated) s.on("table:updated", onTableUpdated);
    if (onOrderUpdated) s.on("order:updated", onOrderUpdated);
    if (onPlaybackUpdated) s.on("playback:updated", onPlaybackUpdated);

    return () => {
      s.off("connect", joinRoom);
      if (onQueueUpdated) s.off("queue:updated", onQueueUpdated);
      if (onTableUpdated) s.off("table:updated", onTableUpdated);
      if (onOrderUpdated) s.off("order:updated", onOrderUpdated);
      if (onPlaybackUpdated) s.off("playback:updated", onPlaybackUpdated);
    };
  }, [tableId, onQueueUpdated, onTableUpdated, onOrderUpdated, onPlaybackUpdated]);

  // ─── Acciones ─────────────────────────────────────────────────────────────
  const requestSong = useCallback((payload: SocketEvents["song:request"]) => {
    socketRef.current?.emit("song:request", payload);
  }, []);

  const isConnected = useCallback(
    () => socketRef.current?.connected ?? false,
    [],
  );

  return { requestSong, isConnected };
}
