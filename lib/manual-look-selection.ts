"use client";

const MANUAL_LOOK_SELECTION_KEY = "manual_look_selection_v1";
const MAX_MANUAL_LOOK_SELECTION = 8;

const normalizeIds = (values: unknown): number[] => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<number>();
  const ids: number[] = [];

  for (const value of values) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_MANUAL_LOOK_SELECTION) break;
  }

  return ids;
};

const canUseStorage = (): boolean => typeof window !== "undefined";

export const getSelectionIds = (): number[] => {
  if (!canUseStorage()) return [];

  const raw = window.localStorage.getItem(MANUAL_LOOK_SELECTION_KEY);
  if (!raw) return [];

  try {
    return normalizeIds(JSON.parse(raw));
  } catch {
    return [];
  }
};

export const setSelectionIds = (ids: number[]): void => {
  if (!canUseStorage()) return;
  const normalized = normalizeIds(ids);
  window.localStorage.setItem(MANUAL_LOOK_SELECTION_KEY, JSON.stringify(normalized));
};

export const clearSelection = (): void => {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(MANUAL_LOOK_SELECTION_KEY);
};

export const removeSelectionId = (id: number): void => {
  const current = getSelectionIds();
  const next = current.filter((currentId) => currentId !== id);
  setSelectionIds(next);
};

export const addSelectionId = (
  id: number
): { ok: boolean; reason?: "duplicate" | "max" | "invalid"; ids: number[] } => {
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, reason: "invalid", ids: getSelectionIds() };
  }

  const current = getSelectionIds();
  if (current.includes(id)) {
    return { ok: false, reason: "duplicate", ids: current };
  }
  if (current.length >= MAX_MANUAL_LOOK_SELECTION) {
    return { ok: false, reason: "max", ids: current };
  }

  const next = [...current, id];
  setSelectionIds(next);
  return { ok: true, ids: next };
};

export const MAX_SELECTION_GARMENTS = MAX_MANUAL_LOOK_SELECTION;
