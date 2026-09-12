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
