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

// Minimum edge (micro) you require over fair before quoting. 5_000 = 0.5¢.
const MIN_EDGE_MICRO = Number(process.env.MAKER_MIN_EDGE_MICRO || 5_000);

for await (const event of session) {
  try {
    if (event.type === 'combo_rfq_request') {
      console.log("combo_rfq_request: ", JSON.stringify(event, null, 2));

      // ── Pricing ──────────────────────────────────────────────────────────
      // It's a REVERSE auction: the LOWEST YES price wins the taker's flow, and
      // you only win by beating Alpha's house quote (never broadcast to you).
      // Every request carries `fairPriceMicro` — the whole-combo FAIR probability
      // (pre-edge, micro). It's your anchor: quote just above fair so you keep an
      // edge but still undercut Alpha's marked-up house price.
      //
      // Each leg carries what you need to price it independently instead:
      //   • AA legs:  { marketId, marketAppId, selection, description }
      //               → read the on-chain order book by `marketAppId`.
      //   • SGP legs: { graderId, sgp, league, eventId, description }
      //               → price from your own OddsBlaze feed (same-game correlation
      //                 needs the BlazeBuilder `sgp` token).
      // Real makers price from their own model/cache to stay inside the ~1s
      // window; the fair anchor lets you compete on day one without one.
      const fair = event.fairPriceMicro;
      if (fair == null) {
        // No anchor (older server) and no local model → skip rather than misprice.
        console.log(`skip ${event.rfqId}: no fair anchor and no local pricer`);
        continue;
      }
      const priceMicro = fair + MIN_EDGE_MICRO; // quote fair + your edge
      // Settlement funds the OTHER side: if you win you post (1e6 - priceMicro)
      // per contract, so a lower YES price means you post MORE — that's where a
      // long-shot combo's edge (its likely miss) is realised.
      await session.quote(event, { priceMicro });
      console.log(`quoted ${priceMicro}µ on ${event.rfqId} (fair ${fair}µ + ${MIN_EDGE_MICRO}µ edge)`);
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
