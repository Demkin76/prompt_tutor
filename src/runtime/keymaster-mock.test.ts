import { afterEach, expect, it, vi } from "vitest";
import { mockStore } from "../../app/src/mock";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("Keymaster demo finishes one tier with three trials and never saves player progress", async () => {
  vi.useFakeTimers();
  const saved = vi.fn();
  const fetch = vi.fn();
  vi.stubGlobal("window", { setTimeout });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: saved });
  vi.stubGlobal("fetch", fetch);
  const session = mockStore.ensureSession("keymaster-merge-test");
  const before = structuredClone(session);
  const runId = mockStore.createRun({ sessionId: session.sessionId, mode: "keymaster", tier: 1, charter: "Демонстрация" });
  await vi.dynamicImportSettled();
  await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
  await vi.runAllTimersAsync();
  const run = mockStore.runs.get(runId)!;
  expect(run.status).toBe("finished");
  expect(run.summary?.passedLevels).toBe(3);
  expect(run.summary?.totalLevels).toBe(3);
  expect(run.ladder).toHaveLength(1);
  expect(run.currentTier).toBe(1);
  expect(mockStore.getLevelRuns(runId)).toHaveLength(3);
  expect(mockStore.session).toEqual(before);
  expect(saved).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
