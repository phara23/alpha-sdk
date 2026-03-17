import type {
  AlphaWebSocketConfig,
  MarketsChangedEvent,
  MarketChangedEvent,
  OrderbookChangedEvent,
  WalletOrdersChangedEvent,
} from './types.js';
import { DEFAULT_WSS_BASE_URL } from './constants.js';

type StreamKey = string;

type WebSocketLike = {
  readyState: number;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: any) => void) | null;
  onclose: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  send: (data: string) => void;
  close: () => void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

const WS_OPEN = 1;

type Subscription = {
  stream: string;
  params: Record<string, string>;
  callback: (data: any) => void;
  eventType: string;
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

const resolveWebSocket = (provided?: unknown): WebSocketConstructor => {
  if (provided) return provided as WebSocketConstructor;
  if (typeof globalThis !== 'undefined' && (globalThis as any).WebSocket) {
    return (globalThis as any).WebSocket;
  }
  throw new Error(
    'No WebSocket implementation found. On Node.js < 22, install the "ws" package and pass it: ' +
    'new AlphaWebSocket({ WebSocket: require("ws") })',
  );
};

/**
 * Real-time WebSocket client for Alpha Market platform streams.
 *
 * Connects to `wss://wss.platform.alphaarcade.com` and provides typed,
 * callback-based subscriptions for live market data. No auth required.
 *
 * @example
 * ```typescript
 * // Node.js 22+ or browser (native WebSocket)
 * const ws = new AlphaWebSocket();
 *
 * // Node.js < 22 — pass the `ws` package
 * import WebSocket from 'ws';
 * const ws = new AlphaWebSocket({ WebSocket });
 *
 * const unsub = ws.subscribeOrderbook('will-btc-hit-100k', (event) => {
 *   console.log('Orderbook:', event.orderbook);
 * });
 *
 * // Later
 * unsub();
 * ws.close();
 * ```
 */
export class AlphaWebSocket {
  private url: string;
  private reconnectEnabled: boolean;
  private maxReconnectAttempts: number;
  private heartbeatIntervalMs: number;
  private WebSocketImpl: WebSocketConstructor;

  private ws: WebSocketLike | null = null;
  private subscriptions = new Map<StreamKey, Subscription>();
  private pendingRequests = new Map<string, PendingRequest>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private connectPromise: Promise<void> | null = null;

  constructor(config?: AlphaWebSocketConfig) {
    this.url = config?.url ?? DEFAULT_WSS_BASE_URL;
    this.reconnectEnabled = config?.reconnect ?? true;
    this.maxReconnectAttempts = config?.maxReconnectAttempts ?? Infinity;
    this.heartbeatIntervalMs = config?.heartbeatIntervalMs ?? 60_000;
    this.WebSocketImpl = resolveWebSocket(config?.WebSocket);
  }

  /** Whether the WebSocket is currently open and connected */
  get connected(): boolean {
    return this.ws?.readyState === WS_OPEN;
  }

  // ============================================
  // Subscribe Methods
  // ============================================

  /**
   * Subscribe to live market probability updates (incremental diffs).
   * @returns An unsubscribe function
   */
  subscribeLiveMarkets(callback: (event: MarketsChangedEvent) => void): () => void {
    return this.subscribe('get-live-markets', {}, 'markets_changed', callback);
  }

  /**
   * Subscribe to change events for a single market.
   * @param slug - The market slug
   * @returns An unsubscribe function
   */
  subscribeMarket(slug: string, callback: (event: MarketChangedEvent) => void): () => void {
    return this.subscribe('get-market', { slug }, 'market_changed', callback);
  }

  /**
   * Subscribe to full orderbook snapshots (~5s interval on changes).
   * @param slug - The market slug
   * @returns An unsubscribe function
   */
  subscribeOrderbook(slug: string, callback: (event: OrderbookChangedEvent) => void): () => void {
    return this.subscribe('get-orderbook', { slug }, 'orderbook_changed', callback);
  }

  /**
   * Subscribe to wallet order updates.
   * @param wallet - The wallet address
   * @returns An unsubscribe function
   */
  subscribeWalletOrders(wallet: string, callback: (event: WalletOrdersChangedEvent) => void): () => void {
    return this.subscribe('get-wallet-orders', { wallet }, 'wallet_orders_changed', callback);
  }

  // ============================================
  // Control Methods
  // ============================================

  /** Query the server for the list of active subscriptions on this connection */
  listSubscriptions(): Promise<unknown> {
    return this.sendRequest({ method: 'LIST_SUBSCRIPTIONS' });
  }

  /** Query a server property (e.g. "heartbeat", "limits") */
  getProperty(property: string): Promise<unknown> {
    return this.sendRequest({ method: 'GET_PROPERTY', params: [property] });
  }

  // ============================================
  // Lifecycle
  // ============================================

  /** Open the WebSocket connection. Called automatically on first subscribe. */
  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect();
    return this.connectPromise;
  }

  /** Close the connection and clean up all resources */
  close(): void {
    this.intentionallyClosed = true;
    this.clearTimers();
    this.subscriptions.clear();
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error('WebSocket closed'));
    }
    this.pendingRequests.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectPromise = null;
  }

  // ============================================
  // Internal
  // ============================================

  private buildStreamKey(stream: string, params: Record<string, string>): StreamKey {
    const parts = [stream, ...Object.entries(params).sort().map(([k, v]) => `${k}=${v}`)];
    return parts.join('&');
  }

  private buildQueryString(): string {
    const subs = [...this.subscriptions.values()];
    if (subs.length === 0) return '';

    const first = subs[0];
    const params = new URLSearchParams({ stream: first.stream, ...first.params });
    return '?' + params.toString();
  }

  private subscribe(
    stream: string,
    params: Record<string, string>,
    eventType: string,
    callback: (data: any) => void,
  ): () => void {
    const key = this.buildStreamKey(stream, params);

    this.subscriptions.set(key, { stream, params, callback, eventType });

    if (this.connected) {
      this.sendSubscribe(stream, params);
    } else {
      this.connect();
    }

    return () => {
      this.subscriptions.delete(key);
      if (this.connected) {
        this.sendUnsubscribe(stream, params);
      }
    };
  }

  private async doConnect(): Promise<void> {
    this.intentionallyClosed = false;

    return new Promise<void>((resolve, reject) => {
      const qs = this.buildQueryString();
      const ws = new this.WebSocketImpl(this.url + qs);

      ws.onopen = () => {
        this.ws = ws;
        this.reconnectAttempts = 0;
        this.startHeartbeat();

        // Subscribe to any streams that weren't in the initial query string
        const subs = [...this.subscriptions.values()];
        for (const sub of subs.slice(1)) {
          this.sendSubscribe(sub.stream, sub.params);
        }

        resolve();
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };

      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        this.stopHeartbeat();
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      ws.onerror = (err) => {
        if (!this.ws) {
          reject(new Error('WebSocket connection failed'));
        }
      };
    });
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      this.send({ method: 'PONG' });
      return;
    }

    // Handle responses to control requests
    const responseId = typeof msg.id === 'string' ? msg.id : typeof msg.requestId === 'string' ? msg.requestId : null;
    if (responseId && this.pendingRequests.has(responseId)) {
      const req = this.pendingRequests.get(responseId)!;
      this.pendingRequests.delete(responseId);
      clearTimeout(req.timer);
      req.resolve(msg);
      return;
    }

    // Route stream events to matching callbacks
    const eventType = msg.type as string | undefined;
    if (!eventType) return;

    for (const sub of this.subscriptions.values()) {
      if (sub.eventType === eventType) {
        try {
          sub.callback(msg);
        } catch {
          // Don't let user callback errors kill the socket
        }
      }
    }
  }

  private sendSubscribe(stream: string, params: Record<string, string>): void {
    this.send({ method: 'SUBSCRIBE', params: [{ stream, ...params }] });
  }

  private sendUnsubscribe(stream: string, params: Record<string, string>): void {
    this.send({ method: 'UNSUBSCRIBE', params: [{ stream, ...params }] });
  }

  private sendRequest(payload: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timed out'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      if (!this.connected) {
        this.connect().then(() => {
          this.send({ ...payload, id: requestId });
        }).catch(reject);
      } else {
        this.send({ ...payload, id: requestId });
      }
    });
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // ============================================
  // Heartbeat
  // ============================================

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ method: 'PING' });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ============================================
  // Reconnect
  // ============================================

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // doConnect rejection triggers onclose which re-schedules
      });
    }, delay);
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
