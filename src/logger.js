'use strict';

const pino = require('pino');
const { config } = require('./config/env');

const logger = pino({
  level: config.logLevel,
  base: {
    service: 'discord-auto-tts-bot',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['token', 'password', 'connectionString', '*.token', '*.password'],
    remove: true,
  },
});

module.exports = logger;
