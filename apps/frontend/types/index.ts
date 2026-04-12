// ─── Enums ────────────────────────────────────────────────────────────────────
export type TableStatus = "active" | "inactive" | "closed";
export type QueueStatus = "pending" | "playing" | "played";
export type OrderStatus = "pending" | "preparing" | "delivered" | "cancelled";

// ─── Tables ───────────────────────────────────────────────────────────────────
export interface Table {
  id: number;
  qr_code: string;
  status: TableStatus;
  total_consumption: number;
  created_at: string;
}

// ─── Music ────────────────────────────────────────────────────────────────────
export interface Song {
  id: number;
  youtube_id: string;
  title: string;
  duration: number;
  requested_by_table: number;
  created_at: string;
}

export interface QueueItem {
  id: number;
  song_id: number;
  table_id: number;
  priority_score: number;
  status: QueueStatus;
  position: number;
}

// ─── Orders ───────────────────────────────────────────────────────────────────
export interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  category: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
}

export interface Order {
  id: number;
  table_id: number;
  status: OrderStatus;
  total: number;
  created_at: string;
}

// ─── YouTube search ───────────────────────────────────────────────────────────
export interface YouTubeSearchResult {
  youtubeId: string;
  title: string;
  duration: string;
}

// ─── Socket events ────────────────────────────────────────────────────────────
export type SocketEvents = {
  "queue:updated": QueueItem[];
  "table:updated": Table;
  "order:updated": Order;
  "song:request": {
    youtube_id: string;
    title: string;
    duration: number;
    table_id: number;
  };
  "table:join": number;
};