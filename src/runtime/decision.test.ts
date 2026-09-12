import { describe, expect, it } from "vitest";
import { DEFAULT_STOP_ON, DecisionError, extractJsonText, parseDecision } from "./decision";
import { makeSpec } from "./testkit";

const spec = makeSpec({ actions: ["move", "wait", "interact", "pickup", "place", "say", "place_tower", "start_wave"] });

describe("parseDecision", () => {
  it("parses a valid decision and normalizes actions", () => {
    const d = parseDecision(
      JSON.stringify({
        intent: "Go east",
        plan: [
          { type: "move", args: { dir: "east", text: null, pos: null, towerType: null } },
          { type: "wait", args: { dir: null, text: null, pos: null, towerType: null } },
          { type: "interact", args: {} },
          { type: "interact", args: { dir: "north" } },
          { type: "place_tower", args: { pos: [2, 3], towerType: "arrow" } },
        ],
        stopOn: ["blocked", "blocked", "goal_visible"],
      }),
      spec,
    );
    expect(d.intent).toBe("Go east");
    expect(d.plan).toEqual([
      { type: "move", args: { dir: "east" } },
      { type: "wait" },
      { type: "interact" },
      { type: "interact", args: { dir: "north" } },
      { type: "place_tower", args: { pos: [2, 3], towerType: "arrow" } },
    ]);
    expect(d.stopOn).toEqual(["blocked", "goal_visible"]);
  });

  it("strips code fences and leading prose", () => {
    const text = 'Sure!\n```json\n{"intent":"x","plan":[{"type":"wait","args":{}}],"stopOn":[]}\n```';
    const d = parseDecision(text, spec);
    expect(d.plan).toEqual([{ type: "wait" }]);
    expect(d.stopOn).toEqual([]);
    expect(extractJsonText('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("applies the default stopOn when missing", () => {
    const d = parseDecision('{"intent":"x","plan":[{"type":"wait"}]}', spec);
    expect(d.stopOn).toEqual(DEFAULT_STOP_ON);
    expect(d.stopOn).not.toBe(DEFAULT_STOP_ON); // copy, not shared
  });

  it("accepts say with text <= 120 chars", () => {
    const d = parseDecision(JSON.stringify({ intent: "note", plan: [{ type: "say", args: { text: "mark: start" } }] }), spec);
    expect(d.plan[0]).toEqual({ type: "say", args: { text: "mark: start" } });
  });

  const bad: [string, string, RegExp][] = [
    ["not JSON", "hello there", /not valid JSON/],
    ["JSON array", "[1,2]", /must be a JSON object/],
    ["missing intent", '{"plan":[{"type":"wait"}]}', /intent must be a string/],
    ["intent too long", JSON.stringify({ intent: "x".repeat(201), plan: [{ type: "wait" }] }), /intent must be <= 200/],
    ["empty plan", '{"intent":"x","plan":[]}', /1 to 5 actions/],
    ["plan too long", JSON.stringify({ intent: "x", plan: Array(6).fill({ type: "wait" }) }), /1 to 5 actions/],
    ["plan not array", '{"intent":"x","plan":{"type":"wait"}}', /plan must be an array/],
    ["unknown action type", '{"intent":"x","plan":[{"type":"fly"}]}', /"fly" is not allowed/],
    ["move without dir", '{"intent":"x","plan":[{"type":"move","args":{}}]}', /needs args.dir/],
    ["move with bad dir", '{"intent":"x","plan":[{"type":"move","args":{"dir":"up"}}]}', /needs args.dir/],
    ["interact with bad dir", '{"intent":"x","plan":[{"type":"interact","args":{"dir":"up"}}]}', /interact.*args.dir/],
    ["say without text", '{"intent":"x","plan":[{"type":"say","args":{}}]}', /non-empty args.text/],
    ["say too long", JSON.stringify({ intent: "x", plan: [{ type: "say", args: { text: "y".repeat(121) } }] }), /<= 120/],
    ["place_tower bad pos", '{"intent":"x","plan":[{"type":"place_tower","args":{"pos":[1.5,2],"towerType":"a"}}]}', /\[int, int\]/],
    ["place_tower no towerType", '{"intent":"x","plan":[{"type":"place_tower","args":{"pos":[1,2]}}]}', /towerType/],
    ["stopOn not array", '{"intent":"x","plan":[{"type":"wait"}],"stopOn":"blocked"}', /stopOn must be an array/],
    ["stopOn unknown", '{"intent":"x","plan":[{"type":"wait"}],"stopOn":["never"]}', /unknown trigger/],
    ["args not object", '{"intent":"x","plan":[{"type":"wait","args":5}]}', /args must be an object/],
  ];
  for (const [name, text, re] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parseDecision(text, spec)).toThrowError(DecisionError);
      expect(() => parseDecision(text, spec)).toThrowError(re);
    });
  }

  it("rejects actions not allowed by this spec even if globally valid", () => {
    const narrow = makeSpec({ actions: ["move", "wait"] });
    expect(() => parseDecision('{"intent":"x","plan":[{"type":"pickup"}]}', narrow)).toThrowError(/not allowed; allowed: move, wait/);
  });
});
