import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestComboRfqQuote } from '../src/modules/comboRfq.js';
import { AlphaWebSocket } from '../src/websocket.js';
import type { AlphaClientConfig } from '../src/types.js';

const createConfig = (): AlphaClientConfig => ({
  algodClient: {} as AlphaClientConfig['algodClient'],
  indexerClient: {} as AlphaClientConfig['indexerClient'],
  signer: (async () => []) as AlphaClientConfig['signer'],
  activeAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
  matcherAppId: 1,
  usdcAssetId: 31566704,
  apiBaseUrl: 'https://example.alphaarcade.test/api',
  apiKey: 'test-key',
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 1;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: unknown[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }

  send(data: string): void {
    const parsed = JSON.parse(data);
    this.sent.push(parsed);
    if (parsed.id) {
      this.emit({ id: parsed.id, result: { ok: true, ...this.resultFor(parsed) } });
    }
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  private resultFor(parsed: { method?: string; params?: Array<Record<string, unknown>> }): Record<string, unknown> {
    if (parsed.method === 'RFQ_QUOTE') {
      return {
        rfqId: parsed.params?.[0]?.rfqId,
        quoteId: 'maker-quote-1',
        priceMicro: parsed.params?.[0]?.priceMicro,
      };
    }
    return {};
  }
}

describe('combo RFQ SDK transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    MockWebSocket.instances = [];
  });

  it('requests competitive combo quotes through the platform API', async () => {
    const payload = {
      quoteId: 'combo-quote-1',
      pricedYesMicro: 420_000,
      makerKind: 'external',
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload),
    });
    vi.stubGlobal('fetch', fetchMock);

    const quote = await requestComboRfqQuote(createConfig(), {
      userAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
      grossStakeMicro: 1_000_000,
      tree: {
        groups: [{
          op: 'AND',
          legs: [{ source: 'aa', marketId: 'market-1', selection: 'yes' }],
        }],
        connectors: [],
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.alphaarcade.test/api/combo/quote',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-key',
        },
      }),
    );
    expect(quote).toMatchObject(payload);
  });

  it('authenticates maker sessions and sends RFQ quotes on the existing websocket', async () => {
    const makerAddress = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
    const ws = new AlphaWebSocket({
      apiKey: 'test-key',
      WebSocket: MockWebSocket,
    });

    const session = await ws.openComboRfqMakerSession({ makerAddress });
    const socket = MockWebSocket.instances[0];
    socket.emit({
      type: 'combo_rfq_request',
      rfqId: 'rfq-1',
      tree: { groups: [], connectors: [] },
      grossStakeMicro: 1_000_000,
      quoteDeadline: Date.now() + 1000,
    });

    const event = (await session[Symbol.asyncIterator]().next()).value;
    const quote = await session.quote(event, { priceMicro: 490_000 });

    expect(session.makerAddress).toBe(makerAddress);
    expect(socket.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'AUTH',
        params: [{ apiKey: 'test-key', makerAddress }],
      }),
      expect.objectContaining({ method: 'RFQ_QUOTE' }),
    ]));
    expect(quote).toMatchObject({
      rfqId: 'rfq-1',
      quoteId: 'maker-quote-1',
      priceMicro: 490_000,
    });
  });

  it('surfaces sell-side RFQ request fields and fill requests to makers', async () => {
    const makerAddress = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
    const ws = new AlphaWebSocket({
      apiKey: 'test-key',
      WebSocket: MockWebSocket,
    });

    const session = await ws.openComboRfqMakerSession({ makerAddress });
    const socket = MockWebSocket.instances[0];
    socket.emit({
      type: 'combo_rfq_request',
      side: 'sell',
      rfqId: 'rfq-sell-1',
      tree: { groups: [], connectors: [] },
      grossStakeMicro: 4_945_992,
      fairPriceMicro: 197_925,
      alphaPriceMicro: 186_228,
      quantityMicro: 4_945_992,
      marketId: 'market-sell-1',
      marketAppId: 3_671_048_592,
      yesAssetId: 3_671_048_711,
      quoteDeadline: Date.now() + 1000,
    });

    const iterator = session[Symbol.asyncIterator]();
    const sellEvent = (await iterator.next()).value;
    expect(sellEvent).toMatchObject({
      type: 'combo_rfq_request',
      side: 'sell',
      rfqId: 'rfq-sell-1',
      fairPriceMicro: 197_925,
      alphaPriceMicro: 186_228,
      quantityMicro: 4_945_992,
      marketId: 'market-sell-1',
      marketAppId: 3_671_048_592,
      yesAssetId: 3_671_048_711,
    });

    const quote = await session.quote(sellEvent, { priceMicro: 192_925 });
    expect(quote).toMatchObject({
      rfqId: 'rfq-sell-1',
      quoteId: 'maker-quote-1',
      priceMicro: 192_925,
    });

    socket.emit({
      type: 'combo_rfq_fill_request',
      side: 'sell',
      rfqId: 'rfq-sell-1',
      quoteId: 'maker-quote-1',
      comboQuoteId: 'combo-quote-1',
      makerAddress,
      unsignedMakerTxns: ['txn-a', 'txn-b'],
      confirmBy: Date.now() + 1000,
    });

    const fillEvent = (await iterator.next()).value;
    expect(fillEvent).toMatchObject({
      type: 'combo_rfq_fill_request',
      side: 'sell',
      rfqId: 'rfq-sell-1',
      quoteId: 'maker-quote-1',
      comboQuoteId: 'combo-quote-1',
      makerAddress,
      unsignedMakerTxns: ['txn-a', 'txn-b'],
    });
  });

  it('surfaces a SELL RFQ with no fairPriceMicro when Alpha could not live-price', async () => {
    const makerAddress = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
    const ws = new AlphaWebSocket({
      apiKey: 'test-key',
      WebSocket: MockWebSocket,
    });

    const session = await ws.openComboRfqMakerSession({ makerAddress });
    const socket = MockWebSocket.instances[0];
    socket.emit({
      type: 'combo_rfq_request',
      side: 'sell',
      rfqId: 'rfq-sell-unpriced-1',
      tree: { groups: [], connectors: [] },
      grossStakeMicro: 4_945_992,
      quantityMicro: 4_945_992,
      marketId: 'market-sell-1',
      marketAppId: 3_671_048_592,
      yesAssetId: 3_671_048_711,
      quoteDeadline: Date.now() + 1000,
    });

    const iterator = session[Symbol.asyncIterator]();
    const sellEvent = (await iterator.next()).value;
    expect(sellEvent).toMatchObject({
      type: 'combo_rfq_request',
      side: 'sell',
      rfqId: 'rfq-sell-unpriced-1',
      quantityMicro: 4_945_992,
    });
    expect(sellEvent.fairPriceMicro).toBeUndefined();
    expect(sellEvent.alphaPriceMicro).toBeUndefined();

    const quote = await session.quote(sellEvent, { priceMicro: 192_925 });
    expect(quote).toMatchObject({
      rfqId: 'rfq-sell-unpriced-1',
      quoteId: 'maker-quote-1',
      priceMicro: 192_925,
    });
  });
});

