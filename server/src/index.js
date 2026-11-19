import http from 'node:http';
import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { createSocketServer, expireRooms } from './sockets/index.js';
import { ensureOfficialRooms } from './lib/officialRooms.js';
import { startScheduler } from './services/scheduler.js';
import { log } from './lib/logger.js';

export async function start({ port = config.port } = {}) {
  await mongoose.connect(config.mongoUri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  if (config.officialRoomsEnabled) await ensureOfficialRooms();

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);

  const sweep = setInterval(() => expireRooms().catch((e) => log.error('room expiry failed', { err: e })), 60_000);
  sweep.unref();
  const stopScheduler = startScheduler();

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  log.info('SyncSpace API listening', { port: actualPort, env: config.nodeEnv });

  const stop = async () => {
    clearInterval(sweep);
    stopScheduler();
    io.close();
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
  };
  return { app, server, io, port: actualPort, stop };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  start().then(({ stop }) => {
    let stopping = false;
    const shutdown = async (sig) => {
      if (stopping) return;
      stopping = true;
      log.info('shutting down', { signal: sig });
      // Never hang forever on a stuck connection.
      setTimeout(() => process.exit(1), 10_000).unref();
      try {
        await stop();
        process.exit(0);
      } catch (err) {
        log.error('shutdown failed', { err });
        process.exit(1);
      }
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((err) => {
    log.error('failed to start server', { message: err.message });
    process.exit(1);
  });
}
