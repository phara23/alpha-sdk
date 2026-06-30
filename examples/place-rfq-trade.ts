/**
 * Example: Simple RFQ flow: requestRfqQuote -> submitRoutedOrder.
 *
 * Usage:
 *   MARKET_ID=<market-uuid> ALPHA_API_KEY=<api-key> TEST_MNEMONIC="..." npx tsx examples/place-rfq-trade.ts
 *
 * Multi-option markets (e.g. O/U totals with several lines):
 *   MARKET_ID=<parent-uuid> MARKET_APP_ID=<option-app-id> ... npx tsx examples/place-rfq-trade.ts
 *   MARKET_ID=<parent-uuid> OPTION_ID=<option-uuid> ... npx tsx examples/place-rfq-trade.ts
 *   MARKET_ID=<option-uuid> ... npx tsx examples/place-rfq-trade.ts
 *
 * Required env vars:
 *   ALPHA_API_KEY
 *   TEST_MNEMONIC
 *   MARKET_ID
 *
 * Optional env vars:
 *   OPTION_ID or MARKET_APP_ID (required when the market has multiple options)
 *   QUANTITY=1000000
 *   POSITION=yes|no
 *   SIDE=buy|sell
 *   TAKER_SLIPPAGE_MICRO=5000
 */
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient, type Market, type MarketOption, type Position } from '../src/index.js';

dotenv.config();

const API_KEY = process.env.ALPHA_API_KEY;
const MARKET_ID = process.env.MARKET_ID;
const OPTION_ID = process.env.OPTION_ID?.trim();
const MARKET_APP_ID_INPUT = process.env.MARKET_APP_ID?.trim();
const TEST_MNEMONIC = process.env.TEST_MNEMONIC;
const QUANTITY = Number(process.env.QUANTITY ?? 1_000_000);
const POSITION_INPUT = (process.env.POSITION ?? 'yes').trim().toLowerCase();
const SIDE_INPUT = (process.env.SIDE ?? 'buy').toLowerCase();
const TAKER_SLIPPAGE_MICRO = process.env.TAKER_SLIPPAGE_MICRO
  ? Number(process.env.TAKER_SLIPPAGE_MICRO)
  : undefined;

type TradeTarget = {
  quoteMarketId: string;
  submitMarketId: string;
  marketAppId: number;
  label: string;
};

const parsePosition = (value: string): Position => {
  if (value === 'yes') return 1;
  if (value === 'no') return 0;
  throw new Error('POSITION must be yes or no.');
};

const parseIsBuying = (value: string): boolean => {
  if (value === 'buy') return true;
  if (value === 'sell') return false;
  throw new Error('SIDE must be buy or sell.');
};

const parseMarketAppId = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('MARKET_APP_ID must be a positive integer.');
  }
  return parsed;
};

const getParentId = (market: Market): string | undefined => {
  const parentId = (market as { parentId?: unknown }).parentId;
  return typeof parentId === 'string' && parentId.trim() ? parentId.trim() : undefined;
};

const getMarketLabel = (market: Market): string =>
  market.title || String((market as { topic?: unknown }).topic ?? market.id);

const getOptionLabel = (option: MarketOption): string =>
  option.title || String((option as { label?: unknown }).label ?? option.id);

const formatOptionLine = (option: MarketOption): string =>
  `  - ${getOptionLabel(option)} (OPTION_ID=${option.id}, MARKET_APP_ID=${option.marketAppId})`;

const resolveTradeTarget = (
  market: Market,
  optionId?: string,
  marketAppId?: number,
): TradeTarget => {
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
        `Market "${getMarketLabel(market)}" has no marketAppId. For multi-option markets, set OPTION_ID or MARKET_APP_ID.`,
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
        `OPTION_ID ${optionId} was not found on "${getMarketLabel(market)}". Available options:\n${options.map(formatOptionLine).join('\n')}`,
      );
    }
  } else if (marketAppId != null) {
    selected = options.find((option) => option.marketAppId === marketAppId);
    if (!selected) {
      throw new Error(
        `MARKET_APP_ID ${marketAppId} was not found on "${getMarketLabel(market)}". Available options:\n${options.map(formatOptionLine).join('\n')}`,
      );
    }
  } else if (options.length === 1) {
    selected = options[0];
  } else {
    throw new Error(
      `Market "${getMarketLabel(market)}" has ${options.length} options. Set OPTION_ID or MARKET_APP_ID:\n${options.map(formatOptionLine).join('\n')}`,
    );
  }

  return {
    quoteMarketId: market.id,
    submitMarketId: selected.id,
    marketAppId: selected.marketAppId,
    label: getOptionLabel(selected),
  };
};

const resolveAccountFromMnemonic = (mnemonic: string | undefined): {
  account: ReturnType<typeof algosdk.mnemonicToSecretKey>;
  userAddress: string;
} => {
  if (!mnemonic?.trim()) {
    throw new Error('TEST_MNEMONIC is required.');
  }

  try {
    const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
    const userAddress = account.addr?.toString() ?? null;
    if (!userAddress) {
      throw new Error('Mnemonic is wrong.');
    }
    return { account, userAddress };
  } catch (error) {
    if (error instanceof Error && error.message === 'Mnemonic is wrong.') {
      throw error;
    }
    throw new Error('Mnemonic is wrong.');
  }
};

const main = async (): Promise<void> => {
  if (!API_KEY) throw new Error('ALPHA_API_KEY is required.');
  if (!MARKET_ID) throw new Error('MARKET_ID is required.');
  if (!Number.isFinite(QUANTITY) || QUANTITY <= 0) throw new Error('QUANTITY must be positive.');
  if (OPTION_ID && MARKET_APP_ID_INPUT) {
    throw new Error('Set only one of OPTION_ID or MARKET_APP_ID.');
  }

  const position = parsePosition(POSITION_INPUT);
  const isBuying = parseIsBuying(SIDE_INPUT);
  const marketAppId = parseMarketAppId(MARKET_APP_ID_INPUT);

  const { account, userAddress } = resolveAccountFromMnemonic(TEST_MNEMONIC);
  console.log('Trading wallet:', userAddress);

  const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
  const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);

  const client = new AlphaClient({
    algodClient,
    indexerClient,
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: userAddress,
    matcherAppId: 741347297,
    usdcAssetId: 31566704,
    apiKey: API_KEY,
  });

  const market = await client.getMarket(MARKET_ID);
  if (!market) throw new Error(`Could not resolve market for MARKET_ID=${MARKET_ID}.`);

  const tradeTarget = resolveTradeTarget(market, OPTION_ID, marketAppId);
  console.log(`Market: ${getMarketLabel(market)}`);
  console.log(`Trading option: ${tradeTarget.label}`);
  console.log(`quoteMarketId=${tradeTarget.quoteMarketId} submitMarketId=${tradeTarget.submitMarketId} marketAppId=${tradeTarget.marketAppId}`);

  const quote = await client.requestRfqQuote({
    marketId: tradeTarget.quoteMarketId,
    marketAppId: tradeTarget.marketAppId,
    userAddress,
    userPosition: position,
    isBuying,
    quantity: QUANTITY,
    takerSlippageMicro: TAKER_SLIPPAGE_MICRO,
  });

  console.log('RFQ response:', quote);

  if (!quote.ok) {
    console.log('Quote not executable. Stopping before submit.');
    return;
  }

  if (
    quote.displayPriceMicro == null ||
    quote.yesAssetId == null ||
    quote.noAssetId == null ||
    quote.takerSlippageMicro == null ||
    !quote.unsignedUserTxns?.length ||
    !quote.suggestedParams ||
    !quote.nonce
  ) {
    throw new Error('Quote missing required fields for submitRoutedOrder.');
  }

  const signedUserTxns: string[] = quote.unsignedUserTxns.map((txnB64) => {
    const decoded = algosdk.decodeUnsignedTransaction(Buffer.from(txnB64, 'base64'));
    const signed = algosdk.signTransaction(decoded, account.sk);
    return Buffer.from(signed.blob).toString('base64');
  });

  const submitResult = await client.submitRoutedOrder({
    userAddress,
    marketId: tradeTarget.submitMarketId,
    marketAppId: tradeTarget.marketAppId,
    userPosition: position,
    isBuying,
    quantity: QUANTITY,
    polyQuotedPriceMicro: quote.displayPriceMicro,
    yesAssetId: quote.yesAssetId,
    noAssetId: quote.noAssetId,
    signedUserTxns,
    suggestedParams: quote.suggestedParams,
    nonce: quote.nonce,
    mmNeedsOptIn: quote.mmNeedsOptIn ?? false,
    userNeedsOptIn: quote.userNeedsOptIn ?? false,
    crossVenueTakerSlippageMicro: quote.takerSlippageMicro,
  });

  console.log('Submit result:', submitResult);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
