const createStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem(key: string): string | null {
      return store[key] ?? null;
    },
    setItem(key: string, value: string): void {
      store[key] = String(value);
    },
    removeItem(key: string): void {
      delete store[key];
    },
    clear(): void {
      store = {};
    },
    get length(): number {
      return Object.keys(store).length;
    },
    key(index: number): string | null {
      return Object.keys(store)[index] ?? null;
    },
  };
};

if (typeof globalThis.localStorage === "undefined" || globalThis.localStorage === null) {
  Object.defineProperty(globalThis, "localStorage", {
    value: createStorage(),
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.sessionStorage === "undefined" || globalThis.sessionStorage === null) {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: createStorage(),
    writable: true,
    configurable: true,
  });
}
