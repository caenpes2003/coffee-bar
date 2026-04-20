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

type SocketListener<K extends keyof SocketEvents> = (
  payload: SocketEvents[K],
) => void;

interface UseSocketOptions {
  /**
   * Join the session room `tableSession:{id}`. Customer views pass this so
   * they receive bill, order, order-request and session lifecycle events for
   * their own visit only.
   */
  sessionId?: number;
  /**
   * Join the staff room. Today the staff channel is broadcast (pre-auth), so
   * this only affects room membership, not delivery. It future-proofs the UI
   * for when the staff channel gates by auth.
   */
  staff?: boolean;
  /**
   * Legacy per-table room. Kept for back-compat with any client still
   * subscribing by raw table id. New code should use `sessionId` instead.
   */
  tableId?: number;

  onQueueUpdated?: SocketListener<"queue:updated">;
  onPlaybackUpdated?: SocketListener<"playback:updated">;
  onTableUpdated?: SocketListener<"table:updated">;

  onBillUpdated?: SocketListener<"bill:updated">;
  onOrderCreated?: SocketListener<"order:created">;
  onOrderUpdated?: SocketListener<"order:updated">;
  onOrderRequestCreated?: SocketListener<"order-request:created">;
  onOrderRequestUpdated?: SocketListener<"order-request:updated">;
  onTableSessionOpened?: SocketListener<"table-session:opened">;
  onTableSessionUpdated?: SocketListener<"table-session:updated">;
  onTableSessionClosed?: SocketListener<"table-session:closed">;
}

export function useSocket(options: UseSocketOptions = {}) {
  const {
    sessionId,
    staff,
    tableId,
    onQueueUpdated,
    onPlaybackUpdated,
    onTableUpdated,
    onBillUpdated,
    onOrderCreated,
    onOrderUpdated,
    onOrderRequestCreated,
    onOrderRequestUpdated,
    onTableSessionOpened,
    onTableSessionUpdated,
    onTableSessionClosed,
  } = options;
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;

    if (!s.connected) s.connect();

    // Join rooms on connect and re-join on reconnect.
    const joinRooms = () => {
      if (sessionId !== undefined) {
        s.emit("tableSession:join", sessionId);
      }
      if (staff) {
        s.emit("staff:join");
      }
      if (tableId !== undefined) {
        s.emit("table:join", tableId);
      }
    };

    joinRooms();
    s.on("connect", joinRooms);

    if (onQueueUpdated) s.on("queue:updated", onQueueUpdated);
    if (onPlaybackUpdated) s.on("playback:updated", onPlaybackUpdated);
    if (onTableUpdated) s.on("table:updated", onTableUpdated);
    if (onBillUpdated) s.on("bill:updated", onBillUpdated);
    if (onOrderCreated) s.on("order:created", onOrderCreated);
    if (onOrderUpdated) s.on("order:updated", onOrderUpdated);
    if (onOrderRequestCreated)
      s.on("order-request:created", onOrderRequestCreated);
    if (onOrderRequestUpdated)
      s.on("order-request:updated", onOrderRequestUpdated);
    if (onTableSessionOpened)
      s.on("table-session:opened", onTableSessionOpened);
    if (onTableSessionUpdated)
      s.on("table-session:updated", onTableSessionUpdated);
    if (onTableSessionClosed)
      s.on("table-session:closed", onTableSessionClosed);

    return () => {
      s.off("connect", joinRooms);
      if (sessionId !== undefined) s.emit("tableSession:leave", sessionId);
      if (onQueueUpdated) s.off("queue:updated", onQueueUpdated);
      if (onPlaybackUpdated) s.off("playback:updated", onPlaybackUpdated);
      if (onTableUpdated) s.off("table:updated", onTableUpdated);
      if (onBillUpdated) s.off("bill:updated", onBillUpdated);
      if (onOrderCreated) s.off("order:created", onOrderCreated);
      if (onOrderUpdated) s.off("order:updated", onOrderUpdated);
      if (onOrderRequestCreated)
        s.off("order-request:created", onOrderRequestCreated);
      if (onOrderRequestUpdated)
        s.off("order-request:updated", onOrderRequestUpdated);
      if (onTableSessionOpened)
        s.off("table-session:opened", onTableSessionOpened);
      if (onTableSessionUpdated)
        s.off("table-session:updated", onTableSessionUpdated);
      if (onTableSessionClosed)
        s.off("table-session:closed", onTableSessionClosed);
    };
  }, [
    sessionId,
    staff,
    tableId,
    onQueueUpdated,
    onPlaybackUpdated,
    onTableUpdated,
    onBillUpdated,
    onOrderCreated,
    onOrderUpdated,
    onOrderRequestCreated,
    onOrderRequestUpdated,
    onTableSessionOpened,
    onTableSessionUpdated,
    onTableSessionClosed,
  ]);

  const requestSong = useCallback((payload: SocketEvents["song:request"]) => {
    socketRef.current?.emit("song:request", payload);
  }, []);

  const isConnected = useCallback(
    () => socketRef.current?.connected ?? false,
    [],
  );

  return { requestSong, isConnected };
}
