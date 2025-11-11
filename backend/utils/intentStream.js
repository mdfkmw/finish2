const clientsByTrip = new Map();

function safeWrite(res, chunk) {
  if (!res || res.writableEnded || res.destroyed) return;
  try {
    res.write(chunk);
  } catch (err) {
    try {
      res.end();
    } catch (_) {
      /* ignore */
    }
  }
}

function attachIntentStream(req, res, tripId) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const client = { res };

  if (!clientsByTrip.has(tripId)) {
    clientsByTrip.set(tripId, new Set());
  }
  clientsByTrip.get(tripId).add(client);

  safeWrite(res, `data: ${JSON.stringify({ type: 'ready', trip_id: tripId })}\n\n`);

  client.keepAlive = setInterval(() => {
    safeWrite(res, `data: ${JSON.stringify({ type: 'keepalive', trip_id: tripId })}\n\n`);
  }, 25000).unref?.();

  const cleanup = () => {
    if (client.keepAlive) {
      clearInterval(client.keepAlive);
      client.keepAlive = null;
    }
    const listeners = clientsByTrip.get(tripId);
    if (listeners) {
      listeners.delete(client);
      if (listeners.size === 0) {
        clientsByTrip.delete(tripId);
      }
    }
  };

  req.on('close', cleanup);
  res.on?.('close', cleanup);
  res.on?.('finish', cleanup);
}

function broadcastIntentEvent(tripId, payload = {}) {
  const listeners = clientsByTrip.get(tripId);
  if (!listeners || listeners.size === 0) return;
  const data = JSON.stringify({ type: 'refresh', trip_id: tripId, ...payload });
  for (const client of listeners) {
    safeWrite(client.res, `data: ${data}\n\n`);
  }
}

module.exports = {
  attachIntentStream,
  broadcastIntentEvent,
};
