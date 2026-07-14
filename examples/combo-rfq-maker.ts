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
  throw new Error('Set ALPHA_MAKER_MNEMONIC or TEST_MNEMONIC before running this example.');
}

const maker = algosdk.mnemonicToSecretKey(makerMnemonic);
const signer = algosdk.makeBasicAccountTransactionSigner(maker);

// Node 22+ and browsers provide global WebSocket. On Node < 22:
//   import WebSocket from 'ws';
//   new AlphaWebSocket({ apiKey, WebSocket })
const ws = new AlphaWebSocket({ apiKey });

const session = await ws.openComboRfqMakerSession({ signer });

for await (const event of session) {
  if (event.type === 'combo_rfq_request') {
    // Replace with your model. Prices are YES probability in micro units.
    // Do not rely on a leaked house mid; price the tree independently.
    await session.quote(event, { priceMicro: 500_000 });
    continue;
  }

  if (event.type === 'combo_rfq_fill_request') {
    if (event.makerAddress !== maker.addr.toString() || Date.now() > event.confirmBy) {
      await session.decline(event, 'maker wallet mismatch or expired fill request');
      continue;
    }

    await session.confirm(event);
  }
}
