import type { Orderbook, OrderbookEntry, CounterpartyMatch } from '../types.js';

/**
 * Computes matching counterparty orders from an orderbook for a given order.
 *
 * Supports both direct matching (Buy YES vs Sell YES) and complementary matching
 * (Buy YES at 60c vs Buy NO at 40c — prices sum to $1.00).
 *
 * @param orderbook - The full orderbook for the market
 * @param isBuying - Whether the taker is buying
 * @param isYes - Whether the taker's position is Yes (true) or No (false)
 * @param quantity - Desired quantity in microunits
 * @param price - Desired price in microunits
 * @param slippageTolerance - Maximum acceptable slippage in microunits
 * @returns Array of counterparty matches, sorted by best price, up to the requested quantity
 */
export const calculateMatchingOrders = (
  orderbook: Orderbook,
  isBuying: boolean,
  isYes: boolean,
  quantity: number,
  price: number,
  slippageTolerance: number,
): CounterpartyMatch[] => {
  const { yes, no } = orderbook;

  const getMatchingOrders = (): OrderbookEntry[] => {
    if (isBuying) {
      if (isYes) {
        const directOrders = yes.asks;
        const complementaryOrders = no.bids.map((bid) => ({
          price: 1_000_000 - bid.price,
          quantity: bid.quantity,
          escrowAppId: bid.escrowAppId,
          owner: bid.owner,
        }));
        const allOrders = [...directOrders, ...complementaryOrders].sort((a, b) => a.price - b.price);
        return allOrders.filter((order) => order.price <= price + slippageTolerance);
      } else {
        const directOrders = no.asks;
        const complementaryOrders = yes.bids.map((bid) => ({
          price: 1_000_000 - bid.price,
          quantity: bid.quantity,
          escrowAppId: bid.escrowAppId,
          owner: bid.owner,
        }));
        const allOrders = [...directOrders, ...complementaryOrders].sort((a, b) => a.price - b.price);
        return allOrders.filter((order) => order.price <= price + slippageTolerance);
      }
    } else {
      if (isYes) {
        const directOrders = yes.bids;
        const complementaryOrders = no.asks.map((ask) => ({
          price: 1_000_000 - ask.price,
          quantity: ask.quantity,
          escrowAppId: ask.escrowAppId,
          owner: ask.owner,
        }));
        const allOrders = [...directOrders, ...complementaryOrders].sort((a, b) => b.price - a.price);
        return allOrders.filter((order) => order.price >= price - slippageTolerance);
      } else {
        const directOrders = no.bids;
        const complementaryOrders = yes.asks.map((ask) => ({
          price: 1_000_000 - ask.price,
          quantity: ask.quantity,
          escrowAppId: ask.escrowAppId,
          owner: ask.owner,
        }));
        const allOrders = [...directOrders, ...complementaryOrders].sort((a, b) => b.price - a.price);
        return allOrders.filter((order) => order.price >= price - slippageTolerance);
      }
    }
  };

  const matchingOrders = getMatchingOrders();
  if (matchingOrders.length === 0) return [];

  const matches: CounterpartyMatch[] = [];
  let volumeLeft = quantity;
  for (const counterParty of matchingOrders) {
    if (volumeLeft <= 0) break;
    const amountToTake = Math.min(counterParty.quantity, volumeLeft);
    if (amountToTake > 0) {
      matches.push({
        escrowAppId: counterParty.escrowAppId,
        quantity: amountToTake,
        owner: counterParty.owner,
      });
      volumeLeft -= amountToTake;
    }
  }

  return matches;
};
