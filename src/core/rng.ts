/**
 * Deterministic PRNG (mulberry32). The whole generator state is one uint32,
 * which is what WorldState.rngState carries between steps.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Current 32-bit state; read to persist, assign to restore. */
  state: number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const rng: Rng = {
    next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive: number) {
      if (maxExclusive <= 0) return 0;
      return Math.floor(rng.next() * maxExclusive);
    },
    get state() {
      return a;
    },
    set state(v: number) {
      a = v >>> 0;
    },
  };
  return rng;
}

/** Resume a generator from a previously read `state`. */
export function rngFromState(state: number): Rng {
  return createRng(state);
}

/** Derive a new seed from a base seed and a salt (for retry loops in generators). */
export function deriveSeed(seed: number, salt: number): number {
  const r = createRng((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
  return Math.floor(r.next() * 4294967296) >>> 0;
}
