'use strict';

const { Events, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { config } = require('../config/env');
const { findVoiceById, findVoicesByLanguage } = require('../config/voices');
const guildRepo = require('../db/guildRepository');
const voiceManager = require('../voice/voiceManager');
const queueManager = require('../tts/queueManager');
const { buildGuildPanelPayload, refreshPersistedPanel } = require('../ui/panelUpdater');
const { buildNoticeContainer, buildFiltersPanel } = require('../ui/settingsPanel');
const { buildAdvancedSettingsModal } = require('../ui/modals');
const logger = require('../logger').child({ module: 'event-interactionCreate' });

function isGuildAdmin(interaction) {
  if (!interaction.inGuild() || !interaction.memberPermissions) return false;
  return interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
}

async function sendPermissionDenied(interaction) {
  const payload = {
    ...buildNoticeContainer({
      title: '🔒 Administrator Permission Required',
      message: 'Only server administrators can configure or control Automatic TTS.',
      accentColor: 0xef4444,
    }),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}

async function handleButtonInteraction(interaction) {
  const { guild, client, customId } = interaction;

  if (customId === 'tts:btn:advanced') {
    const settings = await guildRepo.getOrCreateSettings(guild.id);
    const modal = buildAdvancedSettingsModal(settings);
    await interaction.showModal(modal);
    return;
  }

  if (customId === 'tts:panel:filters') {
    const settings = await guildRepo.getOrCreateSettings(guild.id);
    await interaction.reply({
      ...buildFiltersPanel({ guild, settings }),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  // Filters sub-panel buttons (ephemeral message update)
  if (
    customId === 'tts:btn:toggle_autoconnect' ||
    customId === 'tts:btn:toggle_announce' ||
    customId === 'tts:btn:clear_filters'
  ) {
    await interaction.deferUpdate();
    const current = await guildRepo.getOrCreateSettings(guild.id);
    let patch = {};
    if (customId === 'tts:btn:toggle_autoconnect') {
      patch = { autoConnect: !current.autoConnect };
    } else if (customId === 'tts:btn:toggle_announce') {
      patch = { announceAuthor: !current.announceAuthor };
    } else if (customId === 'tts:btn:clear_filters') {
      patch = { ignoredRoles: [], ignoredChannels: [] };
    }

    const updated = await guildRepo.updateSettings(guild.id, patch);
    await interaction.editReply(buildFiltersPanel({ guild, settings: updated }));
    await refreshPersistedPanel(client, guild.id);
    return;
  }

  // Main Control Panel buttons
  await interaction.deferUpdate();

  let settings = await guildRepo.getOrCreateSettings(guild.id);

  if (customId === 'tts:btn:enable') {
    if (!settings.textChannelId || !settings.voiceChannelId) {
      await interaction.followUp({
        ...buildNoticeContainer({
          title: '⚠️ Select Channels First',
          message:
            'Please choose both a TTS text channel and a voice channel using the dropdowns below before enabling.',
          accentColor: 0xf59e0b,
        }),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    settings = await guildRepo.updateSettings(guild.id, { ttsEnabled: true });
    try {
      await voiceManager.connect(guild, settings.voiceChannelId);
    } catch (err) {
      await interaction.followUp({
        ...buildNoticeContainer({
          title: '⚠️ Enabled With Voice Warning',
          message: `Automatic TTS is enabled, but connecting to <#${settings.voiceChannelId}> failed: ${err.message}`,
          accentColor: 0xf59e0b,
        }),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
  } else if (customId === 'tts:btn:disable') {
    await guildRepo.updateSettings(guild.id, { ttsEnabled: false });
  } else if (customId === 'tts:btn:connect') {
    if (!settings.voiceChannelId) {
      await interaction.followUp({
        ...buildNoticeContainer({
          title: '⚠️ No Voice Channel Selected',
          message: 'Please select a target voice channel from the dropdown first.',
          accentColor: 0xf59e0b,
        }),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await voiceManager.connect(guild, settings.voiceChannelId);
    } catch (err) {
      await interaction.followUp({
        ...buildNoticeContainer({
          title: '❌ Voice Connection Failed',
          message: err.message,
          accentColor: 0xef4444,
        }),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
  } else if (customId === 'tts:btn:disconnect') {
    voiceManager.disconnect(guild.id);
  } else if (customId === 'tts:btn:pause') {
    queueManager.pause(guild.id);
  } else if (customId === 'tts:btn:resume') {
    queueManager.resume(guild);
  } else if (customId === 'tts:btn:skip') {
    queueManager.skip(guild.id);
  } else if (customId === 'tts:btn:clear') {
    await queueManager.clear(guild.id);
  } else if (customId === 'tts:btn:refresh') {
    guildRepo.invalidateCache(guild.id);
  }

  const payload = await buildGuildPanelPayload(client, guild);
  await interaction.editReply(payload);
}

async function handleSelectMenuInteraction(interaction) {
  const { guild, client, customId, values } = interaction;
  await interaction.deferUpdate();

  // Filters sub-panel select menus
  if (customId === 'tts:select:ignored_roles' || customId === 'tts:select:ignored_channels') {
    const patch =
      customId === 'tts:select:ignored_roles'
        ? { ignoredRoles: values }
        : { ignoredChannels: values };
    const updated = await guildRepo.updateSettings(guild.id, patch);
    await interaction.editReply(buildFiltersPanel({ guild, settings: updated }));
    await refreshPersistedPanel(client, guild.id);
    return;
  }

  // Main Control Panel dropdowns
  if (customId === 'tts:select:text_channel') {
    const channelId = values[0];
    await guildRepo.updateSettings(guild.id, { textChannelId: channelId });
  } else if (customId === 'tts:select:voice_channel') {
    const voiceChannelId = values[0];
    const prevSettings = await guildRepo.getOrCreateSettings(guild.id);
    await guildRepo.updateSettings(guild.id, { voiceChannelId });

    // If already connected or auto-TTS enabled, move to newly selected voice channel
    const voiceStatus = voiceManager.getStatus(guild.id);
    if (voiceStatus.isConnected || prevSettings.ttsEnabled) {
      try {
        await voiceManager.connect(guild, voiceChannelId);
      } catch (err) {
        await interaction.followUp({
          ...buildNoticeContainer({
            title: '⚠️ Voice Channel Saved, Join Failed',
            message: err.message,
            accentColor: 0xf59e0b,
          }),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }
    }
  } else if (customId === 'tts:select:voice_model') {
    const modelId = values[0];
    const voice = findVoiceById(modelId, config.tts.modelsDir);
    const patch = { voiceModel: modelId };
    if (voice && voice.language && voice.language !== 'custom') {
      patch.language = voice.language;
    }
    await guildRepo.updateSettings(guild.id, patch);

    if (voice && !voice.installed) {
      await interaction.followUp({
        ...buildNoticeContainer({
          title: '⚠️ Voice Model Not Downloaded Locally',
          message: `Selected \`${voice.id}\`, but \`${voice.id}.onnx\` is not yet in \`${config.tts.modelsDir}\`. Run the voice download script; until then, playback will fall back to an installed model.`,
          accentColor: 0xf59e0b,
        }),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
  } else if (customId === 'tts:select:language') {
    const langCode = values[0];
    const matching = findVoicesByLanguage(langCode, config.tts.modelsDir);
    const preferred = matching.find((v) => v.installed) || matching[0] || null;
    const patch = { language: langCode };
    if (preferred) {
      patch.voiceModel = preferred.id;
    }
    await guildRepo.updateSettings(guild.id, patch);
  } else if (customId === 'tts:select:speed') {
    const parsedSpeed = Number.parseFloat(values[0]);
    if (!Number.isNaN(parsedSpeed)) {
      const clamped = Math.round(Math.min(2.0, Math.max(0.5, parsedSpeed)) * 100) / 100;
      await guildRepo.updateSettings(guild.id, { speechSpeed: clamped });
    }
  }

  const payload = await buildGuildPanelPayload(client, guild);
  await interaction.editReply(payload);
}

async function handleModalSubmit(interaction) {
  if (interaction.customId !== 'tts:modal:advanced_settings') return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rawMaxLen = interaction.fields.getTextInputValue('max_message_length').trim();
  const rawVolume = interaction.fields.getTextInputValue('volume').trim();
  const rawSpeed = interaction.fields.getTextInputValue('speech_speed').trim();
  const rawRateLimit = interaction.fields.getTextInputValue('rate_limit_ms').trim();

  const maxMessageLength = Number.parseInt(rawMaxLen, 10);
  const volume = Number.parseInt(rawVolume, 10);
  const speechSpeed = Number.parseFloat(rawSpeed);
  const rateLimitMs = Number.parseInt(rawRateLimit, 10);

  const errors = [];
  if (Number.isNaN(maxMessageLength) || maxMessageLength < 20 || maxMessageLength > 2000) {
    errors.push('• Max Message Length must be an integer between `20` and `2000`.');
  }
  if (Number.isNaN(volume) || volume < 10 || volume > 200) {
    errors.push('• Volume must be an integer between `10` and `200`.');
  }
  if (Number.isNaN(speechSpeed) || speechSpeed < 0.5 || speechSpeed > 2.0) {
    errors.push('• Speech Speed must be a number between `0.50` and `2.00`.');
  }
  if (Number.isNaN(rateLimitMs) || rateLimitMs < 0 || rateLimitMs > 60000) {
    errors.push('• Rate Limit must be an integer between `0` and `60000` milliseconds.');
  }

  if (errors.length > 0) {
    await interaction.editReply(
      buildNoticeContainer({
        title: '⚠️ Invalid Settings Input',
        message: errors.join('\n'),
        accentColor: 0xef4444,
      })
    );
    return;
  }

  const normalizedSpeed = Math.round(speechSpeed * 100) / 100;
  await guildRepo.updateSettings(interaction.guild.id, {
    maxMessageLength,
    volume,
    speechSpeed: normalizedSpeed,
    rateLimitMs,
  });

  await refreshPersistedPanel(interaction.client, interaction.guild.id);

  await interaction.editReply(
    buildNoticeContainer({
      title: '✅ Advanced Settings Saved',
      message: [
        `• **Max Message Length:** \`${maxMessageLength}\` characters`,
        `• **Playback Volume:** \`${volume}%\``,
        `• **Speech Speed:** \`${normalizedSpeed.toFixed(2)}x\``,
        `• **Per-User Rate Limit:** \`${rateLimitMs}ms\``,
      ].join('\n'),
    })
  );
}

module.exports = {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction) {
    try {
      if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (command?.autocomplete) {
          await command.autocomplete(interaction);
        }
        return;
      }

      if (!interaction.inGuild() || !interaction.guild) {
        if (interaction.isRepliable()) {
          await interaction.reply({
            ...buildNoticeContainer({
              title: '⚠️ Server Only',
              message: 'TTS configuration commands are only available inside Discord servers.',
              accentColor: 0xf59e0b,
            }),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          });
        }
        return;
      }

      if (!isGuildAdmin(interaction)) {
        await sendPermissionDenied(interaction);
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
        return;
      }

      if (interaction.isAnySelectMenu()) {
        await handleSelectMenuInteraction(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
      }
    } catch (err) {
      logger.error(
        {
          err: err.message,
          stack: err.stack,
          guildId: interaction.guildId,
          customId: interaction.customId || interaction.commandName,
        },
        'Error processing Discord interaction'
      );

      if (interaction.isRepliable()) {
        const errPayload = {
          ...buildNoticeContainer({
            title: '❌ Action Failed',
            message: err.message || 'An unexpected error occurred while processing that action.',
            accentColor: 0xef4444,
          }),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        };

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(errPayload).catch(() => {});
        } else {
          await interaction.reply(errPayload).catch(() => {});
        }
      }
    }
  },
};
