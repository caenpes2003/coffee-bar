import api from "./client";
import type {
  BillView,
  Consumption,
  Order,
  OrderRequest,
  OrderRequestItemInput,
  OrderRequestStatus,
  OrderStatus,
  PlaybackState,
  Product,
  QueueItem,
  Song,
  Table,
  TableSession,
  YouTubeSearchResult,
} from "@coffee-bar/shared";

// ─── Tables ───────────────────────────────────────────────────────────────────
export const tablesApi = {
  getAll: (): Promise<Table[]> =>
    api.get<Table[]>("/tables").then((r) => r.data),
  getById: (id: number): Promise<Table> =>
    api.get<Table>(`/tables/${id}`).then((r) => r.data),
  getDetail: (id: number): Promise<Table> =>
    api.get<Table>(`/tables/${id}/detail`).then((r) => r.data),
};

// ─── Table Sessions ───────────────────────────────────────────────────────────
export const tableSessionsApi = {
  open: (tableId: number): Promise<TableSession> =>
    api
      .post<TableSession>("/table-sessions/open", { table_id: tableId })
      .then((r) => r.data),
  close: (sessionId: number): Promise<TableSession> =>
    api
      .post<TableSession>(`/table-sessions/${sessionId}/close`)
      .then((r) => r.data),
  getById: (sessionId: number): Promise<TableSession> =>
    api.get<TableSession>(`/table-sessions/${sessionId}`).then((r) => r.data),
  /**
   * Returns the open session for a table, or null if there is none.
   * Translates the backend's 404 into a null value so callers can
   * branch on "no session yet" without try/catch.
   */
  getCurrentForTable: async (tableId: number): Promise<TableSession | null> => {
    try {
      const response = await api.get<TableSession>(
        `/tables/${tableId}/session/current`,
      );
      return response.data;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404) return null;
      throw err;
    }
  },
};

// ─── Order Requests ───────────────────────────────────────────────────────────
export const orderRequestsApi = {
  getAll: (params?: {
    status?: OrderRequestStatus;
    table_session_id?: number;
  }): Promise<OrderRequest[]> => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.table_session_id)
      query.set("table_session_id", String(params.table_session_id));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return api.get<OrderRequest[]>(`/order-requests${suffix}`).then((r) => r.data);
  },
  getById: (id: number): Promise<OrderRequest> =>
    api.get<OrderRequest>(`/order-requests/${id}`).then((r) => r.data),
  create: (payload: {
    table_session_id: number;
    items: OrderRequestItemInput[];
  }): Promise<OrderRequest> =>
    api.post<OrderRequest>("/order-requests", payload).then((r) => r.data),
  accept: (id: number): Promise<OrderRequest> =>
    api.post<OrderRequest>(`/order-requests/${id}/accept`).then((r) => r.data),
  reject: (id: number, reason?: string): Promise<OrderRequest> =>
    api
      .post<OrderRequest>(`/order-requests/${id}/reject`, { reason })
      .then((r) => r.data),
  cancel: (id: number): Promise<OrderRequest> =>
    api.post<OrderRequest>(`/order-requests/${id}/cancel`).then((r) => r.data),
};

// ─── Orders (operational transitions only) ───────────────────────────────────
export const ordersApi = {
  getAll: (params?: {
    status?: OrderStatus;
    table_session_id?: number;
  }): Promise<Order[]> => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.table_session_id)
      query.set("table_session_id", String(params.table_session_id));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return api.get<Order[]>(`/orders${suffix}`).then((r) => r.data);
  },
  getById: (id: number): Promise<Order> =>
    api.get<Order>(`/orders/${id}`).then((r) => r.data),
  updateStatus: (orderId: number, status: OrderStatus): Promise<Order> =>
    api
      .patch<Order>(`/orders/${orderId}/status`, { status })
      .then((r) => r.data),
};

// ─── Bill / Consumptions ─────────────────────────────────────────────────────
export const billApi = {
  get: (sessionId: number): Promise<BillView> =>
    api.get<BillView>(`/bill/${sessionId}`).then((r) => r.data),
  createAdjustment: (
    sessionId: number,
    payload: {
      type: "adjustment" | "discount";
      amount: number;
      reason: string;
      notes?: string;
      created_by?: string;
    },
  ): Promise<Consumption> =>
    api
      .post<Consumption>(`/bill/${sessionId}/adjustments`, payload)
      .then((r) => r.data),
  refundConsumption: (
    consumptionId: number,
    payload: { reason: string; notes?: string; created_by?: string },
  ): Promise<Consumption> =>
    api
      .post<Consumption>(`/consumptions/${consumptionId}/refund`, payload)
      .then((r) => r.data),
};

// ─── Products ─────────────────────────────────────────────────────────────────
export const productsApi = {
  getAll: (): Promise<Product[]> =>
    api.get<Product[]>("/products").then((r) => r.data),
};

// ─── Songs ────────────────────────────────────────────────────────────────────
export const songsApi = {
  getAll: (): Promise<Song[]> => api.get<Song[]>("/songs").then((r) => r.data),
};

// ─── Queue ────────────────────────────────────────────────────────────────────
export const queueApi = {
  getGlobal: (): Promise<QueueItem[]> =>
    api.get<QueueItem[]>("/queue/global").then((r) => r.data),
  getByTable: (tableId: number): Promise<QueueItem[]> =>
    api.get<QueueItem[]>(`/queue?table_id=${tableId}`).then((r) => r.data),
  getByTableWithHistory: (tableId: number): Promise<QueueItem[]> =>
    api
      .get<QueueItem[]>(`/queue?table_id=${tableId}&include_history=true`)
      .then((r) => r.data),
  getCurrent: (): Promise<QueueItem | null> =>
    api.get<QueueItem | null>("/queue/current").then((r) => r.data),
  addSong: (payload: {
    youtube_id: string;
    title: string;
    duration: number;
    table_id: number;
  }): Promise<QueueItem> =>
    api.post<QueueItem>("/queue", payload).then((r) => r.data),
  playNext: (): Promise<QueueItem | null> =>
    api.post<QueueItem | null>("/queue/play-next").then((r) => r.data),
  finishCurrent: (): Promise<QueueItem | null> =>
    api.post<QueueItem | null>("/queue/finish-current").then((r) => r.data),
  skip: (itemId: number): Promise<QueueItem> =>
    api.patch<QueueItem>(`/queue/${itemId}/skip`).then((r) => r.data),
  /** Atomic: finish current + start next in a single call */
  advanceToNext: (): Promise<QueueItem | null> =>
    api.post<QueueItem | null>("/queue/next").then((r) => r.data),
  /** Atomic: skip current + start next in a single call */
  skipAndAdvance: (): Promise<QueueItem | null> =>
    api.post<QueueItem | null>("/queue/skip-and-advance").then((r) => r.data),
  /** Admin: add song without restrictions, optionally at specific position */
  adminCreate: (payload: {
    youtube_id: string;
    title: string;
    duration: number;
    position?: number;
  }): Promise<QueueItem> =>
    api.post<QueueItem>("/queue/admin", payload).then((r) => r.data),
  /** Admin: interrupt current and play this song immediately */
  adminPlayNow: (payload: {
    youtube_id: string;
    title: string;
    duration: number;
  }): Promise<QueueItem> =>
    api.post<QueueItem>("/queue/admin/play-now", payload).then((r) => r.data),
  getStats: (): Promise<{
    songs_played_today: number;
    songs_skipped_today: number;
    songs_pending: number;
    total_songs_today: number;
    avg_wait_seconds: number | null;
    tables_participating: number;
    top_table: { table_id: number; count: number } | null;
  }> => api.get("/queue/stats").then((r) => r.data),
};

export const playbackApi = {
  getCurrent: (): Promise<PlaybackState> =>
    api.get<PlaybackState>("/playback/current").then((r) => r.data),
  /** Notify backend that the player started playing (buffering → playing) */
  setPlaying: (): Promise<PlaybackState> =>
    api.patch<PlaybackState>("/playback/playing").then((r) => r.data),
  /** Sync current playback position */
  updateProgress: (positionSeconds: number): Promise<PlaybackState> =>
    api
      .patch<PlaybackState>("/playback/progress", {
        position_seconds: positionSeconds,
      })
      .then((r) => r.data),
};

// ─── Music ────────────────────────────────────────────────────────────────────
export const musicApi = {
  search: (query: string): Promise<YouTubeSearchResult[]> =>
    api
      .get<
        YouTubeSearchResult[]
      >(`/music/search?q=${encodeURIComponent(query)}`)
      .then((r) => r.data),
};
