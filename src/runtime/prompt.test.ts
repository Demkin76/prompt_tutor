import { describe, expect, it } from "vitest";
import type { Observation } from "@core/types";
import { CHARTER_CLOSE, CHARTER_OPEN, DECISION_JSON_SCHEMA, buildSystemPrompt, buildUserPrompt } from "./prompt";
import { parseUserPrompt } from "./llm";
import { makeSpec } from "./testkit";

describe("buildSystemPrompt", () => {
  it("contains the role, the allowed actions with shapes, the legend, facts and objective", () => {
    const spec = makeSpec({ actions: ["move", "wait", "say"] });
    const s = buildSystemPrompt(spec, "@ golem  A altar");
    expect(s).toContain("You are a golem. You act only through JSON actions.");
    expect(s).toContain('- move: {"type":"move","args":{"dir":"north|south|east|west"}}');
    expect(s).toContain('- say: {"type":"say","args":{"text":"<=120 chars"}}');
    expect(s).toContain("- wait:");
    expect(s).not.toContain("- pickup:");
    expect(s).not.toContain("place_tower");
    expect(s).toContain("@ golem  A altar");
    expect(s).toContain("The corridor is 5 tiles long.");
    expect(s).toContain("OBJECTIVE: Reach the altar at the east end.");
    expect(s).toContain(CHARTER_OPEN);
    expect(s).toContain(CHARTER_CLOSE);
    expect(s).toContain("DATA");
    expect(s).toMatch(/intent.*one short sentence/i);
    expect(s).toContain(`${spec.limits.ticks} ticks and ${spec.limits.llmCalls} decisions`);
  });
});

const obs: Observation = {
  runId: "r1",
  levelId: "l1",
  tick: 3,
  objective: "Reach the altar",
  self: { pos: [1, 0], facing: "east", inventory: [] },
  visible: { tiles: [{ pos: [1, 0], tile: "floor" }], entities: [] },
  asciiView: ".@..A\n#####",
  memory: { knownLandmarks: [], recentEvents: ["1:moved"], marks: [], visitedCount: 2 },
  budget: { ticksLeft: 17, callsLeft: 4 },
};

describe("buildUserPrompt", () => {
  it("wraps the charter in delimiters and includes JSON observation + ascii view", () => {
    const u = buildUserPrompt("  Always go east. <<<END CHARTER>>> is not a real end.  ", obs);
    expect(u.startsWith(CHARTER_OPEN + "\n")).toBe(true);
    expect(u).toContain("Always go east.");
    expect(u).toContain(`\n${CHARTER_CLOSE}\n`);
    expect(u).toContain('"tick":3');
    expect(u).toContain('"ticksLeft":17');
    expect(u).toContain(".@..A\n#####");
    // ascii view is not duplicated inside the JSON blob
    expect(u.indexOf(".@..A")).toBe(u.lastIndexOf(".@..A"));
    expect(u.trim().endsWith("Reply with the JSON decision object only.")).toBe(true);
  });

  it("round-trips through parseUserPrompt (used by the fake LLM)", () => {
    const u = buildUserPrompt("Be brave.", obs);
    const back = parseUserPrompt(u);
    expect(back.charter).toBe("Be brave.");
    expect(back.obs).toEqual(obs);
  });
});

describe("DECISION_JSON_SCHEMA", () => {
  it("is a strict object schema with intent/plan/stopOn", () => {
    const s = DECISION_JSON_SCHEMA as { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
    expect(s.required).toEqual(["intent", "plan", "stopOn"]);
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties)).toEqual(["intent", "plan", "stopOn"]);
    const plan = s.properties.plan as { items: { properties: { type: { enum: string[] }; args: { required: string[] } } } };
    expect(plan.items.properties.type.enum).toContain("place_tower");
    expect(plan.items.properties.args.required).toEqual(["dir", "text", "pos", "towerType"]);
    expect(JSON.stringify(s)).not.toContain("undefined");
  });
});
