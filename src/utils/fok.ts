import type { CounterpartyMatch, CreateFokOrderParams, Orderbook, OrderbookEntry } from '../types.js';
import { calculateMatchingOrders } from './matching.js';

export function validateFokParams(params: CreateFokOrderParams): void {
  if (!Number.isSafeInteger(params.marketAppId) || params.marketAppId <= 0) {
    throw new Error('FOK marketAppId must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(params.quantity) || params.quantity <= 0) {
    throw new Error('FOK quantity must be a positive safe integer in microunits.');
  }
  if (!Number.isSafeInteger(params.price) || params.price <= 0 || params.price >= 1_000_000) {
    throw new Error('FOK price must be an integer between 1 and 999999 microunits.');
  }
  if ((params.position !== 0 && params.position !== 1) || typeof params.isBuying !== 'boolean') {
    throw new Error('FOK requires position 0 or 1 and a boolean isBuying.');
  }
  if (params.feeBase !== undefined &&
      (!Number.isSafeInteger(params.feeBase) || params.feeBase < 0 || params.feeBase > 1_000_000)) {
    throw new Error('FOK feeBase must be an integer between 0 and 1000000 microunits.');
  }
}

const filterBook = (book: Orderbook, keep: (order: OrderbookEntry) => boolean): Orderbook => ({
  ...book,
  yes: { bids: book.yes.bids.filter(keep), asks: book.yes.asks.filter(keep) },
  no: { bids: book.no.bids.filter(keep), asks: book.no.asks.filter(keep) },
});

/** Select native liquidity only. Exact quantities and zero slippage enforce the FOK limit. */
export function selectFokMatches(
  params: CreateFokOrderParams, book: Orderbook, owner: string,
): CounterpartyMatch[] {
  validateFokParams(params);
  const eligible = filterBook(book, order =>
    order.owner !== owner && Number.isSafeInteger(order.quantity) && order.quantity > 0 &&
    Number.isSafeInteger(order.price) && order.price > 0 && order.price < 1_000_000 &&
    Number.isSafeInteger(order.escrowAppId) && order.escrowAppId > 0,
  );
  const calculate = (source: Orderbook) => calculateMatchingOrders(
    source, params.isBuying, params.position === 1, params.quantity, params.price, 0,
  );
  const matches = params.matchingOrders === undefined ? calculate(eligible) :
    params.matchingOrders.map(fill => {
      if (!Number.isSafeInteger(fill.quantity) || fill.quantity <= 0) {
        throw new Error('FOK fill quantities must be positive safe integers.');
      }
      const [available] = calculate(filterBook(eligible, o => o.escrowAppId === fill.escrowAppId));
      if (!available || available.owner !== fill.owner || available.quantity < fill.quantity) {
        throw new Error('FOK selected maker is unavailable, outside the price limit, or has insufficient quantity.');
      }
      // Use the current effective price, never caller-supplied price metadata.
      return { ...available, quantity: fill.quantity };
    });
  if (new Set(matches.map(m => m.escrowAppId)).size !== matches.length) {
    throw new Error('FOK cannot repeat a maker escrow.');
  }
  if (matches.reduce((sum, m) => sum + BigInt(m.quantity), 0n) !== BigInt(params.quantity)) {
    throw new Error('FOK requires exact full-quantity liquidity within the price limit. No order was placed.');
  }
  // Three setup transactions, two per maker, and at most one opt-in.
  if (3 + 2 * matches.length > 16) {
    throw new Error('FOK requires too many maker escrows for one atomic group (maximum 6). No order was placed.');
  }
  return matches;
}
