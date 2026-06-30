/**
 * Example: Log routed orderbook (native + cross-venue) for a declared market.
 *
 * Usage:
 *   MARKET_ID=<market-uuid> npx tsx examples/get-orderbook.ts
 *   MARKET_SLUG=will-btc-hit-100k npx tsx examples/get-orderbook.ts
 *
 * Required:
 *   ALPHA_API_KEY=<api-key>
 *
 * Optional:
 *   TOP_N=10
 */
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import {
    AlphaClient,
    getRoutedOrderbookFromApi,
    type AlphaClientConfig,
    type ExecutableLiquidityEntry,
} from '../src/index.js';

dotenv.config();

const MARKET_SLUG = process.env.MARKET_SLUG;
const MARKET_ID = process.env.MARKET_ID;
const TOP_N = Number(process.env.TOP_N ?? 10);
const API_KEY = process.env.ALPHA_API_KEY;

const formatUsd = (micro: number): string => `$${(micro / 1e6).toFixed(4)}`;
const formatQty = (micro: number): string => `${(micro / 1e6).toFixed(4)}`;

const printSide = (
    label: string,
    rows: ExecutableLiquidityEntry[],
): void => {
    console.log(`\n${label} (${rows.length} orders)`);
    if (rows.length === 0) {
        console.log('  none');
        return;
    }

    for (const row of rows.slice(0, TOP_N)) {
        const escrow = 'escrowAppId' in row ? row.escrowAppId : '-';
        const owner = 'owner' in row ? row.owner : '-';
        const token = 'polyTokenId' in row ? row.polyTokenId : '-';

        console.log(
            `  p=${formatUsd(row.price)} | q=${formatQty(row.quantity)} | src=${row.source} | exec=${row.execution} | escrow=${escrow} | owner=${owner} | token=${token}`,
        );
    }
};

const main = async (): Promise<void> => {
    if (!API_KEY) {
        throw new Error('ALPHA_API_KEY is required for getRoutedOrderbookFromApi.');
    }

    if (!MARKET_ID && !MARKET_SLUG) {
        throw new Error('Declare a market via MARKET_ID or MARKET_SLUG.');
    }

    const account = algosdk.mnemonicToSecretKey(process.env.TEST_MNEMONIC!);
    const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
    const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);

    const config: AlphaClientConfig = {
        algodClient,
        indexerClient,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        activeAddress: account.addr.toString(),
        matcherAppId: 741347297,
        usdcAssetId: 31566704,
        apiKey: API_KEY,
    };

    const client = new AlphaClient(config);

    const market = MARKET_ID
        ? await client.getMarket(MARKET_ID)
        : await client.getLiveMarkets().then((markets) => markets.find((m) => m.slug === MARKET_SLUG));

    if (!market) {
        throw new Error('Could not resolve market from MARKET_ID / MARKET_SLUG.');
    }

    console.log(`Resolved market: ${market.title} (${market.slug ?? 'no-slug'})`);
    console.log(`marketId=${market.id} appId=${market.marketAppId}`);

    const routed = await getRoutedOrderbookFromApi(config, market.id);
    console.log(`Routed orderbook version=${routed.version} generatedAt=${new Date(routed.generatedAt).toISOString()}`);

    for (const [appId, app] of Object.entries(routed.orderbook)) {
        const bids = [...app.merged.bids].sort((a, b) => b.price - a.price);
        const asks = [...app.merged.asks].sort((a, b) => a.price - b.price);

        const bestBid = bids[0];
        const bestAsk = asks[0];

        console.log(`\nMerged orderbook for market app ${appId}`);
        console.log(`best bid: ${bestBid ? formatUsd(bestBid.price) : 'none'}`);
        console.log(`best ask: ${bestAsk ? formatUsd(bestAsk.price) : 'none'}`);
        console.log(`spread: ${app.merged.spread}`);

        printSide('merged bids', bids);
        printSide('merged asks', asks);
        printSide('yes bids', [...app.routed.yes.bids].sort((a, b) => b.price - a.price));
        printSide('yes asks', [...app.routed.yes.asks].sort((a, b) => a.price - b.price));
        printSide('no bids', [...app.routed.no.bids].sort((a, b) => b.price - a.price));
        printSide('no asks', [...app.routed.no.asks].sort((a, b) => a.price - b.price));
    }
};

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});
