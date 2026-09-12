/**
 * Rune-trading charter guard. Absolute price levels are meaningless on unseen charts
 * (every level is a fresh series), so a charter must speak in indicators, percentages,
 * crossings and relative relationships. Returns human-readable errors, empty when valid.
 */
const ABSOLUTE_PRICE_PATTERNS = [
  /\b(?:buy|sell|long|short|close)\b.{0,16}\bat\s+(?:[$€£]\s*)?\d+(?:[.,]\d+)?/i,
  /\b(?:buy|sell|long|short|close)\b.{0,32}\b(?:price|mark|level)\b.{0,12}(?:[$€£]\s*)?\d+(?:[.,]\d+)?/i,
  /\bprice\b.{0,20}\b(?:is|at|above|below|over|under|reaches|hits)\b\s*(?:[$€£]\s*)?\d+(?:[.,]\d+)?/i,
  /(?:покупай|купить|продавай|продать|лонг|шорт|закрывай).{0,32}\sна\s+(?:(?:отметке|уровне|цене)\s*)?\d+(?:[.,]\d+)?/iu,
  /цен[аеыу].{0,20}(?:выше|ниже|равна|достигнет|достигает)\s*\d+(?:[.,]\d+)?/iu,
];

export function validateMarketCharter(charter: string): string[] {
  const trimmed = charter.trim();
  if (!trimmed) return ["Charter is empty."];
  if (ABSOLUTE_PRICE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return ["Absolute price instructions are not allowed. Use indicators, percentages, crossings, or relative relationships."];
  }
  return [];
}
