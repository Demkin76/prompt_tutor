/**
 * All backend access goes through `GolemApi`. Two implementations:
 *  - convexApi: real Convex hooks (used when VITE_CONVEX_URL is set)
 *  - mockApi:   in-memory store driven by ./mock.ts
 * Convex function references come from `anyApi` so the build never depends on convex/_generated.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import type { DecisionRecord, Frame, LevelRunResult, LevelSpec, ModeId, Replay, RunSettings, RunStatus, RunSummary, TierSpec, WorldState, TierResult } from "@core/types";
import { buildTiers, MODES, mockStore } from "./mock";

// ───────────────────────── Shapes returned by the backend ─────────────────────────
export interface ModeInfo {
  id: ModeId;
  title: string;
  tagline: string;
}

export interface BestResult {
  score: number;
  passedLevels: number;
  charter: string;
}

export interface SessionDoc {
  sessionId: string;
  progress: Partial<Record<ModeId, number>>; // highest unlocked tier per mode
  best: Record<string, BestResult>; // key `${mode}-${tier}`
}

export interface RunDoc {
  runId: string;
  sessionId: string;
  mode: ModeId;
  tier: number; // starting tier
  currentTier?: number; // tier being played now (ladder)
  ladder?: TierResult[];
  charter: string;
  status: RunStatus;
  host?: string;
  summary?: RunSummary;
  error?: string;
  /** Rune trading: indicator settings frozen at deploy time. */
  settings?: RunSettings;
}

export interface LevelRunDoc {
  levelId: string;
  seed: number;
  spec: LevelSpec;
  initialState: WorldState;
  result?: LevelRunResult;
  replay?: Replay;
  order: number;
}

export interface FrameRow {
  tick: number;
  frame: Frame;
}

export interface DecisionRow {
  tick: number;
  record: DecisionRecord;
}

export interface CreateRunArgs {
  sessionId: string;
  mode: ModeId;
  tier: number;
  charter: string;
  /** Rune trading only: indicator configuration frozen for the run. */
  settings?: RunSettings;
}

export interface GolemApi {
  useModes(): ModeInfo[] | undefined;
  useTiers(mode: ModeId | null): TierSpec[] | undefined;
  useSession(sessionId: string): SessionDoc | null | undefined;
  useEnsureSession(): (sessionId: string) => Promise<SessionDoc>;
  useCreateRun(): (args: CreateRunArgs) => Promise<string>;
  useRun(runId: string | null): RunDoc | null | undefined;
  useLevelRuns(runId: string | null): LevelRunDoc[] | undefined;
  useFrames(runId: string | null, levelId: string | null): FrameRow[] | undefined;
  useDecisions(runId: string | null, levelId: string | null): DecisionRow[] | undefined;
}

// ───────────────────────── Convex implementation ─────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = anyApi as any;

const convexApi: GolemApi = {
  useModes: () => useQuery(api.levels.modes, {}) as ModeInfo[] | undefined,
  useTiers: (mode) => useQuery(api.levels.tiers, mode ? { mode } : "skip") as TierSpec[] | undefined,
  useSession: () => useQuery(api.sessions.get, {}) as SessionDoc | null | undefined,
  useEnsureSession: () => {
    const m = useMutation(api.sessions.ensure);
    return useCallback((_sessionId: string) => m({}) as Promise<SessionDoc>, [m]);
  },
  useCreateRun: () => {
    const m = useMutation(api.runs.create);
    return useCallback(({ mode, tier, charter, settings }: CreateRunArgs) => m({ mode, tier, charter, ...(settings ? { settings } : {}) }) as Promise<string>, [m]);
  },
  useRun: (runId) => useQuery(api.runs.get, runId ? { runId } : "skip") as RunDoc | null | undefined,
  useLevelRuns: (runId) => useQuery(api.runs.levelRuns, runId ? { runId } : "skip") as LevelRunDoc[] | undefined,
  useFrames: (runId, levelId) =>
    useQuery(api.runs.frames, runId && levelId ? { runId, levelId, afterTick: -1 } : "skip") as FrameRow[] | undefined,
  useDecisions: (runId, levelId) =>
    useQuery(api.runs.decisions, runId && levelId ? { runId, levelId } : "skip") as DecisionRow[] | undefined,
};

// ───────────────────────── Mock implementation ─────────────────────────
function useStoreVersion(): number {
  const [v, setV] = useState(mockStore.version);
  useEffect(() => mockStore.subscribe(() => setV(mockStore.version)), []);
  return v;
}

const mockApi: GolemApi = {
  useModes: () => MODES,
  useTiers: (mode) => useMemo(() => (mode ? buildTiers(mode) : undefined), [mode]),
  useSession: (sessionId) => {
    const v = useStoreVersion();
    return useMemo(() => {
      void v;
      const s = mockStore.session;
      return s && s.sessionId === sessionId ? s : undefined;
    }, [v, sessionId]);
  },
  useEnsureSession: () => useCallback(async (sessionId: string) => mockStore.ensureSession(sessionId), []),
  useCreateRun: () =>
    useCallback(async (args: CreateRunArgs) => {
      await new Promise((r) => setTimeout(r, 150));
      return mockStore.createRun(args);
    }, []),
  useRun: (runId) => {
    const v = useStoreVersion();
    return useMemo(() => {
      void v;
      if (!runId) return undefined;
      return mockStore.runs.get(runId) ?? null;
    }, [v, runId]);
  },
  useLevelRuns: (runId) => {
    const v = useStoreVersion();
    return useMemo(() => {
      void v;
      return runId ? mockStore.getPublicLevelRuns(runId) : undefined;
    }, [v, runId]);
  },
  useFrames: (runId, levelId) => {
    const v = useStoreVersion();
    return useMemo(() => {
      void v;
      return runId && levelId ? mockStore.getFrames(runId, levelId) : undefined;
    }, [v, runId, levelId]);
  },
  useDecisions: (runId, levelId) => {
    const v = useStoreVersion();
    return useMemo(() => {
      void v;
      return runId && levelId ? mockStore.getDecisions(runId, levelId) : undefined;
    }, [v, runId, levelId]);
  },
};

export const CONVEX_URL: string | undefined = import.meta.env.VITE_CONVEX_URL as string | undefined;
export const BACKEND: "convex" | "mock" = CONVEX_URL ? "convex" : "mock";
export const golemApi: GolemApi = CONVEX_URL ? convexApi : mockApi;
