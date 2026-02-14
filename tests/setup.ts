import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '../src/index.js';

dotenv.config();

/**
 * Creates an AlphaClient from environment variables for testing.
 * Returns null if TEST_MNEMONIC is not set (unit-test-only mode).
 */
export const createTestClient = (): AlphaClient | null => {
  const mnemonic = process.env.TEST_MNEMONIC;
  if (!mnemonic || mnemonic.includes('word1')) {
    return null;
  }

  const algodServer = process.env.TEST_ALGOD_SERVER || 'https://mainnet-api.algonode.cloud';
  const algodToken = process.env.TEST_ALGOD_TOKEN || '';
  const algodPort = process.env.TEST_ALGOD_PORT || '443';
  const indexerServer = process.env.TEST_INDEXER_SERVER || 'https://mainnet-idx.algonode.cloud';
  const indexerToken = process.env.TEST_INDEXER_TOKEN || '';
  const indexerPort = process.env.TEST_INDEXER_PORT || '443';

  const algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);
  const indexerClient = new algosdk.Indexer(indexerToken, indexerServer, indexerPort);

  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const signer = algosdk.makeBasicAccountTransactionSigner(account);

  return new AlphaClient({
    algodClient,
    indexerClient,
    signer,
    activeAddress: account.addr,
    matcherAppId: Number(process.env.TEST_MATCHER_APP_ID || '3078581851'),
    usdcAssetId: Number(process.env.TEST_USDC_ASSET_ID || '31566704'),
    apiBaseUrl: process.env.TEST_API_BASE_URL || 'https://partners.alphaarcade.com/api',
    apiKey: process.env.ALPHA_API_KEY || undefined,
  });
};

/**
 * Creates a lightweight AlphaClient for read-only tests (no mnemonic or API key needed).
 * Uses on-chain market discovery by default. If ALPHA_API_KEY is set, API-based calls also work.
 */
export const createReadOnlyClient = (): AlphaClient => {
  const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
  const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);
  const dummySigner: algosdk.TransactionSigner = async () => [];

  return new AlphaClient({
    algodClient,
    indexerClient,
    signer: dummySigner,
    activeAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
    apiBaseUrl: process.env.TEST_API_BASE_URL || 'https://partners.alphaarcade.com/api',
    apiKey: process.env.ALPHA_API_KEY || undefined,
  });
};

/** @deprecated Use createReadOnlyClient instead */
export const createApiOnlyClient = (): AlphaClient | null => {
  return createReadOnlyClient();
};

/**
 * Gets the test market app ID from environment.
 */
export const getTestMarketAppId = (): number | null => {
  const id = process.env.TEST_MARKET_APP_ID;
  return id ? Number(id) : null;
};
