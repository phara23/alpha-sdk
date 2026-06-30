import type { Market, MarketOption } from '../types.js';

export type RfqTradeTarget = {
  /** Parent/family market id — pass to `requestRfqQuote`. */
  quoteMarketId: string;
  /** Option row id (or binary market id) — pass to `submitRoutedOrder`. */
  submitMarketId: string;
  marketAppId: number;
  label: string;
};

export type ResolveRfqTradeTargetParams = {
  optionId?: string;
  marketAppId?: number;
};

const getMarketLabel = (market: Market): string =>
  market.title || String((market as { topic?: unknown }).topic ?? market.id);

const getOptionLabel = (option: MarketOption): string =>
  option.title || String((option as { label?: unknown }).label ?? option.id);

const getParentId = (market: Market): string | undefined => {
  const parentId = (market as { parentId?: unknown }).parentId;
  return typeof parentId === 'string' && parentId.trim() ? parentId.trim() : undefined;
};

const formatOptionLine = (option: MarketOption): string =>
  `  - ${getOptionLabel(option)} (OPTION_ID=${option.id}, MARKET_APP_ID=${option.marketAppId})`;

/**
 * Resolves quote/submit market ids and the on-chain app id for an RFQ trade.
 *
 * Multi-option parents have no `marketAppId` on the root row — pass `optionId`
 * or `marketAppId` to select a child line. Binary markets need neither.
 */
export const resolveRfqTradeTarget = (
  market: Market,
  params: ResolveRfqTradeTargetParams = {},
): RfqTradeTarget => {
  const { optionId, marketAppId } = params;
  const parentId = getParentId(market);

  if (parentId && market.marketAppId) {
    return {
      quoteMarketId: parentId,
      submitMarketId: market.id,
      marketAppId: market.marketAppId,
      label: getMarketLabel(market),
    };
  }

  const options = market.options ?? [];
  if (options.length === 0) {
    if (!market.marketAppId) {
      throw new Error(
        `Market "${getMarketLabel(market)}" has no marketAppId. For multi-option markets, pass optionId or marketAppId.`,
      );
    }
    return {
      quoteMarketId: market.id,
      submitMarketId: market.id,
      marketAppId: market.marketAppId,
      label: getMarketLabel(market),
    };
  }

  let selected: MarketOption | undefined;
  if (optionId) {
    selected = options.find((option) => option.id === optionId);
    if (!selected) {
      throw new Error(
        `optionId ${optionId} was not found on "${getMarketLabel(market)}". Available options:\n${options.map(formatOptionLine).join('\n')}`,
      );
    }
  } else if (marketAppId != null) {
    selected = options.find((option) => option.marketAppId === marketAppId);
    if (!selected) {
      throw new Error(
        `marketAppId ${marketAppId} was not found on "${getMarketLabel(market)}". Available options:\n${options.map(formatOptionLine).join('\n')}`,
      );
    }
  } else if (options.length === 1) {
    selected = options[0];
  } else {
    throw new Error(
      `Market "${getMarketLabel(market)}" has ${options.length} options. Pass optionId or marketAppId:\n${options.map(formatOptionLine).join('\n')}`,
    );
  }

  return {
    quoteMarketId: market.id,
    submitMarketId: selected.id,
    marketAppId: selected.marketAppId,
    label: getOptionLabel(selected),
  };
};
