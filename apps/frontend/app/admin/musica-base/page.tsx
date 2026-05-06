"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  housePlaylistApi,
  musicApi,
  type HousePlaylistCategory,
  type HousePlaylistItem,
  type HousePlaylistValidation,
  type MusicBudgetSnapshot,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  btnPrimary,
  btnGhost,
  BUTTON_STYLES,
  pad,
  secToMin,
  timeAgo,
} from "@/lib/theme";

interface Toast {
  id: number;
  tone: "olive" | "terracotta";
  message: string;
}

/**
 * Página dedicada para curar la playlist base del bar — esa lista de
 * canciones que se reproducen automáticamente cuando ninguna mesa está
 * agregando música. Mantiene el mismo lenguaje visual que /admin/products
 * (header bebas + monospaced eyebrow + tablas premium en cream/sand).
 *
 * Flujo principal:
 *   1. Admin pega URL de YouTube en el input.
 *   2. Al perder foco (o tras 600ms de pausa al tipear) el front llama a
 *      /house-playlist/validate. Si la API devuelve metadata → preview.
 *   3. Botón "Agregar" envía POST /house-playlist (el backend re-valida).
 *   4. Lista se refresca, input se limpia, toast "Canción agregada".
 *
 * No hay drag-and-drop de reordenamiento. Para 8–20 canciones el orden
 * se gestiona con el `sort_order` que asigna el backend al crear (la nueva
 * va al final). Si llegamos a 30+ items, se agrega DnD en otra iteración.
 */
export default function HousePlaylistPage() {
  const [items, setItems] = useState<HousePlaylistItem[]>([]);
  const [categories, setCategories] = useState<HousePlaylistCategory[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(
    null,
  );
  const [filterCategoryId, setFilterCategoryId] = useState<number | "all">(
    "all",
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, tone, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [itemsData, catsData, activeData] = await Promise.all([
        housePlaylistApi.list(),
        housePlaylistApi.listCategories(),
        housePlaylistApi.getActiveCategory(),
      ]);
      setItems(itemsData);
      setCategories(catsData);
      setActiveCategoryId(activeData.active_category_id);
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Items visible after the category filter chip. "all" means show
  // everything; a numeric id means only items that include that category.
  const visibleItems = useMemo(() => {
    if (filterCategoryId === "all") return items;
    return items.filter((it) =>
      (it.categories ?? []).some((c) => c.id === filterCategoryId),
    );
  }, [items, filterCategoryId]);

  return (
    <>
      <style>{BUTTON_STYLES}</style>
      <main
        style={{
          minHeight: "100dvh",
          background: C.cream,
          color: C.ink,
          fontFamily: FONT_UI,
          padding: "20px 24px 40px",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 3,
                color: C.mute,
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              — Crown Bar 4.90 · Música
            </span>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 26,
                color: C.ink,
                letterSpacing: 4,
                margin: "2px 0 0",
                textTransform: "uppercase",
              }}
            >
              Playlist base del bar
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 12,
                color: C.cacao,
                fontFamily: FONT_MONO,
                letterSpacing: 0.6,
                lineHeight: 1.5,
                maxWidth: 560,
              }}
            >
              Estas canciones suenan automáticamente cuando ninguna mesa tiene
              música en cola. No aparecen en la cola pública y rotan
              eligiendo la que hace más tiempo no se reproduce.
            </p>
          </div>
          <Link
            href="/admin"
            className="crown-btn crown-btn-ghost"
            style={{
              ...btnGhost({ fg: C.cacao, border: C.sand }),
              textDecoration: "none",
            }}
          >
            ← Tablero
          </Link>
        </header>

        <BudgetWidget />

        <CategoryPanel
          categories={categories}
          activeCategoryId={activeCategoryId}
          itemCounts={items}
          onCategoryCreated={(c) => {
            setCategories((prev) => [...prev, c].sort((a, b) =>
              a.name.localeCompare(b.name),
            ));
            pushToast("olive", `Categoría "${c.name}" creada`);
          }}
          onCategoryRenamed={(c) => {
            setCategories((prev) =>
              prev.map((p) => (p.id === c.id ? c : p)).sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            );
          }}
          onCategoryDeleted={(id) => {
            setCategories((prev) => prev.filter((c) => c.id !== id));
            if (filterCategoryId === id) setFilterCategoryId("all");
            if (activeCategoryId === id) setActiveCategoryId(null);
            // Items still hold the (now stale) category reference until
            // we refresh — the M2M cascade clears it server-side, so a
            // round-trip syncs everything.
            refresh();
          }}
          onActiveChanged={(id) => {
            setActiveCategoryId(id);
            const name = id
              ? categories.find((c) => c.id === id)?.name ?? "categoría"
              : null;
            pushToast(
              "olive",
              name
                ? `Sonando: ${name}`
                : "Categoría activa desactivada",
            );
          }}
          onError={(msg) => pushToast("terracotta", msg)}
        />

        <AddSongCard
          onAdded={(item) => {
            setItems((prev) => [...prev, item]);
            pushToast("olive", `“${item.title}” agregada a la base`);
          }}
          onError={(msg) => pushToast("terracotta", msg)}
        />

        <section style={{ marginTop: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 3,
                color: C.mute,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              — Catálogo ({visibleItems.length}
              {filterCategoryId === "all" ? "" : ` de ${items.length}`})
            </div>
            {categories.length > 0 && (
              <CategoryFilter
                categories={categories}
                items={items}
                value={filterCategoryId}
                onChange={setFilterCategoryId}
              />
            )}
          </div>

          {loading && (
            <p style={emptyStateStyle}>Cargando…</p>
          )}

          {loadError && !loading && (
            <p style={{ ...emptyStateStyle, color: C.terracotta }}>
              {loadError}
            </p>
          )}

          {!loading && !loadError && items.length === 0 && (
            <p style={emptyStateStyle}>
              Aún no has agregado canciones. Pega una URL de YouTube arriba.
            </p>
          )}

          {!loading && items.length > 0 && visibleItems.length === 0 && (
            <p style={emptyStateStyle}>
              Sin canciones en esta categoría. Asigna alguna desde la lista.
            </p>
          )}

          {!loading && visibleItems.length > 0 && (
            <PlaylistTable
              items={visibleItems}
              categories={categories}
              onMutate={(updater) => setItems(updater)}
              onMessage={pushToast}
            />
          )}
        </section>
      </main>

      <ToastStack toasts={toasts} />
    </>
  );
}

// ─── Budget widget ───────────────────────────────────────────────────────────

// ─── Category panel ──────────────────────────────────────────────────────────

function CategoryPanel({
  categories,
  activeCategoryId,
  itemCounts,
  onCategoryCreated,
  onCategoryRenamed,
  onCategoryDeleted,
  onActiveChanged,
  onError,
}: {
  categories: HousePlaylistCategory[];
  activeCategoryId: number | null;
  itemCounts: HousePlaylistItem[];
  onCategoryCreated: (c: HousePlaylistCategory) => void;
  onCategoryRenamed: (c: HousePlaylistCategory) => void;
  onCategoryDeleted: (id: number) => void;
  onActiveChanged: (id: number | null) => void;
  onError: (msg: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<HousePlaylistCategory | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Active songs per category — used to disable the "Activar" button on
  // empty categories (the backend would reject anyway, but disabling is
  // friendlier than waiting for a 400).
  const activeCountByCategory = useMemo(() => {
    const m = new Map<number, number>();
    for (const it of itemCounts) {
      if (!it.is_active) continue;
      for (const c of it.categories ?? []) {
        m.set(c.id, (m.get(c.id) ?? 0) + 1);
      }
    }
    return m;
  }, [itemCounts]);

  const create = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const c = await housePlaylistApi.createCategory(trimmed);
      onCategoryCreated(c);
      setNewName("");
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const setActive = async (id: number | null) => {
    setBusyId(id ?? -1);
    try {
      const res = await housePlaylistApi.setActiveCategory(id);
      onActiveChanged(res.active_category_id);
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c: HousePlaylistCategory) => {
    if (!window.confirm(`¿Eliminar "${c.name}"? Las canciones quedan, solo se quita el tag.`))
      return;
    setBusyId(c.id);
    try {
      await housePlaylistApi.deleteCategory(c.id);
      onCategoryDeleted(c.id);
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const submitRename = async () => {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renaming.name) {
      setRenaming(null);
      return;
    }
    setBusyId(renaming.id);
    try {
      const updated = await housePlaylistApi.renameCategory(
        renaming.id,
        trimmed,
      );
      onCategoryRenamed(updated);
      setRenaming(null);
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      style={{
        marginTop: 16,
        padding: "16px 18px",
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxShadow:
          "0 1px 0 rgba(43,29,20,0.04), 0 8px 22px -16px rgba(107,78,46,0.28)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 3,
              color: C.mute,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            — Categorías
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 18,
              color: C.ink,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            Mix · Vallenato · Rock · etc.
          </div>
        </div>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.mute,
            letterSpacing: 0.5,
          }}
        >
          La activa marca cuál suena entre canciones de cliente
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder="Nombre de la categoría"
          style={{
            flex: 1,
            minWidth: 200,
            padding: "10px 12px",
            border: `1px solid ${C.sand}`,
            borderRadius: 10,
            background: C.cream,
            color: C.ink,
            fontFamily: FONT_UI,
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="button"
          className="crown-btn crown-btn-primary"
          onClick={create}
          disabled={!newName.trim() || creating}
          style={btnPrimary({
            bg: !newName.trim() || creating ? C.sand : C.olive,
            fg: !newName.trim() || creating ? C.mute : C.paper,
          })}
        >
          {creating ? "Creando…" : "Crear"}
        </button>
      </div>

      {categories.length === 0 ? (
        <p
          style={{
            margin: 0,
            padding: "12px 14px",
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.mute,
            background: C.cream,
            border: `1px dashed ${C.sand}`,
            borderRadius: 10,
            textAlign: "center",
          }}
        >
          Aún no hay categorías. Crea una para empezar a clasificar las
          canciones de la base.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {categories.map((c) => {
            const isActive = activeCategoryId === c.id;
            const itemCount = activeCountByCategory.get(c.id) ?? 0;
            const canActivate = itemCount > 0;
            const isRenaming = renaming?.id === c.id;
            return (
              <li
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: `1px solid ${isActive ? C.olive : C.sand}`,
                  background: isActive ? `${C.olive}10` : C.cream,
                  borderRadius: 10,
                }}
              >
                {isRenaming ? (
                  <input
                    type="text"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={submitRename}
                    style={{
                      flex: 1,
                      padding: "6px 10px",
                      border: `1px solid ${C.gold}`,
                      borderRadius: 8,
                      background: C.paper,
                      color: C.ink,
                      fontFamily: FONT_UI,
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(c);
                      setRenameValue(c.name);
                    }}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontFamily: FONT_UI,
                      fontSize: 14,
                      color: C.ink,
                      fontWeight: 600,
                    }}
                  >
                    {c.name}
                    <span
                      style={{
                        marginLeft: 8,
                        fontFamily: FONT_MONO,
                        fontSize: 10,
                        color: C.mute,
                        fontWeight: 400,
                        letterSpacing: 0.5,
                      }}
                    >
                      {itemCount} canc.
                    </span>
                  </button>
                )}
                {isActive ? (
                  <button
                    type="button"
                    onClick={() => setActive(null)}
                    disabled={busyId === c.id}
                    className="crown-btn crown-btn-ghost"
                    style={{
                      ...btnGhost({ fg: C.olive, border: C.olive }),
                      fontSize: 10,
                      padding: "4px 10px",
                      letterSpacing: 1,
                    }}
                  >
                    SONANDO ✓
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActive(c.id)}
                    disabled={!canActivate || busyId === c.id}
                    className="crown-btn crown-btn-ghost"
                    style={{
                      ...btnGhost({
                        fg: canActivate ? C.cacao : C.mute,
                        border: C.sand,
                      }),
                      fontSize: 10,
                      padding: "4px 10px",
                      letterSpacing: 1,
                      opacity: canActivate ? 1 : 0.55,
                    }}
                    title={
                      canActivate
                        ? "Activar esta categoría"
                        : "Sin canciones activas en esta categoría"
                    }
                  >
                    Activar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(c)}
                  disabled={busyId === c.id}
                  className="crown-btn crown-btn-ghost"
                  style={{
                    ...btnGhost({ fg: C.terracotta, border: C.sand }),
                    fontSize: 11,
                    padding: "4px 8px",
                  }}
                  title="Eliminar categoría"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Category filter chips ───────────────────────────────────────────────────

function CategoryFilter({
  categories,
  items,
  value,
  onChange,
}: {
  categories: HousePlaylistCategory[];
  items: HousePlaylistItem[];
  value: number | "all";
  onChange: (v: number | "all") => void;
}) {
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const it of items) {
      for (const c of it.categories ?? []) {
        m.set(c.id, (m.get(c.id) ?? 0) + 1);
      }
    }
    return m;
  }, [items]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <FilterChip
        label="Todas"
        count={items.length}
        active={value === "all"}
        onClick={() => onChange("all")}
      />
      {categories.map((c) => (
        <FilterChip
          key={c.id}
          label={c.name}
          count={counts.get(c.id) ?? 0}
          active={value === c.id}
          onClick={() => onChange(c.id)}
        />
      ))}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 10px",
        border: `1px solid ${active ? C.ink : C.sand}`,
        background: active ? C.ink : C.paper,
        color: active ? C.paper : C.cacao,
        borderRadius: 999,
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 1.2,
        fontWeight: 700,
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
      <span
        style={{
          marginLeft: 6,
          padding: "0 6px",
          background: active ? `${C.paper}26` : C.cream,
          color: active ? C.paper : C.mute,
          borderRadius: 999,
          fontSize: 9,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function BudgetWidget() {
  const [snapshot, setSnapshot] = useState<MusicBudgetSnapshot | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await musicApi.getBudget();
        if (!cancelled) setSnapshot(res.snapshot);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      }
    };
    load();
    // Refresh every 30s while the page is open. The numbers move slowly
    // on a normal day, so this is plenty.
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Hide silently while we're still loading, on errors, or on ytsr-only
  // deploys where there's no quota to track.
  if (!snapshot) return null;

  return (
    <section
      style={{
        marginTop: 16,
        padding: "14px 18px",
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow:
          "0 1px 0 rgba(43,29,20,0.04), 0 8px 22px -16px rgba(107,78,46,0.28)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 3,
              color: C.mute,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            — Cuota YouTube API
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 18,
              color: C.ink,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            Estado de las llaves
          </div>
        </div>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.mute,
            letterSpacing: 0.5,
          }}
        >
          Reinicia con cada deploy · auditoría real en Google Cloud
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 8,
        }}
      >
        {snapshot.slots.map((slot) => {
          const pct = slot.limit > 0 ? slot.used / slot.limit : 0;
          const tone =
            pct > 0.85 ? C.terracotta : pct > 0.6 ? C.gold : C.olive;
          return (
            <div
              key={slot.slot}
              style={{
                padding: "10px 12px",
                border: `1px solid ${C.sand}`,
                borderRadius: 10,
                background: C.cream,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: 1.5,
                    color: C.cacao,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Llave #{slot.slot}
                </span>
                <span
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 14,
                    color: tone,
                    letterSpacing: 0.5,
                  }}
                >
                  {slot.used} / {slot.limit}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: C.sand,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, pct * 100)}%`,
                    height: "100%",
                    background: tone,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.mute,
                  letterSpacing: 0.5,
                }}
              >
                {slot.remaining.toLocaleString()} unidades disponibles
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Add card ────────────────────────────────────────────────────────────────

function AddSongCard({
  onAdded,
  onError,
}: {
  onAdded: (item: HousePlaylistItem) => void;
  onError: (msg: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [validating, setValidating] = useState(false);
  const [preview, setPreview] = useState<
    Extract<HousePlaylistValidation, { valid: true }> | null
  >(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>("");

  // Debounced validation: fires 500ms after the input settles. Cancels an
  // in-flight request if the URL changes before it returns by checking
  // `lastQueryRef.current` after the await.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = url.trim();
    if (!trimmed) {
      setPreview(null);
      setPreviewError(null);
      setValidating(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void validate(trimmed);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function validate(query: string) {
    lastQueryRef.current = query;
    setValidating(true);
    setPreviewError(null);
    try {
      const res = await housePlaylistApi.validate(query);
      // Stale response: the input changed while we were awaiting.
      if (lastQueryRef.current !== query) return;
      if (res.valid) {
        setPreview(res);
      } else {
        setPreview(null);
        setPreviewError(res.reason);
      }
    } catch (err) {
      if (lastQueryRef.current !== query) return;
      setPreview(null);
      setPreviewError(getErrorMessage(err));
    } finally {
      if (lastQueryRef.current === query) setValidating(false);
    }
  }

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    try {
      const res = await housePlaylistApi.create(url.trim());
      if (res.ok) {
        onAdded(res.item);
        setUrl("");
        setPreview(null);
        setPreviewError(null);
      } else {
        onError(res.message ?? "No se pudo agregar la canción");
      }
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      style={{
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 16,
        padding: "20px 22px",
        boxShadow:
          "0 1px 0 rgba(43,29,20,0.04), 0 12px 32px -18px rgba(107,78,46,0.28)",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 3,
          color: C.mute,
          fontWeight: 700,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        — Agregar canción
      </div>
      <h2
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 18,
          color: C.ink,
          letterSpacing: 2,
          margin: "0 0 14px",
          textTransform: "uppercase",
        }}
      >
        Pega una URL de YouTube
      </h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 240,
            padding: "12px 14px",
            border: `1px solid ${C.sand}`,
            borderRadius: 10,
            background: C.cream,
            color: C.ink,
            fontFamily: FONT_UI,
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="button"
          className="crown-btn crown-btn-primary"
          onClick={submit}
          disabled={!preview || submitting}
          style={btnPrimary({
            bg: !preview || submitting ? C.sand : C.olive,
            fg: !preview || submitting ? C.mute : C.paper,
          })}
        >
          {submitting ? "Agregando..." : "Agregar"}
        </button>
      </div>

      <div style={{ marginTop: 14, minHeight: 60 }}>
        {validating && (
          <p
            style={{
              margin: 0,
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.mute,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Validando con YouTube…
          </p>
        )}
        {!validating && previewError && (
          <p
            style={{
              margin: 0,
              padding: "10px 12px",
              border: `1px solid ${C.terracotta}33`,
              background: `${C.terracotta}11`,
              color: C.terracotta,
              borderRadius: 10,
              fontFamily: FONT_MONO,
              fontSize: 12,
              letterSpacing: 0.5,
            }}
          >
            {previewError}
          </p>
        )}
        {!validating && preview && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              border: `1px solid ${C.olive}55`,
              background: `${C.olive}0e`,
              borderRadius: 10,
            }}
          >
            {preview.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.thumbnail}
                alt=""
                width={88}
                height={66}
                style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: C.ink,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {preview.title}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.cacao,
                  marginTop: 4,
                  letterSpacing: 0.5,
                }}
              >
                {preview.artist ? `${preview.artist} · ` : ""}
                {secToMin(preview.duration)}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

function PlaylistTable({
  items,
  categories,
  onMutate,
  onMessage,
}: {
  items: HousePlaylistItem[];
  categories: HousePlaylistCategory[];
  onMutate: (updater: (prev: HousePlaylistItem[]) => HousePlaylistItem[]) => void;
  onMessage: (tone: "olive" | "terracotta", msg: string) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<HousePlaylistItem | null>(
    null,
  );
  const [editCats, setEditCats] = useState<HousePlaylistItem | null>(null);

  async function toggleActive(item: HousePlaylistItem) {
    setBusyId(item.id);
    try {
      const updated = await housePlaylistApi.update(item.id, {
        is_active: !item.is_active,
      });
      onMutate((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)),
      );
    } catch (err) {
      onMessage("terracotta", getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function performDelete(item: HousePlaylistItem) {
    setBusyId(item.id);
    try {
      await housePlaylistApi.remove(item.id);
      onMutate((prev) => prev.filter((i) => i.id !== item.id));
      onMessage("olive", `“${item.title}” eliminada`);
    } catch (err) {
      onMessage("terracotta", getErrorMessage(err));
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  }

  return (
    <>
      <div
        style={{
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "44px 1fr 110px 110px 96px 110px",
            gap: 0,
            background: C.parchment,
            padding: "10px 14px",
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
            fontWeight: 700,
            borderBottom: `1px solid ${C.sand}`,
          }}
        >
          <span>#</span>
          <span>Canción</span>
          <span style={{ textAlign: "right" }}>Duración</span>
          <span style={{ textAlign: "right" }}>Última vez</span>
          <span style={{ textAlign: "center" }}>Estado</span>
          <span style={{ textAlign: "right" }}>Acciones</span>
        </div>

        {items.map((item, i) => (
          <div
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr 110px 110px 96px 110px",
              alignItems: "center",
              padding: "12px 14px",
              borderBottom:
                i === items.length - 1 ? "none" : `1px solid ${C.sand}`,
              opacity: item.is_active ? 1 : 0.55,
              transition: "opacity 0.18s ease",
            }}
          >
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 14,
                color: C.mute,
                letterSpacing: 0.5,
              }}
            >
              {pad(i + 1)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: C.ink,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.mute,
                  letterSpacing: 0.4,
                  marginTop: 2,
                }}
              >
                {item.artist ?? item.youtube_id}
              </div>
              {item.categories && item.categories.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginTop: 6,
                  }}
                >
                  {item.categories.map((c) => (
                    <span
                      key={c.id}
                      style={{
                        padding: "1px 8px",
                        background: `${C.gold}11`,
                        border: `1px solid ${C.gold}33`,
                        color: C.cacao,
                        borderRadius: 999,
                        fontFamily: FONT_MONO,
                        fontSize: 9,
                        letterSpacing: 0.5,
                        fontWeight: 700,
                      }}
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: C.cacao,
                textAlign: "right",
                letterSpacing: 0.5,
              }}
            >
              {secToMin(item.duration)}
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.mute,
                textAlign: "right",
                letterSpacing: 0.5,
              }}
            >
              {item.last_played_at ? timeAgo(item.last_played_at) : "Nunca"}
            </span>
            <div style={{ textAlign: "center" }}>
              <button
                type="button"
                onClick={() => toggleActive(item)}
                disabled={busyId === item.id}
                className="crown-btn crown-btn-ghost"
                style={{
                  ...btnGhost({
                    fg: item.is_active ? C.olive : C.mute,
                    border: item.is_active ? C.olive : C.sand,
                  }),
                  fontSize: 10,
                  letterSpacing: 1.5,
                  padding: "4px 10px",
                }}
              >
                {item.is_active ? "Activa" : "Inactiva"}
              </button>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
              }}
            >
              <button
                type="button"
                onClick={() => setEditCats(item)}
                disabled={busyId === item.id || categories.length === 0}
                className="crown-btn crown-btn-ghost"
                style={{
                  ...btnGhost({ fg: C.cacao, border: C.sand }),
                  fontSize: 11,
                  padding: "4px 8px",
                  opacity: categories.length === 0 ? 0.4 : 1,
                }}
                title={
                  categories.length === 0
                    ? "Crea una categoría primero"
                    : "Asignar categorías"
                }
              >
                ⚑
              </button>
              <a
                href={`https://www.youtube.com/watch?v=${item.youtube_id}`}
                target="_blank"
                rel="noreferrer"
                className="crown-btn crown-btn-ghost"
                style={{
                  ...btnGhost({ fg: C.mute, border: C.sand }),
                  textDecoration: "none",
                  fontSize: 11,
                  padding: "4px 8px",
                }}
                title="Ver en YouTube"
              >
                ↗
              </a>
              <button
                type="button"
                onClick={() => setConfirmDelete(item)}
                disabled={busyId === item.id}
                className="crown-btn crown-btn-ghost"
                style={{
                  ...btnGhost({ fg: C.terracotta, border: C.sand }),
                  fontSize: 11,
                  padding: "4px 8px",
                }}
                title="Eliminar"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDelete
          item={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => performDelete(confirmDelete)}
        />
      )}

      {editCats && (
        <CategoryAssignModal
          item={editCats}
          categories={categories}
          onClose={() => setEditCats(null)}
          onSaved={(updated) => {
            onMutate((prev) =>
              prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)),
            );
            onMessage("olive", "Categorías actualizadas");
            setEditCats(null);
          }}
          onError={(msg) => onMessage("terracotta", msg)}
        />
      )}
    </>
  );
}

// ─── Category assign modal ───────────────────────────────────────────────────

function CategoryAssignModal({
  item,
  categories,
  onClose,
  onSaved,
  onError,
}: {
  item: HousePlaylistItem;
  categories: HousePlaylistCategory[];
  onClose: () => void;
  onSaved: (updated: HousePlaylistItem) => void;
  onError: (msg: string) => void;
}) {
  const initial = useMemo(
    () => new Set((item.categories ?? []).map((c) => c.id)),
    [item],
  );
  const [selected, setSelected] = useState<Set<number>>(initial);
  const [saving, setSaving] = useState(false);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await housePlaylistApi.setItemCategories(
        item.id,
        Array.from(selected),
      );
      onSaved(updated);
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Asignar categorías"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.gold,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Categorías
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 20,
              color: C.ink,
              letterSpacing: 1.5,
              margin: "4px 0 0",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.title}
          </h3>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {categories.map((c) => {
            const checked = selected.has(c.id);
            return (
              <label
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: `1px solid ${checked ? C.gold : C.sand}`,
                  background: checked ? `${C.gold}10` : C.cream,
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: C.ink,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(c.id)}
                  style={{ accentColor: C.gold, width: 16, height: 16 }}
                />
                {c.name}
              </label>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="crown-btn crown-btn-ghost"
            style={btnGhost({ fg: C.cacao, border: C.sand })}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="crown-btn crown-btn-primary"
            style={btnPrimary({ bg: C.olive, fg: C.paper })}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDelete({
  item,
  onCancel,
  onConfirm,
}: {
  item: HousePlaylistItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Eliminar canción"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 400,
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.terracotta,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Eliminar
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              color: C.ink,
              letterSpacing: 1.5,
              margin: "4px 0 0",
              textTransform: "uppercase",
            }}
          >
            ¿Quitar esta canción?
          </h3>
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: FONT_UI,
            fontSize: 14,
            color: C.cacao,
            lineHeight: 1.5,
          }}
        >
          “{item.title}” saldrá de la playlist base. Las próximas veces que
          el bar quede sin música no la elegirá.
        </p>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="crown-btn crown-btn-ghost"
            style={btnGhost({ fg: C.cacao, border: C.sand })}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="crown-btn crown-btn-primary"
            style={btnPrimary({ bg: C.terracotta, fg: C.paper })}
          >
            Sí, eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        top: 18,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: t.tone === "olive" ? C.olive : C.terracotta,
            color: C.paper,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            padding: "10px 16px",
            borderRadius: 999,
            boxShadow: "0 10px 30px -10px rgba(43,29,20,0.45)",
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

const emptyStateStyle: React.CSSProperties = {
  margin: 0,
  padding: "32px 18px",
  textAlign: "center",
  fontFamily: FONT_MONO,
  fontSize: 12,
  color: C.mute,
  letterSpacing: 1,
  background: C.paper,
  border: `1px dashed ${C.sand}`,
  borderRadius: 12,
};
