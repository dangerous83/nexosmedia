"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import type { Media, MediaPage } from "./types";

/*
 * Client data layer.
 *  - useQuery(key): small cached JSON queries (summary counts, folders).
 *  - useMediaList(params): paged media with progressive loading.
 * Any mutation calls invalidateMedia(); every mounted query and list then refetches in the
 * background, keeping what's on screen until fresh data lands.
 */

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const getVersion = () => version;
const emit = () => { version++; listeners.forEach((l) => l()); };

type Entry = { data?: unknown; error?: Error; promise?: Promise<void>; stale: boolean };
const cache = new Map<string, Entry>();

function load(key: string) {
  const entry = cache.get(key) ?? { stale: true };
  if (entry.promise) return entry.promise;
  entry.promise = api(key)
    .then((data) => { entry.data = data; entry.error = undefined; })
    .catch((e: Error) => { entry.error = e; })
    .finally(() => { entry.promise = undefined; entry.stale = false; emit(); });
  cache.set(key, entry);
  return entry.promise;
}

export function useQuery<T>(key: string | null) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const entry = key ? cache.get(key) : undefined;
  useEffect(() => {
    if (key && (!entry || entry.stale) && !entry?.promise) load(key);
  });
  return { data: entry?.data as T | undefined, error: entry?.error, reload: () => key && load(key) };
}

/** Marks everything stale; mounted queries and media lists refetch. */
export function invalidateMedia() {
  for (const e of cache.values()) e.stale = true;
  emit();
}

type State = { base: string; items: Media[]; total: number; next: number | null; loading: boolean; loaded: boolean; error?: Error };

export function useMediaList(params: Record<string, string | undefined | null>, pageSize = 60) {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  const qs = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) if (val) qs.set(k, val);
  const base = `/api/media?${qs.toString()}`;
  const [state, setState] = useState<State>({ base, items: [], total: 0, next: null, loading: true, loaded: false });
  const loadedCount = useRef(0);
  const reqId = useRef(0);
  const lastBase = useRef<string | null>(null);
  const lastVersion = useRef(-1);

  const fetchWindow = useCallback(async (limit: number, reset: boolean) => {
    const id = ++reqId.current;
    setState((s) => (reset ? { base, items: [], total: 0, next: null, loading: true, loaded: false } : { ...s, loading: true }));
    try {
      const page = await api<MediaPage>(`${base}&cursor=0&limit=${limit}`);
      if (id !== reqId.current) return;
      loadedCount.current = page.items.length;
      setState({ base, items: page.items, total: page.total, next: page.nextCursor, loading: false, loaded: true });
    } catch (e) {
      if (id === reqId.current) setState((s) => ({ ...s, base, loading: false, loaded: true, error: e as Error }));
    }
  }, [base]);

  useEffect(() => {
    const reset = lastBase.current !== base;
    if (!reset && lastVersion.current === v) return;
    lastBase.current = base;
    lastVersion.current = v;
    fetchWindow(reset ? pageSize : Math.max(pageSize, loadedCount.current), reset);
  }, [base, v, fetchWindow, pageSize]);

  const loadMore = useCallback(async () => {
    if (state.next == null || state.loading) return;
    const id = ++reqId.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const page = await api<MediaPage>(`${base}&cursor=${state.next}&limit=${pageSize}`);
      if (id !== reqId.current) return;
      setState((s) => {
        const seen = new Set(s.items.map((m) => m.id));
        const items = [...s.items, ...page.items.filter((m) => !seen.has(m.id))];
        loadedCount.current = items.length;
        return { ...s, items, total: page.total, next: page.nextCursor, loading: false };
      });
    } catch (e) {
      if (id === reqId.current) setState((s) => ({ ...s, loading: false, error: e as Error }));
    }
  }, [base, state.next, state.loading, pageSize]);

  /** Optimistic local changes, reconciled by the refetch that follows invalidateMedia(). */
  const removeLocal = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setState((s) => ({ ...s, items: s.items.filter((m) => !set.has(m.id)), total: Math.max(0, s.total - s.items.filter((m) => set.has(m.id)).length) }));
  }, []);
  const patchLocal = useCallback((m: Media) => {
    setState((s) => ({ ...s, items: s.items.map((x) => (x.id === m.id ? m : x)) }));
  }, []);

  const stale = state.base !== base;
  return {
    items: stale ? [] : state.items,
    total: stale ? 0 : state.total,
    hasMore: !stale && state.next != null,
    loading: stale || state.loading,
    initialLoading: stale || !state.loaded,
    error: state.error,
    loadMore,
    removeLocal,
    patchLocal,
    reload: () => fetchWindow(Math.max(pageSize, loadedCount.current), false),
  };
}

// ——— Local interface preferences (not credentials; per browser) ———

export type ViewMode = "grid" | "list";
export type Density = "compact" | "comfortable" | "large";
export interface UiPrefs { view: ViewMode; density: Density; sidebarCollapsed: boolean }
const PREFS_KEY = "nexo.ui.v1";
const DEFAULT_PREFS: UiPrefs = { view: "grid", density: "comfortable", sidebarCollapsed: false };
let prefs: UiPrefs = DEFAULT_PREFS;
let prefsLoaded = false;
const prefListeners = new Set<() => void>();

function readPrefs(): UiPrefs {
  if (!prefsLoaded && typeof window !== "undefined") {
    prefsLoaded = true;
    try { prefs = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { /* storage unavailable */ }
  }
  return prefs;
}

export function usePrefs() {
  const p = useSyncExternalStore(
    (l) => { prefListeners.add(l); return () => prefListeners.delete(l); },
    readPrefs,
    () => DEFAULT_PREFS,
  );
  const set = useCallback((patch: Partial<UiPrefs>) => {
    prefs = { ...readPrefs(), ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode etc. */ }
    prefListeners.forEach((l) => l());
  }, []);
  return [p, set] as const;
}
