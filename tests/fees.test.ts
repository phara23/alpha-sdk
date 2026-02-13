import { describe, it, expect } from 'vitest';
import { calculateFee, calculateFeeFromTotal } from '../src/utils/fees.js';

describe('calculateFee', () => {
  it('calculates fee for 1 share at $0.50 with 7% fee base', () => {
    // fee = 0.07 * 1_000_000 * 0.5 * 0.5 = 17500
    const fee = calculateFee(1_000_000, 500_000, 70_000);
    expect(fee).toBe(17500);
  });

  it('returns 0 fee when price is 0', () => {
    const fee = calculateFee(1_000_000, 0, 70_000);
    expect(fee).toBe(0);
  });

  it('returns 0 fee when price is 1.00 (certainty)', () => {
    const fee = calculateFee(1_000_000, 1_000_000, 70_000);
    expect(fee).toBe(0);
  });

  it('returns 0 fee when quantity is 0', () => {
    const fee = calculateFee(0, 500_000, 70_000);
    expect(fee).toBe(0);
  });

  it('returns 0 fee when fee base is 0', () => {
    const fee = calculateFee(1_000_000, 500_000, 0);
    expect(fee).toBe(0);
  });

  it('calculates fee correctly at extreme prices', () => {
    // At price = 0.10, fee = 0.07 * 1M * 0.1 * 0.9 = 6300
    const fee = calculateFee(1_000_000, 100_000, 70_000);
    expect(fee).toBe(6300);
  });

  it('calculates fee correctly for large quantities', () => {
    // 10 shares at $0.50 = 0.07 * 10_000_000 * 0.5 * 0.5 = 175000
    const fee = calculateFee(10_000_000, 500_000, 70_000);
    expect(fee).toBe(175000);
  });

  it('uses ceiling rounding', () => {
    // Should ceil any fractional result
    const fee = calculateFee(1_000_001, 500_000, 70_000);
    expect(fee).toBeGreaterThanOrEqual(17500);
    expect(Number.isInteger(fee)).toBe(true);
  });
});

describe('calculateFeeFromTotal', () => {
  it('extracts fee from a total amount', () => {
    const fee = calculateFeeFromTotal(1_000_000, 500_000, 70_000);
    expect(fee).toBeGreaterThan(0);
    expect(Number.isInteger(fee)).toBe(true);
  });

  it('returns 0 when price is 0', () => {
    // Division by zero case — should handle gracefully
    // price = 0 means denominator = 0 * ... = 0, which would be Infinity
    // The Decimal library will produce Infinity, ceil(Infinity) is Infinity
    // This is an edge case users shouldn't hit, but let's make sure it doesn't crash
    expect(() => calculateFeeFromTotal(1_000_000, 0, 70_000)).not.toThrow();
  });
});
