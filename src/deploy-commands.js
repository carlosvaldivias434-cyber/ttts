'use strict';

const { REST, Routes } = require('discord.js');
const { config, validateRequiredDiscordEnv } = require('./config/env');
const ttsCommand = require('./commands/tts');
const logger = require('./logger').child({ module: 'deploy-commands' });

async function deployCommands() {
  validateRequiredDiscordEnv({ requireClientId: true });

  const commands = [ttsCommand.data.toJSON()];
  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  if (config.discord.guildId) {
    logger.info({ guildId: config.discord.guildId }, 'Deploying slash commands to target guild');
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commands }
    );
    logger.info({ count: commands.length }, 'Guild slash commands deployed');
  } else {
    logger.info('Deploying slash commands globally');
    await rest.put(Routes.applicationCommands(config.discord.clientId), {
      body: commands,
    });
    logger.info({ count: commands.length }, 'Global slash commands deployed');
  }
}

if (require.main === module) {
  deployCommands()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err: err.message }, 'Slash command deployment failed');
      process.exit(1);
    });
}

module.exports = { deployCommands };
