import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlphaWebSocket } from '../src/websocket.js';

type MessageEventLike = {
  data: string;
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readyState = 1;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: MessageEventLike) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }

  send = (data: string) => {
    this.sent.push(data);
  };

  close = () => {
    this.readyState = 3;
    this.onclose?.({});
  };
}

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('AlphaWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  it('sends subscribe and unsubscribe messages with params envelopes', async () => {
    const ws = new AlphaWebSocket({
      WebSocket: MockWebSocket as unknown as new (url: string) => WebSocket,
      heartbeatIntervalMs: 60_000,
    });

    await ws.connect();
    await flushMicrotasks();

    const unsubscribe = ws.subscribeOrderbook('will-btc-hit-100k', () => {});
    const socket = MockWebSocket.instances[0]!;

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      method: 'SUBSCRIBE',
      params: [{ stream: 'get-orderbook', slug: 'will-btc-hit-100k' }],
    });

    unsubscribe();

    expect(JSON.parse(socket.sent[1]!)).toEqual({
      method: 'UNSUBSCRIBE',
      params: [{ stream: 'get-orderbook', slug: 'will-btc-hit-100k' }],
    });

    ws.close();
  });

  it('uses protocol-compatible ids and params for GET_PROPERTY', async () => {
    const ws = new AlphaWebSocket({
      WebSocket: MockWebSocket as unknown as new (url: string) => WebSocket,
      heartbeatIntervalMs: 60_000,
    });

    await ws.connect();
    await flushMicrotasks();

    const request = ws.getProperty('heartbeat');
    const socket = MockWebSocket.instances[0]!;
    const payload = JSON.parse(socket.sent[0]!);

    expect(payload.method).toBe('GET_PROPERTY');
    expect(payload.params).toEqual(['heartbeat']);
    expect(typeof payload.id).toBe('string');

    socket.onmessage?.({
      data: JSON.stringify({
        id: payload.id,
        status: 200,
        result: { heartbeatIntervalMs: 60_000 },
      }),
    });

    await expect(request).resolves.toEqual({
      id: payload.id,
      status: 200,
      result: { heartbeatIntervalMs: 60_000 },
    });

    ws.close();
  });

  it('sends keepalive pings as control messages', async () => {
    vi.useFakeTimers();

    const ws = new AlphaWebSocket({
      WebSocket: MockWebSocket as unknown as new (url: string) => WebSocket,
      heartbeatIntervalMs: 50,
    });

    await ws.connect();
    await flushMicrotasks();

    const socket = MockWebSocket.instances[0]!;

    vi.advanceTimersByTime(50);

    expect(JSON.parse(socket.sent[0]!)).toEqual({ method: 'PING' });

    ws.close();
    vi.useRealTimers();
  });
});
