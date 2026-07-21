import algosdk from 'algosdk';
import dotenv from 'dotenv';
import { AlphaWebSocket } from '../src/websocket.js';

dotenv.config();

const apiKey = process.env.ALPHA_API_KEY;
const makerMnemonic = process.env.TEST_MNEMONIC;

if (!apiKey) {
  throw new Error('Set ALPHA_API_KEY before running this example.');
}

if (!makerMnemonic) {
  throw new Error('Set TEST_MNEMONIC before running this example.');
}

const maker = algosdk.mnemonicToSecretKey(makerMnemonic);
const signer = algosdk.makeBasicAccountTransactionSigner(maker);
const makerAddress = maker.addr.toString();

// Node 22+ and browsers provide global WebSocket. On Node < 22:
//   import WebSocket from 'ws';
//   new AlphaWebSocket({ apiKey, WebSocket })
const ws = new AlphaWebSocket({ apiKey });

const session = await ws.openComboRfqMakerSession({ makerAddress, signer });
console.log("session: ", JSON.stringify({ makerAddress: session.makerAddress }, null, 2));

for await (const event of session) {
  try {
    if (event.type === 'combo_rfq_request') {
      console.log("combo_rfq_request: ", JSON.stringify(event, null, 2));
      // Quote the combo's YES price in micro units (e.g. 500_000 = 50¢ YES).
      // Settlement is the other side: if you win, you buy/receive the NO position
      // at (1e6 - priceMicro). Lower YES bids are more competitive for the taker.
      // Price the tree yourself — Alpha does not broadcast its house mid.
      await session.quote(event, { priceMicro: 500_000 });
      continue;
    }

    if (event.type === 'combo_rfq_fill_request') {
      if (event.makerAddress !== makerAddress || Date.now() > event.confirmBy) {
        await session.decline(event, 'maker wallet mismatch or expired fill request');
        continue;
      }

      console.log("combo_rfq_fill_request: ", JSON.stringify(event, null, 2));
      await session.confirm(event);
    }
  } catch (error) {
    // A refused quote/fill (rate limit, RFQ disabled, expired deadline) should
    // not kill the maker loop — log it and keep listening.
    console.error(`combo-rfq-maker: ${event.type} failed`, error);
  }
}
