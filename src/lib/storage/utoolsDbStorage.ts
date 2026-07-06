import type { StateStorage } from "zustand/middleware";
import { UToolsAdapter } from "../utools";

const FALLBACK_DOC_PREFIX = "gn:storage:";

interface PersistedStorageDoc {
  value: string;
  updatedAt: number;
}

type RawDbStorage = {
  getItem: (key: string) => unknown;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const getFallbackDocId = (name: string) => `${FALLBACK_DOC_PREFIX}${name}`;

const getRawDbStorage = (): RawDbStorage | null => {
  if (typeof window === "undefined") return null;

  const dbStorage = (
    window as Window & { utools?: { dbStorage?: RawDbStorage } }
  ).utools?.dbStorage;

  if (
    !dbStorage ||
    typeof dbStorage.getItem !== "function" ||
    typeof dbStorage.setItem !== "function" ||
    typeof dbStorage.removeItem !== "function"
  ) {
    return null;
  }

  return dbStorage;
};

const isWebStorageAvailable = () => {
  if (typeof window === "undefined") return false;

  try {
    return typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
};

const readLocalStorageValue = (name: string): string | null => {
  if (!isWebStorageAvailable()) return null;

  try {
    return window.localStorage.getItem(name);
  } catch (error) {
    console.error("[uToolsDbStorage] localStorage getItem failed", name, error);
    return null;
  }
};

const writeLocalStorageValue = (name: string, value: string): void => {
  if (!isWebStorageAvailable()) return;

  try {
    window.localStorage.setItem(name, value);
  } catch (error) {
    console.error("[uToolsDbStorage] localStorage setItem failed", name, error);
  }
};

const deleteLocalStorageValue = (name: string): void => {
  if (!isWebStorageAvailable()) return;

  try {
    window.localStorage.removeItem(name);
  } catch (error) {
    console.error(
      "[uToolsDbStorage] localStorage removeItem failed",
      name,
      error,
    );
  }
};

const putFallbackDoc = (name: string, value: string): void => {
  const id = getFallbackDocId(name);
  const current = UToolsAdapter.db.get<PersistedStorageDoc>(id);
  const result = UToolsAdapter.db.put<PersistedStorageDoc>(
    id,
    {
      value,
      updatedAt: Date.now(),
    },
    current?._rev,
  );

  if (result.ok !== false) return;

  const latest = UToolsAdapter.db.get<PersistedStorageDoc>(id);
  const retry = UToolsAdapter.db.put<PersistedStorageDoc>(
    id,
    {
      value,
      updatedAt: Date.now(),
    },
    latest?._rev,
  );

  if (retry.ok === false) {
    console.error("[uToolsDbStorage] fallback doc put failed", name, retry.error);
  }
};

const removeFallbackDoc = (name: string): void => {
  const id = getFallbackDocId(name);
  const current = UToolsAdapter.db.get(id);
  if (!current) return;

  const result = UToolsAdapter.db.remove(id);
  if (result.ok === false) {
    console.error("[uToolsDbStorage] fallback doc remove failed", name, result.error);
  }
};

const readFallbackValue = (name: string): string | null => {
  if (UToolsAdapter.isUTools) {
    const doc = UToolsAdapter.db.get<PersistedStorageDoc | string>(
      getFallbackDocId(name),
    );
    const data = doc?.data;

    if (typeof data === "string") return data;
    if (
      data &&
      typeof data === "object" &&
      typeof (data as PersistedStorageDoc).value === "string"
    ) {
      return (data as PersistedStorageDoc).value;
    }

    return null;
  }

  return readLocalStorageValue(name);
};

const writeFallbackValue = (name: string, value: string): void => {
  if (UToolsAdapter.isUTools) {
    putFallbackDoc(name, value);
    return;
  }

  writeLocalStorageValue(name, value);
};

const deleteFallbackValue = (name: string): void => {
  if (UToolsAdapter.isUTools) {
    removeFallbackDoc(name);
    return;
  }

  deleteLocalStorageValue(name);
};

const readPrimaryValue = (name: string): string | null => {
  const dbStorage = getRawDbStorage();
  if (!dbStorage) return null;

  try {
    const value = dbStorage.getItem(name);
    return typeof value === "string" ? value : null;
  } catch (error) {
    console.error("[uToolsDbStorage] dbStorage getItem failed", name, error);
    return null;
  }
};

const writePrimaryValue = (name: string, value: string): boolean => {
  const dbStorage = getRawDbStorage();
  if (!dbStorage) return false;

  try {
    dbStorage.setItem(name, value);
    return dbStorage.getItem(name) === value;
  } catch (error) {
    console.error("[uToolsDbStorage] dbStorage setItem failed", name, error);
    return false;
  }
};

const deletePrimaryValue = (name: string): void => {
  const dbStorage = getRawDbStorage();
  if (!dbStorage) return;

  try {
    dbStorage.removeItem(name);
  } catch (error) {
    console.error("[uToolsDbStorage] dbStorage removeItem failed", name, error);
  }
};

const readStorageValue = (name: string): string | null => {
  const fallbackValue = readFallbackValue(name);
  if (fallbackValue !== null) return fallbackValue;

  const primaryValue = readPrimaryValue(name);
  if (primaryValue !== null) {
    writeFallbackValue(name, primaryValue);
    return primaryValue;
  }

  return null;
};

const writeStorageValue = (name: string, value: string): void => {
  writeFallbackValue(name, value);
  writePrimaryValue(name, value);
};

const deleteStorageValue = (name: string): void => {
  deletePrimaryValue(name);
  deleteFallbackValue(name);
};

export const uToolsStorage: StateStorage = {
  getItem: (name: string) => readStorageValue(name),
  setItem: (name: string, value: string) => writeStorageValue(name, value),
  removeItem: (name: string) => deleteStorageValue(name),
};

export const flushUToolsStorageWrites = async (): Promise<void> => {};

export const getDbStorageItem = (name: string): string | null => {
  return readStorageValue(name);
};

export const setDbStorageItem = (name: string, value: string): void => {
  writeStorageValue(name, value);
};

export const removeDbStorageItem = (name: string): void => {
  deleteStorageValue(name);
};

export const readDbStorageJSON = <T>(name: string, fallback: T): T => {
  const raw = readStorageValue(name);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("[uToolsDbStorage] parse JSON failed", name, error);
    return fallback;
  }
};

export const writeDbStorageJSON = <T>(name: string, value: T): void => {
  writeStorageValue(name, JSON.stringify(value));
};
