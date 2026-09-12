const KEY = "golem.sessionId";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getSessionId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = uuid();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return uuid();
  }
}

const CHARTER_PREFIX = "golem.charter.";

export function loadCharter(mode: string, tier: number): string {
  try {
    return localStorage.getItem(`${CHARTER_PREFIX}${mode}.${tier}`) ?? "";
  } catch {
    return "";
  }
}

export function saveCharter(mode: string, tier: number, text: string): void {
  try {
    localStorage.setItem(`${CHARTER_PREFIX}${mode}.${tier}`, text);
  } catch {
    /* ignore */
  }
}

const INDICATOR_PREFIX = "golem.indicators.";

/** Merge a stored indicator list onto the defaults: ids come from the defaults, values from storage when present. */
export function mergeIndicatorSettings<T extends { id: string }>(saved: unknown, defaults: T[]): T[] {
  if (!Array.isArray(saved)) return defaults.map((item) => ({ ...item }));
  return defaults.map((item) => {
    const match = saved.find((value) => typeof value === "object" && value !== null && "id" in value && value.id === item.id);
    return match && typeof match === "object" ? { ...item, ...match, id: item.id } : { ...item };
  });
}

export function loadIndicators<T extends { id: string }>(mode: string, tier: number, defaults: T[]): T[] {
  try {
    const raw = localStorage.getItem(`${INDICATOR_PREFIX}${mode}.${tier}`);
    return mergeIndicatorSettings(raw ? JSON.parse(raw) : null, defaults);
  } catch {
    return defaults.map((item) => ({ ...item }));
  }
}

export function saveIndicators(mode: string, tier: number, value: unknown): void {
  try {
    localStorage.setItem(`${INDICATOR_PREFIX}${mode}.${tier}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
