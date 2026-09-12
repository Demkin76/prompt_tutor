import { describe, expect, it } from "vitest";
import { validateMarketCharter } from "./charter";

describe("validateMarketCharter", () => {
  it("allows indicator periods, thresholds, percentages and relative relationships", () => {
    expect(validateMarketCharter("Buy when RSI is below 30 and SMA(20) crosses above EMA(50). Close after a 2% reversal.")).toEqual([]);
    expect(validateMarketCharter("Покупай, когда RSI ниже 30, а SMA(20) пересекает EMA(50).")).toEqual([]);
  });

  it("rejects absolute-price trading instructions in English and Russian", () => {
    expect(validateMarketCharter("Buy at 100 and sell at 120").join(" ")).toMatch(/absolute price/i);
    expect(validateMarketCharter("Покупай на отметке 100, продавай на 120").join(" ")).toMatch(/absolute price/i);
    expect(validateMarketCharter("Go long when price is above $42.50").join(" ")).toMatch(/absolute price/i);
  });

  it("rejects an empty charter", () => {
    expect(validateMarketCharter("   ")).toEqual(["Charter is empty."]);
  });
});
