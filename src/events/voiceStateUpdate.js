'use strict';

const { Events } = require('discord.js');
const voiceManager = require('../voice/voiceManager');

module.exports = {
  name: Events.VoiceStateUpdate,
  once: false,
  async execute(oldState, newState) {
    const botId = oldState.client.user?.id;
    if (!botId || oldState.id !== botId) return;

    if (oldState.channelId !== newState.channelId) {
      voiceManager.handleChannelMoved(newState.guild, newState.channelId);
    }
  },
};
