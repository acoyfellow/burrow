export const TERMINAL_WINDOW_BYTES = 512 * 1024;

export const TERMINAL_ACK_EVERY_BYTES = 64 * 1024;

export class CreditWindow {
  private unacked = 0;
  private waiters: (() => void)[] = [];
  private closed = false;

  constructor(private readonly limit: number) {}

  get inFlight() {
    return this.unacked;
  }

  async reserve(bytes: number): Promise<void> {
    while (!this.closed && this.unacked > 0 && this.unacked + bytes > this.limit)
      await new Promise<void>((resolve) => this.waiters.push(resolve));

    this.unacked += bytes;
  }

  ack(bytes: number) {
    this.unacked = Math.max(0, this.unacked - Math.max(0, bytes));
    this.wake();
  }

  close() {
    this.closed = true;
    this.wake();
  }

  private wake() {
    const waiting = this.waiters;

    this.waiters = [];

    for (const resolve of waiting) resolve();
  }
}

export const ackRequest = (frame: string): number | null => {
  try {
    const control = JSON.parse(frame) as { ack?: unknown };

    return typeof control.ack === 'number' && Number.isFinite(control.ack) && control.ack >= 0
      ? control.ack
      : null;
  } catch {
    return null;
  }
};
