import { useSyncExternalStore } from 'react';
import { AuthExpiredError } from './auth';

interface QueuedOp {
  label: string;
  run: () => Promise<void>;
}

export interface SyncState {
  pending: number;
  failed: number;
  authExpired: boolean;
}

/**
 * Sends changes to Google one at a time in the background, so the UI never waits on the network.
 * Failed operations are kept for a retry. After the token expires, nothing more runs until retry().
 */
class SyncQueue {
  private queue: QueuedOp[] = [];
  private failed: QueuedOp[] = [];
  private running = false;
  private authExpired = false;
  private state: SyncState = { pending: 0, failed: 0, authExpired: false };
  private listeners = new Set<() => void>();

  enqueue(label: string, run: () => Promise<void>) {
    this.queue.push({ label, run });
    this.emit();
    void this.drain();
  }

  /** Re-queues everything that failed. Call after signing in again if the token expired. */
  retry() {
    this.authExpired = false;
    this.queue = [...this.failed, ...this.queue];
    this.failed = [];
    this.emit();
    void this.drain();
  }

  /** Drops failed operations without retrying them. */
  discardFailed() {
    this.failed = [];
    this.emit();
  }

  /** Resolves once everything queued so far has been attempted. */
  async idle() {
    while (this.running || (this.queue.length > 0 && !this.authExpired)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getState = () => this.state;

  private async drain() {
    if (this.running) return;
    this.running = true;
    this.emit();
    while (this.queue.length > 0 && !this.authExpired) {
      const op = this.queue.shift()!;
      try {
        await op.run();
      } catch (e) {
        if (e instanceof AuthExpiredError) {
          this.authExpired = true;
        } else {
          console.error(`Sync failed: ${op.label}`, e);
        }
        this.failed.push(op);
      }
      this.emit();
    }
    // Once the token is gone, everything still waiting fails the same way
    if (this.authExpired) {
      this.failed.push(...this.queue);
      this.queue = [];
    }
    this.running = false;
    this.emit();
  }

  private emit() {
    this.state = {
      pending: this.queue.length + (this.running ? 1 : 0),
      failed: this.failed.length,
      authExpired: this.authExpired
    };
    this.listeners.forEach(listener => listener());
  }
}

export const syncQueue = new SyncQueue();

export const useSyncState = () => useSyncExternalStore(syncQueue.subscribe, syncQueue.getState);
