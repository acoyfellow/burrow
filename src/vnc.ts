export const pipeSocket = (ws: WebSocket, tcp: Socket) => {
  const writer = tcp.writable.getWriter();
  let closed = false;

  const close = () => {
    if (closed) return;

    closed = true;
    writer.close().catch(() => undefined);
    tcp.close().catch(() => undefined);

    try {
      ws.close(1000, 'vnc closed');
    } catch {
      return;
    }
  };

  ws.addEventListener('message', (event) => {
    const data = event.data;
    const bytes =
      typeof data === 'string'
        ? new TextEncoder().encode(data)
        : new Uint8Array(data as ArrayBuffer);

    writer.write(bytes).catch(close);
  });
  ws.addEventListener('close', close);
  ws.addEventListener('error', close);

  tcp.readable
    .pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          ws.send(chunk);
        },
      }),
    )
    .then(close, close);
};
