export class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #source: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#source = new Map(entries);
    Object.freeze(this);
  }

  get size() { return this.#source.size; }
  get(key: K) { return this.#source.get(key); }
  has(key: K) { return this.#source.has(key); }
  entries() { return this.#source.entries(); }
  keys() { return this.#source.keys(); }
  values() { return this.#source.values(); }
  [Symbol.iterator]() { return this.#source[Symbol.iterator](); }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) {
    this.#source.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
  get [Symbol.toStringTag]() { return "ImmutableMap"; }
}

export function immutableMap<K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  return new ImmutableMap(entries);
}

export function frozenArray<T>(values: Iterable<T>): readonly T[] {
  return Object.freeze(Array.from(values));
}
