import type { AddressInfo } from 'node:net';
import { createApp } from './app';
import { logger } from './util/logger';

const port = Number(process.env.PORT || 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('Invalid local API port');
}
const app = createApp();
const server = app.listen(port, '127.0.0.1', () => {
  const message = {
    type: 'ready',
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
  const parentPort = (process as typeof process & {
    parentPort?: { postMessage: (message: unknown) => void; on: (event: string, handler: () => void) => void };
  }).parentPort;
  if (parentPort) parentPort.postMessage(message);
  else if (process.send) process.send(message);
  else logger.info('api.ready', message);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(0), 3000);
  timeout.unref();
  server.close(() => process.exit(0));
  server.closeAllConnections();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('disconnect', shutdown);
(process as typeof process & {
  parentPort?: { on: (event: string, handler: (event: { data?: unknown }) => void) => void };
}).parentPort?.on('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'shutdown') shutdown();
});
server.once('error', (error: NodeJS.ErrnoException) => {
  logger.error('api.start.failed', { code: error.code });
  process.exit(1);
});
