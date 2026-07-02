import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRoutedOrderbookFromApi } from '../src/modules/orderbook.js';
import { requestRfqQuote } from '../src/modules/crossVenue.js';
import type { AlphaClientConfig, RoutedOrderbookResponse } from '../src/types.js';

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

describe('routed liquidity API wrappers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches source-tagged routed orderbook entries without requiring escrow ids', async () => {
    const payload: RoutedOrderbookResponse = {
      marketId: 'market-1',
      version: 123,
      generatedAt: 456,
      orderbook: {
        '1001': {
          native: {
            bids: [],
            asks: [],
            spread: 0,
            yes: { bids: [], asks: [] },
            no: { bids: [], asks: [] },
          },
          routed: {
            yes: {
              bids: [],
              asks: [{
                price: 510_000,
                quantity: 2_000_000,
                total: 1_020_000_000_000,
                source: 'polymarket',
                execution: 'crossVenue',
                position: 'yes',
                side: 'ask',
                polyTokenId: '123',
                displayPriceMicro: 510_000,
                polySourcePriceMicro: 500_000,
                notionalMicroUsdc: 1_020_000,
              }],
            },
            no: { bids: [], asks: [] },
          },
          merged: {
            yes: { bids: [], asks: [] },
            no: { bids: [], asks: [] },
            bids: [],
            asks: [],
            spread: 0,
          },
        },
      },
      config: {
        maxNotionalMicroUsdc: 3_000_000_000,
        aaMarginBps: 100,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getRoutedOrderbookFromApi(createConfig(), 'market-1');
    const routedAsk = result.orderbook['1001'].routed.yes.asks[0];

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.alphaarcade.test/api/get-routed-orderbook?marketId=market-1',
      { headers: { 'x-api-key': 'test-key' } },
    );
    expect(routedAsk.source).toBe('polymarket');
    expect(routedAsk.execution).toBe('crossVenue');
    expect('escrowAppId' in routedAsk).toBe(false);
  });

  it('unwraps RFQ quote responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        quote: {
          ok: true,
          quoteId: 'quote-1',
          displayPriceMicro: 520_000,
          source: 'polymarket',
          execution: 'crossVenue',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const quote = await requestRfqQuote(createConfig(), {
      marketId: 'market-1',
      userPosition: 1,
      isBuying: true,
      quantity: 1_000_000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.alphaarcade.test/api/cross-venue-exec/quote',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-key',
        },
      }),
    );
    expect(quote).toMatchObject({
      quoteId: 'quote-1',
      displayPriceMicro: 520_000,
      execution: 'crossVenue',
    });
  });

  it('returns structured RFQ no-quote responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: false,
        quote: {
          ok: false,
          reason: 'INSUFFICIENT_POLY_DEPTH',
          detail: 'Available 0 microshares; requested 1000000',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const quote = await requestRfqQuote(createConfig(), {
      marketId: 'market-1',
      userPosition: 1,
      isBuying: true,
      quantity: 1_000_000,
    });

    expect(quote).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_POLY_DEPTH',
    });
  });
});
