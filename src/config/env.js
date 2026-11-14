'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ quiet: true });

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseIntClamped(value, fallback, min, max) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function parseFloatClamped(value, fallback, min, max) {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

const defaultPiperBin =
  process.platform === 'win32'
    ? path.resolve(process.cwd(), 'bin', 'piper', 'piper.exe')
    : path.resolve(process.cwd(), 'bin', 'piper', 'piper');

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  port: parseIntClamped(process.env.PORT, 3000, 1, 65535),

  discord: {
    token: (process.env.DISCORD_TOKEN || '').trim(),
    clientId: (process.env.DISCORD_CLIENT_ID || '').trim(),
    guildId: (process.env.DISCORD_GUILD_ID || '').trim(),
    autoDeployCommands: parseBoolean(process.env.AUTO_DEPLOY_COMMANDS, true),
  },

  db: {
    connectionString: (process.env.DATABASE_URL || '').trim(),
    host: process.env.PGHOST || 'localhost',
    port: parseIntClamped(process.env.PGPORT, 5432, 1, 65535),
    user: process.env.PGUSER || 'ttsbot',
    password: process.env.PGPASSWORD || 'ttsbot_secure_password',
    database: process.env.PGDATABASE || 'discord_tts',
    ssl: parseBoolean(process.env.PGSSL, false),
    maxPoolSize: parseIntClamped(process.env.PG_POOL_MAX, 10, 1, 50),
  },

  tts: {
    piperBinPath: (process.env.PIPER_BIN_PATH || defaultPiperBin).trim(),
    modelsDir: path.resolve(process.cwd(), process.env.PIPER_MODELS_DIR || './models/piper'),
    tempDir: path.resolve(process.cwd(), process.env.TTS_TEMP_DIR || './tmp/tts'),
    ffmpegPath: (process.env.FFMPEG_PATH || '').trim(),
    defaultVoiceModel: process.env.DEFAULT_VOICE_MODEL || 'en_US-lessac-medium',
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'en_US',
    defaultSpeechSpeed: parseFloatClamped(process.env.DEFAULT_SPEECH_SPEED, 1.0, 0.5, 2.0),
    defaultVolume: parseIntClamped(process.env.DEFAULT_VOLUME, 100, 10, 200),
    defaultMaxMessageLength: parseIntClamped(process.env.DEFAULT_MAX_MESSAGE_LENGTH, 300, 20, 2000),
    piperTimeoutMs: parseIntClamped(process.env.PIPER_TIMEOUT_MS, 20000, 3000, 120000),
  },

  queue: {
    maxQueueSize: parseIntClamped(process.env.MAX_QUEUE_SIZE, 50, 5, 500),
    userRateLimitMs: parseIntClamped(process.env.USER_RATE_LIMIT_MS, 2500, 0, 60000),
    duplicateCooldownMs: parseIntClamped(process.env.DUPLICATE_COOLDOWN_MS, 15000, 0, 300000),
    voiceReconnectMaxAttempts: parseIntClamped(process.env.VOICE_RECONNECT_MAX_ATTEMPTS, 6, 1, 20),
  },
};

function validateRequiredDiscordEnv({ requireClientId = false } = {}) {
  const missing = [];
  if (!config.discord.token) missing.push('DISCORD_TOKEN');
  if (requireClientId && !config.discord.clientId) missing.push('DISCORD_CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. Copy .env.example to .env and configure them.`
    );
  }
}

module.exports = {
  config,
  validateRequiredDiscordEnv,
};
