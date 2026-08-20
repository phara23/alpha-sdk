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
      // When present, `fairPriceMicro` is the whole-combo FAIR probability
      // (pre-edge, micro) — an anchor so you can compete without a local model.
      //
      // When ABSENT, Alpha could not live-price this combo (a SELL/cash-out
      // whose legs have no Polymarket book). You MUST price `event.tree`
      // yourself:
      //   • AA legs:  { marketId, marketAppId, selection, description }
      //               → read the on-chain order book by `marketAppId`.
      //   • SGP legs: { graderId, sgp, league, eventId, description }
      //               → price from your own OddsBlaze feed (same-game correlation
      //                 needs the BlazeBuilder `sgp` token).
      const fair = event.fairPriceMicro;
      if (fair == null) {
        console.log(`skip ${event.rfqId}: no fairPriceMicro — price this combo from the tree yourself`);
        continue;
      }

      const side = event.side;
      let priceMicro: number;
      if (side === 'sell') {
        // SELL (cash-out) — a FORWARD auction. The taker is SELLING their YES and
        // you BUY it. You compete by BIDDING HIGHER, and must beat Alpha's own
        // cash-out offer (`alphaPriceMicro`, broadcast on sell) to win — but stay
        // BELOW fair so the discount is your edge. If you win you fund the YES buy
        // (~ floor(qty·price) + fee USDC) and opt into the YES asset; your edge is
        // fair − price, realised if the combo hits (you paid < $1/share for it).
        const bid = fair - MIN_EDGE_MICRO; // quote fair − your edge
        const alpha = event.alphaPriceMicro;
        if (alpha != null && bid <= alpha) {
          console.log(`skip ${event.rfqId}: fair−edge ${bid}µ can't beat Alpha ${alpha}µ`);
          continue;
        }
        priceMicro = bid;
        await session.quote(event, { priceMicro });
        console.log(`SELL quoted ${priceMicro}µ on ${event.rfqId} (fair ${fair}µ − ${MIN_EDGE_MICRO}µ edge${alpha != null ? `, beats Alpha ${alpha}µ` : ', no Alpha reserve'})`);
      } else if (side === 'buy') {
        // BUY — a REVERSE auction: the LOWEST YES price wins, and you only win by
        // beating Alpha's house quote (never broadcast). Quote just above fair so
        // you keep an edge but still undercut Alpha. If you win you post the NO
        // collateral (1e6 − priceMicro) per contract — a lower YES price posts
        // MORE, which is where a long-shot combo's edge (its likely miss) lives.
        priceMicro = fair + MIN_EDGE_MICRO; // quote fair + your edge
        await session.quote(event, { priceMicro });
        console.log(`BUY quoted ${priceMicro}µ on ${event.rfqId} (fair ${fair}µ + ${MIN_EDGE_MICRO}µ edge)`);
      } else {
        console.log(`skip ${event.rfqId}: unknown side ${side}`);
        continue;
      }
    }

    if (event.type === 'combo_rfq_fill_request') {
      if (event.makerAddress !== makerAddress || Date.now() > event.confirmBy) {
        await session.decline(event, 'maker wallet mismatch or expired fill request');
        continue;
      }

      // `session.confirm` signs EVERY txn in `event.unsignedMakerTxns` blindly, so
      // the same call works for both sides — on a BUY it signs your NO-lay legs, on
      // a SELL your YES-buy legs. Production makers should decode + re-verify the
      // group (price, quantity, asset, group id) before signing.
      console.log(`combo_rfq_fill_request (${event.side ?? 'buy'}): `, JSON.stringify(event, null, 2));
      await session.confirm(event);
    }
  } catch (error) {
    // A refused quote/fill (rate limit, RFQ disabled, expired deadline) should
    // not kill the maker loop — log it and keep listening.
    console.error(`combo-rfq-maker: ${event.type} failed`, error);
  }
}
