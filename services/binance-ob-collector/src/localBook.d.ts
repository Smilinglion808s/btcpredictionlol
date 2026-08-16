export declare class LocalOrderBook {
  constructor(marketKind: string);
  marketKind: string;
  bids: Map<number, number>;
  asks: Map<number, number>;
  initialized: boolean;
  sequenceOk: boolean;
  lastUpdateId: number | null;
  firstUpdateId: number | null;
  previousUpdateId: number | null;
  resyncGeneration: number;
  awaitingFirstLive: boolean;
  updateCount: number;
  buffer: unknown[];
  bidAdded: number;
  bidRemoved: number;
  askAdded: number;
  askRemoved: number;

  reset(): void;
  applySnapshot(snapshot: {
    bids: [string, string][];
    asks: [string, string][];
    lastUpdateId: number;
  }): boolean;
  bufferEvent(ev: unknown): void;
  applyEvent(ev: {
    U: number;
    u: number;
    pu?: number;
    b: [string, string][];
    a: [string, string][];
  }): boolean;
  levels(): { bids: [number, number][]; asks: [number, number][] };
  drainFlow(): {
    bidAdded: number;
    bidRemoved: number;
    askAdded: number;
    askRemoved: number;
    updateCount: number;
  };
}
