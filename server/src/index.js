/**
 * Server entry point.
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import prisma from './config/prisma.js';
import {
  startNotificationDispatcher,
  stopNotificationDispatcher,
} from './services/notification.service.js';

const app = createApp();

// Email / WhatsApp delivery of notifications. Does nothing unless SMTP or
// WhatsApp keys are set; in-app notifications need no background work.
if (startNotificationDispatcher()) {
  process.stdout.write('Notification outbox dispatcher started.\n');
}

const server = app.listen(env.PORT, () => {
  process.stdout.write(
    `\nSekawati Impex ERP API\n` +
      `  env    : ${env.NODE_ENV}\n` +
      `  listen : http://localhost:${env.PORT}/api\n` +
      `  health : http://localhost:${env.PORT}/api/health\n` +
      `  client : ${env.CLIENT_ORIGIN}\n\n`,
  );
});

async function shutdown(signal) {
  process.stdout.write(`\n${signal} received, shutting down...\n`);
  stopNotificationDispatcher();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`\nUnhandled promise rejection: ${reason?.stack ?? reason}\n`);
});
