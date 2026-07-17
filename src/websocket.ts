import type {
  AlphaWebSocketConfig,
  MarketsChangedEvent,
  MarketChangedEvent,
  OrderbookChangedEvent,
  WalletOrdersChangedEvent,
  ComboRfqFillRequestEvent,
  ComboRfqMakerSession,
  ComboRfqMakerSessionEvent,
  ComboRfqMakerSessionOptions,
  ComboRfqQuoteReference,
  ComboRfqRequestEvent,
} from './types.js';
import { DEFAULT_WSS_BASE_URL } from './constants.js';
import { signComboRfqTransactions } from './modules/comboRfq.js';

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

type MakerEventCallback = (event: ComboRfqMakerSessionEvent) => void;

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
 * Connects to `wss://platform-wss.alphaarcade.com` and provides typed,
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
  private apiKey?: string;

  private ws: WebSocketLike | null = null;
  private subscriptions = new Map<StreamKey, Subscription>();
  private pendingRequests = new Map<string, PendingRequest>();
  private lastOrderbookVersionBySubscription = new Map<StreamKey, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private connectPromise: Promise<void> | null = null;
  private authenticated = false;
  private makerEventCallbacks = new Set<MakerEventCallback>();

  constructor(config?: AlphaWebSocketConfig) {
    this.url = config?.url ?? DEFAULT_WSS_BASE_URL;
    this.reconnectEnabled = config?.reconnect ?? true;
    this.maxReconnectAttempts = config?.maxReconnectAttempts ?? Infinity;
    this.heartbeatIntervalMs = config?.heartbeatIntervalMs ?? 60_000;
    this.WebSocketImpl = resolveWebSocket(config?.WebSocket);
    this.apiKey = config?.apiKey;
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

  /** Authenticate as an API-key maker and return an async combo RFQ event stream. */
  async openComboRfqMakerSession(options: ComboRfqMakerSessionOptions = {}): Promise<ComboRfqMakerSession> {
    const apiKey = options.apiKey ?? this.apiKey;
    if (!apiKey) {
      throw new Error('apiKey is required to open a combo RFQ maker session.');
    }
    this.apiKey = apiKey;
    await this.connect();
    if (!this.authenticated) {
      await this.authenticate();
    }

    const queue: ComboRfqMakerSessionEvent[] = [];
    const seen = new Set<string>();
    const waiters: Array<(value: IteratorResult<ComboRfqMakerSessionEvent>) => void> = [];
    let closed = false;

    const eventKey = (event: ComboRfqMakerSessionEvent): string =>
      event.type === 'combo_rfq_request'
        ? `${event.type}:${event.rfqId}`
        : `${event.type}:${event.rfqId}:${event.quoteId}`;

    const callback: MakerEventCallback = (event) => {
      const key = eventKey(event);
      if (seen.has(key)) return;
      seen.add(key);

      if (waiters.length > 0) {
        waiters.shift()!({ done: false, value: event });
        return;
      }
      queue.push(event);
    };

    this.makerEventCallbacks.add(callback);

    const rfqIdFrom = (eventOrRfqId: ComboRfqRequestEvent | string): string =>
      typeof eventOrRfqId === 'string' ? eventOrRfqId : eventOrRfqId.rfqId;

    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<ComboRfqMakerSessionEvent>> => {
          if (queue.length > 0) {
            return { done: false, value: queue.shift()! };
          }
          if (closed) {
            return { done: true, value: undefined };
          }
          return new Promise((resolve) => waiters.push(resolve));
        },
      }),
      quote: async (
        eventOrRfqId: ComboRfqRequestEvent | string,
        quote: { priceMicro: number },
      ): Promise<ComboRfqQuoteReference> => {
        const response = await this.sendRequest({
          method: 'RFQ_QUOTE',
          params: [{ rfqId: rfqIdFrom(eventOrRfqId), priceMicro: quote.priceMicro }],
        });
        return (response as { result?: ComboRfqQuoteReference }).result ?? (response as ComboRfqQuoteReference);
      },
      cancel: (eventOrRfqId: ComboRfqRequestEvent | string): Promise<unknown> =>
        this.sendRequest({
          method: 'RFQ_QUOTE_CANCEL',
          params: [{ rfqId: rfqIdFrom(eventOrRfqId) }],
        }),
      confirm: async (
        event: ComboRfqFillRequestEvent,
        signedMakerTxns?: string[],
      ): Promise<unknown> => {
        const signer = options.signer;
        if (!signedMakerTxns && !signer) {
          throw new Error('signer is required when signedMakerTxns are not provided.');
        }
        const signed = signedMakerTxns ?? await signComboRfqTransactions(event.unsignedMakerTxns, signer!);
        return this.sendRequest({
          method: 'FILL_CONFIRM',
          params: [{ rfqId: event.rfqId, quoteId: event.quoteId, signedMakerTxns: signed }],
        });
      },
      decline: (event: ComboRfqFillRequestEvent, reason?: string): Promise<unknown> =>
        this.sendRequest({
          method: 'FILL_DECLINE',
          params: [{ rfqId: event.rfqId, quoteId: event.quoteId, reason }],
        }),
      close: (): void => {
        closed = true;
        this.makerEventCallbacks.delete(callback);
        while (waiters.length > 0) {
          waiters.shift()!({ done: true, value: undefined });
        }
      },
    };
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
      this.lastOrderbookVersionBySubscription.delete(key);
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
        this.authenticated = false;
        this.reconnectAttempts = 0;
        this.startHeartbeat();

        // Re-send all subscriptions after open so the server can return
        // a fresh snapshot for stateful streams like orderbook_changed.
        const subs = [...this.subscriptions.values()];
        for (const sub of subs) {
          this.sendSubscribe(sub.stream, sub.params);
        }

        if (this.apiKey) {
          this.authenticate().then(resolve).catch(reject);
        } else {
          resolve();
        }
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

      // Server control responses are { id, status, result } on success and
      // { id, status, error: { code, msg } } on failure. Rejecting here is what
      // surfaces AUTH/RFQ method failures — resolving them silently leaves
      // callers (e.g. openComboRfqMakerSession) believing they succeeded.
      const errorPayload = msg.error;
      const status = typeof msg.status === 'number' ? msg.status : null;
      if (errorPayload || (status !== null && status >= 400)) {
        const message =
          (errorPayload && typeof errorPayload.msg === 'string' && errorPayload.msg) ||
          (typeof msg.message === 'string' && msg.message) ||
          `WebSocket request failed with status ${status ?? 'unknown'}`;
        req.reject(Object.assign(new Error(message), { status, code: errorPayload?.code }));
        return;
      }

      req.resolve(msg);
      return;
    }

    // Route stream events to matching callbacks
    const eventType = msg.type as string | undefined;
    if (!eventType) return;

    if (eventType === 'combo_rfq_request' || eventType === 'combo_rfq_fill_request') {
      for (const callback of this.makerEventCallbacks) {
        try {
          callback(msg as ComboRfqMakerSessionEvent);
        } catch {
          // Don't let user callback errors kill the socket
        }
      }
      return;
    }

    for (const [key, sub] of this.subscriptions.entries()) {
      if (!this.matchesSubscriptionMessage(sub, msg)) {
        continue;
      }

      if (!this.shouldDispatchSubscriptionMessage(key, sub, msg)) {
        continue;
      }

      try {
        sub.callback(msg);
      } catch {
        // Don't let user callback errors kill the socket
      }
    }
  }

  private matchesSubscriptionMessage(sub: Subscription, msg: any): boolean {
    if (sub.eventType !== msg.type) return false;

    if (msg.type === 'orderbook_changed') {
      const messageMarketId = typeof msg.marketId === 'string' ? msg.marketId : '';
      const messageSlug = typeof msg.slug === 'string' ? msg.slug : '';
      const subscriptionMarketId = typeof sub.params.marketId === 'string' ? sub.params.marketId : '';
      const subscriptionSlug = typeof sub.params.slug === 'string' ? sub.params.slug : '';

      if (subscriptionMarketId) return subscriptionMarketId === messageMarketId;
      if (subscriptionSlug && messageSlug) return subscriptionSlug === messageSlug;
      if (subscriptionSlug || subscriptionMarketId) return false;
    }

    if (msg.type === 'wallet_orders_changed') {
      const messageWallet = typeof msg.wallet === 'string' ? msg.wallet : '';
      const subscriptionWallet = typeof sub.params.wallet === 'string' ? sub.params.wallet : '';

      if (subscriptionWallet) return subscriptionWallet === messageWallet;
      return false;
    }

    return true;
  }

  private shouldDispatchSubscriptionMessage(key: StreamKey, sub: Subscription, msg: any): boolean {
    if (sub.eventType !== 'orderbook_changed') {
      return true;
    }

    const version = Number(msg.version ?? 0);
    if (!Number.isFinite(version)) {
      return true;
    }

    const lastVersion = this.lastOrderbookVersionBySubscription.get(key) ?? 0;
    if (version < lastVersion) {
      return false;
    }

    this.lastOrderbookVersionBySubscription.set(key, version);
    return true;
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

  private async authenticate(): Promise<void> {
    if (!this.apiKey) return;
    await this.sendRequest({ method: 'AUTH', params: [{ apiKey: this.apiKey }] });
    this.authenticated = true;
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
