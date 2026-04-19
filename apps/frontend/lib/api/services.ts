import api from "./client";
import type {
  Table,
  QueueItem,
  Order,
  Product,
  Song,
  PlaybackState,
  YouTubeSearchResult,
} from "@coffee-bar/shared";

// ─── Tables ───────────────────────────────────────────────────────────────────
export const tablesApi = {
  getAll: (): Promise<Table[]> =>
    api.get<Table[]>("/tables").then((r) => r.data),
  getById: (id: number): Promise<Table> =>
    api.get<Table>(`/tables/${id}`).then((r) => r.data),
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

// ─── Orders ───────────────────────────────────────────────────────────────────
export const ordersApi = {
  getAll: (): Promise<Order[]> =>
    api.get<Order[]>("/orders").then((r) => r.data),
  getByTable: (tableId: number): Promise<Order[]> =>
    api.get<Order[]>(`/orders?table_id=${tableId}`).then((r) => r.data),
  create: (payload: {
    table_id: number;
    items: { product_id: number; quantity: number }[];
  }): Promise<Order> => api.post<Order>("/orders", payload).then((r) => r.data),
  updateStatus: (orderId: number, status: Order["status"]): Promise<Order> =>
    api
      .patch<Order>(`/orders/${orderId}/status`, { status })
      .then((r) => r.data),
};

// ─── Products ─────────────────────────────────────────────────────────────────
export const productsApi = {
  getAll: (): Promise<Product[]> =>
    api.get<Product[]>("/products").then((r) => r.data),
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
