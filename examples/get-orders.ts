/**
 * Example: Fetch all open orders for a wallet via the Alpha API
 *
 * Usage: npx tsx examples/get-orders.ts
 *
 * Requires ALPHA_API_KEY in your .env file.
 */
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '../src/index.js';

dotenv.config();

const main = async () => {
    const account = algosdk.mnemonicToSecretKey(process.env.TEST_MNEMONIC!);
    const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
    const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);
  
    const client = new AlphaClient({
      algodClient,
      indexerClient,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      activeAddress: account.addr,
      matcherAppId: 741347297,
      usdcAssetId: 31566704,
      apiKey: process.env.ALPHA_API_KEY!,
    });

  console.log(`Wallet: ${account.addr}`);
  console.log('Fetching open orders...\n');

  const orders = await client.getWalletOrdersFromApi(account.addr);

  if (orders.length === 0) {
    console.log('No open orders found.');
    return;
  }

  console.log(`Found ${orders.length} open order(s):\n`);

  for (const order of orders) {
    const side = order.side === 1 ? 'BUY' : 'SELL';
    const position = order.position === 1 ? 'YES' : 'NO';
    const price = order.price / 1e6;
    const qty = order.quantity / 1e6;
    const filled = order.quantityFilled / 1e6;

    console.log(`  Escrow ${order.escrowAppId} | Market ${order.marketAppId}`);
    console.log(`    ${side} ${position} @ ${price} | Qty: ${qty} | Filled: ${filled}`);
    console.log();
  }
};

main().catch(console.error);
