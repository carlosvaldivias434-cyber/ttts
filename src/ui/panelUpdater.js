'use strict';

const guildRepo = require('../db/guildRepository');
const voiceManager = require('../voice/voiceManager');
const queueManager = require('../tts/queueManager');
const { buildControlPanel } = require('./controlPanel');
const logger = require('../logger').child({ module: 'panel-updater' });

async function buildGuildPanelPayload(client, guild) {
  const settings = await guildRepo.getOrCreateSettings(guild.id);
  const voiceStatus = voiceManager.getStatus(guild.id);
  const queueSnapshot = queueManager.getQueueSnapshot(guild.id);

  return buildControlPanel({
    client,
    guild,
    settings,
    voiceStatus,
    queueSnapshot,
  });
}

async function refreshPersistedPanel(client, guildId) {
  if (!client || !client.isReady()) return false;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;

  const settings = await guildRepo.getOrCreateSettings(guildId);
  if (!settings.panelChannelId || !settings.panelMessageId) return false;

  const channel =
    guild.channels.cache.get(settings.panelChannelId) ||
    (await guild.channels.fetch(settings.panelChannelId).catch(() => null));

  if (!channel || !channel.isTextBased()) {
    await guildRepo.updateSettings(guildId, {
      panelChannelId: null,
      panelMessageId: null,
    });
    return false;
  }

  const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
  if (!message) {
    await guildRepo.updateSettings(guildId, {
      panelChannelId: null,
      panelMessageId: null,
    });
    return false;
  }

  const payload = await buildGuildPanelPayload(client, guild);
  await message.edit(payload);
  return true;
}

module.exports = {
  buildGuildPanelPayload,
  refreshPersistedPanel,
};
