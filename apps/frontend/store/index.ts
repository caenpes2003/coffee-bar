import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  OrderRequest,
  Order,
  PlaybackState,
  Product,
  QueueItem,
  Table,
} from "@coffee-bar/shared";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AppStore {
  // Tables
  currentTable: Table | null;
  allTables: Table[];
  setCurrentTable: (table: Table) => void;
  updateTable: (table: Table) => void;
  setAllTables: (tables: Table[]) => void;

  // Queue
  queue: QueueItem[];
  currentPlayback: PlaybackState | null;
  setQueue: (queue: QueueItem[]) => void;
  updateFromSocket: (queue: QueueItem[]) => void;
  setCurrentPlayback: (playback: PlaybackState | null) => void;

  // Orders
  orders: Order[];
  setOrders: (orders: Order[]) => void;
  upsertOrder: (order: Order) => void;

  // Order Requests (admin queue of pending requests + their transitions)
  orderRequests: OrderRequest[];
  setOrderRequests: (requests: OrderRequest[]) => void;
  upsertOrderRequest: (request: OrderRequest) => void;

  // Products
  products: Product[];
  setProducts: (products: Product[]) => void;

  // My songs (includes history)
  mySongs: QueueItem[];
  setMySongs: (songs: QueueItem[]) => void;

  // UI
  isSearchOpen: boolean;
  activeTab: "cola" | "canciones" | "pedidos";
  setSearchOpen: (open: boolean) => void;
  setActiveTab: (tab: "cola" | "canciones" | "pedidos") => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const useAppStore = create<AppStore>()(
  devtools(
    (set) => ({
      // Tables
      currentTable: null,
      allTables: [],
      setCurrentTable: (table) =>
        set({ currentTable: table }, false, "setCurrentTable"),
      updateTable: (table) =>
        set(
          (state) => ({
            currentTable:
              state.currentTable?.id === table.id ? table : state.currentTable,
            allTables: state.allTables.map((t) =>
              t.id === table.id ? table : t,
            ),
          }),
          false,
          "updateTable",
        ),
      setAllTables: (tables) =>
        set({ allTables: tables }, false, "setAllTables"),

      // Queue
      queue: [],
      currentPlayback: null,
      setQueue: (queue) => set({ queue }, false, "setQueue"),
      updateFromSocket: (queue) =>
        set({ queue }, false, "socket:queueUpdated"),
      setCurrentPlayback: (playback) =>
        set({ currentPlayback: playback }, false, "setCurrentPlayback"),

      // Orders
      orders: [],
      setOrders: (orders) => set({ orders }, false, "setOrders"),
      upsertOrder: (order) =>
        set(
          (state) => {
            const exists = state.orders.find((o) => o.id === order.id);
            return {
              orders: exists
                ? state.orders.map((o) => (o.id === order.id ? order : o))
                : [order, ...state.orders],
            };
          },
          false,
          "upsertOrder",
        ),

      // Order Requests
      orderRequests: [],
      setOrderRequests: (orderRequests) =>
        set({ orderRequests }, false, "setOrderRequests"),
      upsertOrderRequest: (request) =>
        set(
          (state) => {
            const exists = state.orderRequests.find((r) => r.id === request.id);
            return {
              orderRequests: exists
                ? state.orderRequests.map((r) =>
                    r.id === request.id ? request : r,
                  )
                : [request, ...state.orderRequests],
            };
          },
          false,
          "upsertOrderRequest",
        ),

      // Products
      products: [],
      setProducts: (products) => set({ products }, false, "setProducts"),

      // My songs
      mySongs: [],
      setMySongs: (songs) => set({ mySongs: songs }, false, "setMySongs"),

      // UI
      isSearchOpen: false,
      activeTab: "cola",
      setSearchOpen: (open) =>
        set({ isSearchOpen: open }, false, "setSearchOpen"),
      setActiveTab: (tab) => set({ activeTab: tab }, false, "setActiveTab"),
    }),
    { name: "CoffeeBarStore" },
  ),
);

// ─── Selectores ───────────────────────────────────────────────────────────────
export const selectCurrentPlayback = (s: AppStore) => s.currentPlayback;
export const selectPendingQueue = (s: AppStore) =>
  s.queue.filter((q) => q.status === "pending");
export const selectMyQueueCount = (tableId: number) => (s: AppStore) =>
  s.queue.filter(
    (q) =>
      q.table_id === tableId &&
      (q.status === "pending" || q.status === "playing"),
  ).length;
export const selectSessionOrders = (sessionId: number) => (s: AppStore) =>
  s.orders.filter((o) => o.table_session_id === sessionId);
