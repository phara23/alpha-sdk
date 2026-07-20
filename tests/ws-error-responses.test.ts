import { afterEach, describe, expect, it } from 'vitest';

import { AlphaWebSocket } from '../src/websocket.js';

/**
 * The platform WS answers control requests with { id, status, result } on
 * success and { id, status, error: { code, msg } } on failure. The SDK must
 * reject the pending request on error payloads — resolving them used to make
 * AUTH failures invisible (maker scripts printed "AUTH ok" and waited forever).
 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  /** Per-method canned responses. Default: plain success. */
  static respondWith: (parsed: { method?: string; id?: string }) => Record<string, unknown> | null = () => null;

  readyState = 1;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }

  send(data: string): void {
    const parsed = JSON.parse(data);
    this.sent.push(parsed);
    if (!parsed.id) return;
    const canned = MockWebSocket.respondWith(parsed);
    this.emit(canned ? { id: parsed.id, ...canned } : { id: parsed.id, status: 200, result: {} });
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

describe('websocket control response handling', () => {
  const makerAddress = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

  afterEach(() => {
    MockWebSocket.instances = [];
    MockWebSocket.respondWith = () => null;
  });

  it('rejects AUTH when the server answers with an error payload', async () => {
    MockWebSocket.respondWith = (parsed) =>
      parsed.method === 'AUTH'
        ? { status: 401, error: { code: 2, msg: 'Invalid API key' } }
        : null;

    const ws = new AlphaWebSocket({ apiKey: 'bad-key', WebSocket: MockWebSocket });

    await expect(ws.openComboRfqMakerSession({ makerAddress })).rejects.toMatchObject({
      message: 'Invalid API key',
      status: 401,
    });
  });

  it('rejects RFQ methods refused by the server (e.g. kill switch off)', async () => {
    MockWebSocket.respondWith = (parsed) =>
      parsed.method === 'RFQ_QUOTE'
        ? { status: 403, error: { code: 2, msg: 'Competitive combo RFQ is temporarily disabled.' } }
        : null;

    const ws = new AlphaWebSocket({ apiKey: 'test-key', WebSocket: MockWebSocket });
    const session = await ws.openComboRfqMakerSession({ makerAddress });

    await expect(
      session.quote(
        { type: 'combo_rfq_request', rfqId: 'rfq-1', tree: { groups: [], connectors: [] }, grossStakeMicro: 1, quoteDeadline: 0 },
        { priceMicro: 500_000 },
      ),
    ).rejects.toThrow('Competitive combo RFQ is temporarily disabled.');
  });

  it('still resolves plain success responses', async () => {
    const ws = new AlphaWebSocket({ apiKey: 'test-key', WebSocket: MockWebSocket });
    await expect(ws.openComboRfqMakerSession({ makerAddress })).resolves.toBeDefined();
  });
});
