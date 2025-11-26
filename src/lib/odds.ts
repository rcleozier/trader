/**
 * Convert American odds to implied probability
 * @param odds - American odds (e.g., -150, +200)
 * @returns Implied probability as a decimal (0-1)
 */
export function impliedProbabilityFromAmerican(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return (-odds) / ((-odds) + 100);
  }
}

/**
 * Convert Kalshi price to implied probability
 * Kalshi prices can be in range 0-100 (cents) or 0-1 (decimal)
 * @param price - Kalshi price
 * @returns Implied probability as a decimal (0-1), clamped to [0.001, 0.999]
 */
export function impliedProbabilityFromKalshiPrice(price: number): number {
  const normalized = price > 1 ? price / 100 : price;
  return Math.min(0.999, Math.max(0.001, normalized));
}

/**
 * Convert implied probability to American odds
 * @param probability - Implied probability as a decimal (0-1)
 * @returns American odds
 */
export function americanOddsFromProbability(probability: number): number {
  if (probability >= 0.5) {
    return Math.round(-100 * probability / (1 - probability));
  } else {
    return Math.round(100 * (1 - probability) / probability);
  }
}

/**
 * Calculate the difference between two probabilities as percentage points
 * @param prob1 - First probability (0-1)
 * @param prob2 - Second probability (0-1)
 * @returns Difference in percentage points
 */
export function probabilityDifferencePct(prob1: number, prob2: number): number {
  return Math.abs(prob1 - prob2) * 100;
}
