import { describe, expect, it } from 'vitest';
import { ackRequest, CreditWindow } from '../src/flow';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('terminal flow control', () => {
  it('stops sending when the client has not acknowledged a full window', async () => {
    const window = new CreditWindow(100);
    let sent = 0;

    const sender = (async () => {
      for (let i = 0; i < 5; i++) {
        await window.reserve(40);
        sent += 40;
      }
    })();

    await tick();
    expect(sent).toBe(80);

    window.ack(40);
    await tick();
    expect(sent).toBe(120);

    window.ack(200);
    await sender;
    expect(sent).toBe(200);
  });

  it('lets one oversized chunk through so output never deadlocks', async () => {
    const window = new CreditWindow(10);

    await window.reserve(50);
    expect(window.inFlight).toBe(50);
  });

  it('releases a waiting sender when the socket closes', async () => {
    const window = new CreditWindow(10);

    await window.reserve(10);
    const blocked = window.reserve(10);

    window.close();
    await expect(blocked).resolves.toBeUndefined();
  });

  it('reads ack control frames and ignores everything else', () => {
    expect(ackRequest('{"ack":65536}')).toBe(65536);
    expect(ackRequest('{"resize":[80,24]}')).toBeNull();
    expect(ackRequest('{"ack":-1}')).toBeNull();
    expect(ackRequest('nope')).toBeNull();
  });
});
