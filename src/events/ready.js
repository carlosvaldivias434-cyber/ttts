'use strict';

const { Events, ActivityType } = require('discord.js');
const { config } = require('../config/env');
const { getInstalledModels } = require('../config/voices');
const { deployCommands } = require('../deploy-commands');
const piperEngine = require('../tts/piperEngine');
const queueManager = require('../tts/queueManager');
const voiceManager = require('../voice/voiceManager');
const { refreshPersistedPanel } = require('../ui/panelUpdater');
const logger = require('../logger').child({ module: 'event-ready' });

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(
      {
        tag: client.user.tag,
        userId: client.user.id,
        guildCount: client.guilds.cache.size,
        piperBinaryAvailable: piperEngine.isBinaryAvailable(),
        installedModels: [...getInstalledModels(config.tts.modelsDir)],
      },
      'Discord Automatic TTS Bot is online'
    );

    client.user.setPresence({
      activities: [
        {
          name: 'automatic TTS channels',
          type: ActivityType.Listening,
        },
      ],
      status: 'online',
    });

    queueManager.setClient(client);
    queueManager.setPanelRefreshHandler((guildId) => refreshPersistedPanel(client, guildId));
    voiceManager.onStateChange((guildId) => {
      refreshPersistedPanel(client, guildId).catch((err) => {
        logger.debug({ err: err.message, guildId }, 'Panel refresh on voice state change failed');
      });
    });

    if (config.discord.autoDeployCommands && config.discord.clientId) {
      try {
        await deployCommands();
      } catch (err) {
        logger.error({ err: err.message }, 'Automatic slash command deployment failed');
      }
    }

    await piperEngine.cleanupStaleTempFiles();
    await queueManager.restorePersistedQueues(client);
  },
};
