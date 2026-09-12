import { describe, expect, it } from "vitest";
import { createRng, deriveSeed, rngFromState } from "./rng";

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 20 }, () => a.next());
    const ys = Array.from({ length: 20 }, () => b.next());
    expect(xs).toEqual(ys);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it("differs for different seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it("resumes from state", () => {
    const a = createRng(7);
    a.next();
    a.next();
    const saved = a.state;
    const b = rngFromState(saved);
    expect(b.next()).toBe(a.next());
    expect(b.int(10)).toBe(a.int(10));
  });

  it("int stays in range", () => {
    const r = createRng(99);
    for (let i = 0; i < 200; i++) {
      const v = r.int(6);
      expect(v >= 0 && v < 6 && Number.isInteger(v)).toBe(true);
    }
    expect(r.int(0)).toBe(0);
  });

  it("deriveSeed is stable and salt-sensitive", () => {
    expect(deriveSeed(5, 1)).toBe(deriveSeed(5, 1));
    expect(deriveSeed(5, 1)).not.toBe(deriveSeed(5, 2));
  });
});
