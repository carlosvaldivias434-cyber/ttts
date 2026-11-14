'use strict';

const { Events } = require('discord.js');
const queueManager = require('../tts/queueManager');
const logger = require('../logger').child({ module: 'event-messageDelete' });

module.exports = {
  name: Events.MessageDelete,
  once: false,
  async execute(message) {
    try {
      if (!message.guildId || !message.id) return;
      await queueManager.removeByMessageId(message.guildId, message.id);
    } catch (err) {
      logger.debug({ err: err.message, messageId: message.id }, 'Error handling messageDelete');
    }
  },
};
