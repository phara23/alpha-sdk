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
import { AlphaClient, resolveRfqTradeTarget, type Position } from '../src/index.js';

dotenv.config();

const API_KEY = process.env.ALPHA_API_KEY;
const MARKET_ID = process.env.MARKET_ID;
// Multi-option markets only: set either OPTION_ID or MARKET_APP_ID to pick which child line to trade.
const OPTION_ID = process.env.OPTION_ID?.trim();
const MARKET_APP_ID_INPUT = process.env.MARKET_APP_ID?.trim();
const TEST_MNEMONIC = process.env.TEST_MNEMONIC;
const QUANTITY = Number(process.env.QUANTITY ?? 1_000_000);
const POSITION_INPUT = (process.env.POSITION ?? 'yes').trim().toLowerCase();
const SIDE_INPUT = (process.env.SIDE ?? 'buy').toLowerCase();
const TAKER_SLIPPAGE_MICRO = process.env.TAKER_SLIPPAGE_MICRO
  ? Number(process.env.TAKER_SLIPPAGE_MICRO)
  : undefined;

const main = async (): Promise<void> => {
  if (!API_KEY) throw new Error('ALPHA_API_KEY is required.');
  if (!TEST_MNEMONIC) throw new Error('TEST_MNEMONIC is required.');
  if (!MARKET_ID) throw new Error('MARKET_ID is required.');
  if (!Number.isFinite(QUANTITY) || QUANTITY <= 0) throw new Error('QUANTITY must be positive.');
  if (OPTION_ID && MARKET_APP_ID_INPUT) {
    throw new Error('Set only one of OPTION_ID or MARKET_APP_ID.');
  }

  if (POSITION_INPUT !== 'yes' && POSITION_INPUT !== 'no') {
    throw new Error('POSITION must be yes or no.');
  }
  if (SIDE_INPUT !== 'buy' && SIDE_INPUT !== 'sell') {
    throw new Error('SIDE must be buy or sell.');
  }

  const position: Position = POSITION_INPUT === 'yes' ? 1 : 0;
  const isBuying = SIDE_INPUT === 'buy';

  const marketAppId = MARKET_APP_ID_INPUT
    ? (() => {
      const parsed = Number(MARKET_APP_ID_INPUT);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error('MARKET_APP_ID must be a positive integer.');
      }
      return parsed;
    })()
    : undefined;

  const account = algosdk.mnemonicToSecretKey(TEST_MNEMONIC);
  const userAddress = account.addr.toString();
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

  const tradeTarget = resolveRfqTradeTarget(market, { optionId: OPTION_ID, marketAppId });
  console.log(`Market: ${market.title}`);
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
