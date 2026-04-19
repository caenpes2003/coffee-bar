export type TableStatus = "available" | "active" | "occupied" | "inactive";

export interface TableCountSummary {
  orders: number;
  queue_items: number;
  songs: number;
}

export interface Table {
  id: number;
  qr_code: string;
  status: TableStatus;
  total_consumption: number;
  created_at: string;
  updated_at: string;
  songs?: Song[];
  queue_items?: QueueItem[];
  orders?: Order[];
  _count?: TableCountSummary;
}

export interface Song {
  id: number;
  youtube_id: string;
  title: string;
  duration: number;
  requested_by_table: number | null;
  created_at: string;
}

export interface YouTubeSearchResult {
  youtubeId: string;
  title: string;
  duration: number;
  thumbnail?: string;
}

export type QueueStatus = "pending" | "playing" | "played" | "skipped";

export type PlaybackStatus = "idle" | "buffering" | "playing" | "paused";

export interface QueueItem {
  id: number;
  song_id: number;
  table_id: number | null;
  priority_score: number;
  status: QueueStatus;
  position: number;
  queued_at: string;
  created_at: string;
  updated_at: string;
  started_playing_at: string | null;
  finished_at: string | null;
  skipped_at: string | null;
  song?: Song;
  table?: Table;
}

export interface PlaybackState {
  status: PlaybackStatus;
  queue_item_id: number | null;
  song: Song | null;
  table_id: number | null;
  started_at: string | null;
  updated_at: string | null;
  position_seconds: number | null;
}

export interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  category: string;
  created_at: string;
  updated_at: string;
}

export type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  created_at: string;
  unit_price?: number;
  product?: Product;
}

export interface Order {
  id: number;
  table_id: number;
  status: OrderStatus;
  total: number;
  created_at: string;
  updated_at: string;
  order_items?: OrderItem[];
}
