/** Keyed change notifications (same shape as core's Store) for app-level state. */
export class Signals {
  #versions = new Map<string, number>();
  #listeners = new Map<string, Set<() => void>>();

  subscribe(keys: string[], fn: () => void): () => void {
    for (const key of keys) {
      let set = this.#listeners.get(key);
      if (!set) this.#listeners.set(key, (set = new Set()));
      set.add(fn);
    }
    return () => {
      for (const key of keys) this.#listeners.get(key)?.delete(fn);
    };
  }

  version(key: string): number {
    return this.#versions.get(key) ?? 0;
  }

  touch(...keys: string[]): void {
    const called = new Set<() => void>();
    for (const key of keys) {
      this.#versions.set(key, (this.#versions.get(key) ?? 0) + 1);
      for (const fn of this.#listeners.get(key) ?? []) {
        if (!called.has(fn)) {
          called.add(fn);
          fn();
        }
      }
    }
  }
}
