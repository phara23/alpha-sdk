import { Decimal } from 'decimal.js';

/**
 * Calculates the required fee amount in microunits.
 *
 * Formula: `fee = feeBase * quantity * price * (1 - price)`
 *
 * All values are in microunits where 1,000,000 = $1.00.
 *
 * @param quantity - Order quantity in microunits (e.g. 1_000_000 for 1 share)
 * @param price - Order price in microunits (e.g. 500_000 for $0.50)
 * @param feeBase - Fee base in microunits (e.g. 70_000 for 7%)
 * @returns Fee amount in microunits (ceiling)
 *
 * @example
 * ```typescript
 * // 1 share at $0.50 with 7% fee base
 * calculateFee(1_000_000, 500_000, 70_000); // => 17500
 * ```
 */
export const calculateFee = (
  quantity: number | bigint,
  price: number | bigint,
  feeBase: number | bigint,
): number => {
  const q = new Decimal(quantity.toString());
  const p = new Decimal(price.toString()).div(1_000_000);
  const fb = new Decimal(feeBase.toString()).div(1_000_000);

  // fee = feeBase * quantity * price * (1 - price)
  const fee = fb.mul(q).mul(p).mul(new Decimal(1).minus(p));

  return Math.ceil(fee.toNumber());
};

/**
 * Calculates the fee when given a total amount that includes the fee.
 *
 * @param totalAmount - Total amount in microunits including fee
 * @param price - Price in microunits
 * @param feeBase - Fee base in microunits
 * @returns Fee amount in microunits (ceiling)
 */
export const calculateFeeFromTotal = (
  totalAmount: number | bigint,
  price: number | bigint,
  feeBase: number | bigint,
): number => {
  const total = new Decimal(totalAmount.toString());
  const p = new Decimal(price.toString()).div(1_000_000);
  const fb = new Decimal(feeBase.toString()).div(1_000_000);

  const denominator = p.mul(new Decimal(1).plus(fb.mul(new Decimal(1).minus(p))));
  const quantity = total.div(denominator);

  const fee = fb.mul(quantity).mul(p).mul(new Decimal(1).minus(p));
  return Math.ceil(fee.toNumber());
};
