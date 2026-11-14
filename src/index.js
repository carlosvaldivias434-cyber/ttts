'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { config, validateRequiredDiscordEnv } = require('./config/env');
const { runMigrations } = require('./db/migrate');
const db = require('./db/pool');
const voiceManager = require('./voice/voiceManager');
const { startHealthServer, closeHealthServer } = require('./healthServer');
const logger = require('./logger').child({ module: 'main' });

let client = null;
let isShuttingDown = false;
let standbyState = {
  standby: false,
  standbyReason: null,
};

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Graceful shutdown initiated');

  try {
    voiceManager.disconnectAll();
  } catch (err) {
    logger.warn({ err: err.message }, 'Error disconnecting voice sessions during shutdown');
  }

  try {
    if (client) {
      await client.destroy();
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Error destroying Discord client during shutdown');
  }

  try {
    await db.close();
  } catch (err) {
    logger.warn({ err: err.message }, 'Error closing PostgreSQL pool during shutdown');
  }

  try {
    await closeHealthServer();
  } catch (err) {
    logger.warn({ err: err.message }, 'Error closing health server during shutdown');
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason.message : reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception');
  shutdown('uncaughtException').catch(() => process.exit(1));
});

async function bootstrap() {
  await startHealthServer(() => ({
    client,
    standby: standbyState.standby,
    standbyReason: standbyState.standbyReason,
  }));

  const isDevStandbyEligible =
    process.env.npm_lifecycle_event === 'dev' || config.nodeEnv !== 'production';

  if (!config.discord.token) {
    if (isDevStandbyEligible) {
      standbyState = {
        standby: true,
        standbyReason:
          'DISCORD_TOKEN is not configured yet. Copy .env.example to .env and set DISCORD_TOKEN, PostgreSQL, and Piper settings.',
      };
      logger.warn(standbyState.standbyReason);
      return;
    }
    validateRequiredDiscordEnv({ requireClientId: false });
  }

  logger.info('Connecting to PostgreSQL and verifying schema...');
  try {
    await runMigrations();
  } catch (err) {
    if (isDevStandbyEligible) {
      standbyState = {
        standby: true,
        standbyReason: `PostgreSQL unavailable (${err.message}). Start PostgreSQL or run via Docker Compose.`,
      };
      logger.warn({ err: err.message }, standbyState.standbyReason);
      return;
    }
    throw err;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.commands = new Collection();

  // Load slash commands
  const commandsDir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsDir)) {
    if (!file.endsWith('.js')) continue;
    const command = require(path.join(commandsDir, file));
    if (command?.data?.name && typeof command.execute === 'function') {
      client.commands.set(command.data.name, command);
    }
  }

  // Load event listeners
  const eventsDir = path.join(__dirname, 'events');
  for (const file of fs.readdirSync(eventsDir)) {
    if (!file.endsWith('.js')) continue;
    const event = require(path.join(eventsDir, file));
    if (!event?.name || typeof event.execute !== 'function') continue;

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }

  client.on('error', (err) => {
    logger.error({ err: err.message }, 'Discord client error');
  });

  client.on('warn', (warning) => {
    logger.warn({ warning }, 'Discord client warning');
  });

  await client.login(config.discord.token);
}

bootstrap().catch(async (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Failed to start Discord Automatic TTS Bot');
  await db.close().catch(() => {});
  await closeHealthServer().catch(() => {});
  process.exit(1);
});
