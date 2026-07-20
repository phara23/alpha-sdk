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
});

