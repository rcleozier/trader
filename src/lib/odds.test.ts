import {
  impliedProbabilityFromAmerican,
  impliedProbabilityFromKalshiPrice,
  americanOddsFromProbability,
  probabilityDifferencePct,
} from './odds';

describe('odds', () => {
  describe('impliedProbabilityFromAmerican', () => {
    it('should convert positive American odds to probability', () => {
      expect(impliedProbabilityFromAmerican(200)).toBeCloseTo(100 / 300, 4);
      expect(impliedProbabilityFromAmerican(150)).toBeCloseTo(100 / 250, 4);
      expect(impliedProbabilityFromAmerican(100)).toBeCloseTo(0.5, 4);
    });

    it('should convert negative American odds to probability', () => {
      expect(impliedProbabilityFromAmerican(-200)).toBeCloseTo(200 / 300, 4);
      expect(impliedProbabilityFromAmerican(-150)).toBeCloseTo(150 / 250, 4);
      expect(impliedProbabilityFromAmerican(-100)).toBeCloseTo(0.5, 4);
    });
  });

  describe('impliedProbabilityFromKalshiPrice', () => {
    it('should convert Kalshi price in cents (0-100) to probability', () => {
      expect(impliedProbabilityFromKalshiPrice(50)).toBe(0.5);
      expect(impliedProbabilityFromKalshiPrice(75)).toBe(0.75);
      expect(impliedProbabilityFromKalshiPrice(25)).toBe(0.25);
      expect(impliedProbabilityFromKalshiPrice(100)).toBe(1);
      expect(impliedProbabilityFromKalshiPrice(0)).toBe(0.001); // Clamped
    });

    it('should convert Kalshi price in decimal (0-1) to probability', () => {
      expect(impliedProbabilityFromKalshiPrice(0.5)).toBe(0.5);
      expect(impliedProbabilityFromKalshiPrice(0.75)).toBe(0.75);
      expect(impliedProbabilityFromKalshiPrice(0.25)).toBe(0.25);
      expect(impliedProbabilityFromKalshiPrice(1.0)).toBe(0.999); // Clamped
      expect(impliedProbabilityFromKalshiPrice(0.0)).toBe(0.001); // Clamped
    });

    it('should clamp probabilities to valid range', () => {
      expect(impliedProbabilityFromKalshiPrice(150)).toBe(0.999); // Clamped from 1.5
      expect(impliedProbabilityFromKalshiPrice(-10)).toBe(0.001); // Clamped from negative
    });
  });

  describe('americanOddsFromProbability', () => {
    it('should convert probability to negative American odds when >= 0.5', () => {
      expect(americanOddsFromProbability(0.5)).toBe(-100);
      expect(americanOddsFromProbability(0.67)).toBeCloseTo(-203, 0);
      expect(americanOddsFromProbability(0.75)).toBe(-300);
    });

    it('should convert probability to positive American odds when < 0.5', () => {
      expect(americanOddsFromProbability(0.33)).toBeCloseTo(203, 0);
      expect(americanOddsFromProbability(0.25)).toBe(300);
      expect(americanOddsFromProbability(0.1)).toBe(900);
    });
  });

  describe('probabilityDifferencePct', () => {
    it('should calculate absolute difference in percentage points', () => {
      expect(probabilityDifferencePct(0.5, 0.6)).toBe(10);
      expect(probabilityDifferencePct(0.6, 0.5)).toBe(10);
      expect(probabilityDifferencePct(0.3, 0.35)).toBe(5);
      expect(probabilityDifferencePct(0.5, 0.5)).toBe(0);
    });

    it('should handle edge cases', () => {
      expect(probabilityDifferencePct(0, 1)).toBe(100);
      expect(probabilityDifferencePct(0.1, 0.9)).toBe(80);
    });
  });
});
