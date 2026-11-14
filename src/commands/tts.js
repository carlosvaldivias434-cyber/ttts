'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const { config } = require('../config/env');
const {
  LANGUAGES,
  getAllAvailableVoices,
  findVoiceById,
  findVoicesByLanguage,
  getLanguageLabel,
} = require('../config/voices');
const guildRepo = require('../db/guildRepository');
const voiceManager = require('../voice/voiceManager');
const queueManager = require('../tts/queueManager');
const { buildGuildPanelPayload, refreshPersistedPanel } = require('../ui/panelUpdater');
const {
  buildNoticeContainer,
  buildQueueView,
  buildSettingsView,
  buildStatisticsView,
} = require('../ui/settingsPanel');

const data = new SlashCommandBuilder()
  .setName('tts')
  .setDescription('Configure and manage automatic local Text-to-Speech')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Configure the automatic TTS text channel and voice channel')
      .addChannelOption((opt) =>
        opt
          .setName('text_channel')
          .setDescription('Text channel whose messages are automatically read aloud')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName('voice_channel')
          .setDescription('Voice channel where the bot speaks')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(true)
      )
      .addBooleanOption((opt) =>
        opt
          .setName('enable_now')
          .setDescription('Enable automatic TTS and connect to voice immediately (default: true)')
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName('auto_connect')
          .setDescription('Automatically join the voice channel when a message arrives')
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('panel')
      .setDescription('Post the interactive Discord Components V2 TTS Control Panel')
  )
  .addSubcommand((sub) =>
    sub
      .setName('enable')
      .setDescription('Enable automatic reading in the configured TTS text channel')
  )
  .addSubcommand((sub) =>
    sub
      .setName('disable')
      .setDescription('Disable automatic reading in the configured TTS text channel')
  )
  .addSubcommand((sub) =>
    sub
      .setName('connect')
      .setDescription('Connect the bot to the configured voice channel')
      .addChannelOption((opt) =>
        opt
          .setName('voice_channel')
          .setDescription('Optional voice channel to set and join')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('disconnect').setDescription('Disconnect the bot from the voice channel')
  )
  .addSubcommand((sub) =>
    sub
      .setName('settings')
      .setDescription('View or update TTS configuration and safety filters')
      .addIntegerOption((opt) =>
        opt
          .setName('volume')
          .setDescription('Speech volume percentage (10 - 200)')
          .setMinValue(10)
          .setMaxValue(200)
          .setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('max_length')
          .setDescription('Maximum message character length (20 - 2000)')
          .setMinValue(20)
          .setMaxValue(2000)
          .setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('rate_limit_ms')
          .setDescription('Per-user cooldown in milliseconds (0 - 60000)')
          .setMinValue(0)
          .setMaxValue(60000)
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName('announce_author')
          .setDescription('Prefix spoken messages with "<Username> says:"')
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName('auto_connect')
          .setDescription('Auto-join voice channel when eligible messages arrive')
          .setRequired(false)
      )
      .addRoleOption((opt) =>
        opt
          .setName('ignore_role')
          .setDescription('Add a role to the ignored roles list')
          .setRequired(false)
      )
      .addRoleOption((opt) =>
        opt
          .setName('unignore_role')
          .setDescription('Remove a role from the ignored roles list')
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName('ignore_channel')
          .setDescription('Add a channel to the ignored channels list')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName('unignore_channel')
          .setDescription('Remove a channel from the ignored channels list')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('voice')
      .setDescription('Select the local Piper TTS voice model')
      .addStringOption((opt) =>
        opt
          .setName('model')
          .setDescription('Piper voice model ID')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('language')
      .setDescription('Select the TTS language and matching voice')
      .addStringOption((opt) =>
        opt
          .setName('code')
          .setDescription('Language code')
          .setRequired(true)
          .addChoices(...LANGUAGES.map((l) => ({ name: l.label, value: l.code })))
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('speed')
      .setDescription('Set speech playback speed (0.50x - 2.00x)')
      .addNumberOption((opt) =>
        opt
          .setName('rate')
          .setDescription('Playback speed multiplier (default: 1.0)')
          .setMinValue(0.5)
          .setMaxValue(2.0)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('queue').setDescription('View currently playing and queued TTS messages')
  )
  .addSubcommand((sub) =>
    sub.setName('skip').setDescription('Skip the currently playing TTS message')
  )
  .addSubcommand((sub) =>
    sub.setName('clear').setDescription('Clear all pending messages from the TTS queue')
  )
  .addSubcommand((sub) =>
    sub.setName('statistics').setDescription('View server TTS usage statistics')
  );

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const voices = getAllAvailableVoices(config.tts.modelsDir);
  const filtered = voices
    .filter(
      (v) =>
        v.id.toLowerCase().includes(focused) ||
        v.name.toLowerCase().includes(focused) ||
        v.language.toLowerCase().includes(focused)
    )
    .slice(0, 25)
    .map((v) => ({
      name: `${v.name} [${v.language}]${v.installed ? ' ✓' : ' (Download needed)'}`.slice(0, 100),
      value: v.id,
    }));

  await interaction.respond(filtered);
}

async function execute(interaction) {
  const { guild, client } = interaction;
  const sub = interaction.options.getSubcommand();
  let settings = await guildRepo.getOrCreateSettings(guild.id);

  if (sub === 'panel') {
    await interaction.deferReply();
    const payload = await buildGuildPanelPayload(client, guild);
    const replyMsg = await interaction.editReply(payload);

    await guildRepo.updateSettings(guild.id, {
      panelChannelId: interaction.channelId,
      panelMessageId: replyMsg.id,
    });
    return;
  }

  if (sub === 'setup') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const textChannel = interaction.options.getChannel('text_channel', true);
    const voiceChannel = interaction.options.getChannel('voice_channel', true);
    const enableNow = interaction.options.getBoolean('enable_now') ?? true;
    const autoConnectOpt = interaction.options.getBoolean('auto_connect');

    const patch = {
      textChannelId: textChannel.id,
      voiceChannelId: voiceChannel.id,
      ttsEnabled: enableNow,
    };
    if (autoConnectOpt !== null) {
      patch.autoConnect = autoConnectOpt;
    }

    settings = await guildRepo.updateSettings(guild.id, patch);

    let connectNote = '';
    if (enableNow) {
      try {
        await voiceManager.connect(guild, voiceChannel.id);
        connectNote = `\n• Connected to <#${voiceChannel.id}> and ready to read messages automatically.`;
      } catch (err) {
        connectNote = `\n• ⚠️ Saved settings, but could not join <#${voiceChannel.id}>: ${err.message}`;
      }
    }

    await refreshPersistedPanel(client, guild.id);

    await interaction.editReply(
      buildNoticeContainer({
        title: '✅ Automatic TTS Configured',
        message: [
          `• **Text Channel:** <#${textChannel.id}>`,
          `• **Voice Channel:** <#${voiceChannel.id}>`,
          `• **Automatic TTS:** ${settings.ttsEnabled ? '🟢 Enabled' : '🔴 Disabled'}${connectNote}`,
        ].join('\n'),
      })
    );
    return;
  }

  if (sub === 'enable') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!settings.textChannelId || !settings.voiceChannelId) {
      await interaction.editReply(
        buildNoticeContainer({
          title: '⚠️ Configuration Required',
          message:
            'Please set both a TTS text channel and voice channel first using `/tts setup` or the `/tts panel` dropdowns.',
          accentColor: 0xf59e0b,
        })
      );
      return;
    }

    settings = await guildRepo.updateSettings(guild.id, { ttsEnabled: true });

    let voiceNote = '';
    try {
      await voiceManager.connect(guild, settings.voiceChannelId);
      voiceNote = `\nConnected to <#${settings.voiceChannelId}>.`;
    } catch (err) {
      voiceNote = `\n⚠️ Auto-TTS enabled, but voice join failed: ${err.message}`;
    }

    await refreshPersistedPanel(client, guild.id);
    await interaction.editReply(
      buildNoticeContainer({
        title: '🟢 Automatic TTS Enabled',
        message: `Messages typed in <#${settings.textChannelId}> will now be read aloud automatically.${voiceNote}`,
      })
    );
    return;
  }

  if (sub === 'disable') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    settings = await guildRepo.updateSettings(guild.id, { ttsEnabled: false });
    await refreshPersistedPanel(client, guild.id);

    await interaction.editReply(
      buildNoticeContainer({
        title: '🔴 Automatic TTS Disabled',
        message: 'Automatic message reading has been paused for this server.',
      })
    );
    return;
  }

  if (sub === 'connect') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const chosenVoice = interaction.options.getChannel('voice_channel');
    if (chosenVoice) {
      settings = await guildRepo.updateSettings(guild.id, { voiceChannelId: chosenVoice.id });
    }

    if (!settings.voiceChannelId) {
      await interaction.editReply(
        buildNoticeContainer({
          title: '⚠️ No Voice Channel Configured',
          message: 'Select a voice channel in `/tts setup` or pass one to `/tts connect`.',
          accentColor: 0xf59e0b,
        })
      );
      return;
    }

    await voiceManager.connect(guild, settings.voiceChannelId);
    await refreshPersistedPanel(client, guild.id);

    await interaction.editReply(
      buildNoticeContainer({
        title: '🔊 Connected to Voice',
        message: `Joined <#${settings.voiceChannelId}>.`,
      })
    );
    return;
  }

  if (sub === 'disconnect') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    voiceManager.disconnect(guild.id);
    await refreshPersistedPanel(client, guild.id);

    await interaction.editReply(
      buildNoticeContainer({
        title: '🔌 Disconnected',
        message: 'Left the voice channel cleanly.',
      })
    );
    return;
  }

  if (sub === 'settings') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const volume = interaction.options.getInteger('volume');
    const maxLength = interaction.options.getInteger('max_length');
    const rateLimitMs = interaction.options.getInteger('rate_limit_ms');
    const announceAuthor = interaction.options.getBoolean('announce_author');
    const autoConnect = interaction.options.getBoolean('auto_connect');
    const ignoreRole = interaction.options.getRole('ignore_role');
    const unignoreRole = interaction.options.getRole('unignore_role');
    const ignoreChannel = interaction.options.getChannel('ignore_channel');
    const unignoreChannel = interaction.options.getChannel('unignore_channel');

    const patch = {};
    if (volume !== null) patch.volume = volume;
    if (maxLength !== null) patch.maxMessageLength = maxLength;
    if (rateLimitMs !== null) patch.rateLimitMs = rateLimitMs;
    if (announceAuthor !== null) patch.announceAuthor = announceAuthor;
    if (autoConnect !== null) patch.autoConnect = autoConnect;

    if (ignoreRole || unignoreRole) {
      const roles = new Set(settings.ignoredRoles);
      if (ignoreRole) roles.add(ignoreRole.id);
      if (unignoreRole) roles.delete(unignoreRole.id);
      patch.ignoredRoles = [...roles];
    }

    if (ignoreChannel || unignoreChannel) {
      const channels = new Set(settings.ignoredChannels);
      if (ignoreChannel) channels.add(ignoreChannel.id);
      if (unignoreChannel) channels.delete(unignoreChannel.id);
      patch.ignoredChannels = [...channels];
    }

    if (Object.keys(patch).length > 0) {
      settings = await guildRepo.updateSettings(guild.id, patch);
      await refreshPersistedPanel(client, guild.id);
    }

    const voiceStatus = voiceManager.getStatus(guild.id);
    await interaction.editReply(buildSettingsView({ guild, settings, voiceStatus }));
    return;
  }

  if (sub === 'voice') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const modelId = interaction.options.getString('model', true);
    const voice = findVoiceById(modelId, config.tts.modelsDir);

    if (!voice) {
      await interaction.editReply(
        buildNoticeContainer({
          title: '⚠️ Unknown Voice Model',
          message: `Voice model \`${modelId}\` was not found in the catalog or \`${config.tts.modelsDir}\`.`,
          accentColor: 0xf59e0b,
        })
      );
      return;
    }

    const patch = { voiceModel: voice.id };
    if (voice.language && voice.language !== 'custom') {
      patch.language = voice.language;
    }

    settings = await guildRepo.updateSettings(guild.id, patch);
    await refreshPersistedPanel(client, guild.id);

    const statusWarning = voice.installed
      ? ''
      : `\n⚠️ Model file \`${voice.id}.onnx\` is not downloaded yet in \`${config.tts.modelsDir}\`. Run the voice download script to install it.`;

    await interaction.editReply(
      buildNoticeContainer({
        title: '🗣️ Voice Model Updated',
        message: `Selected **${voice.name}** (\`${voice.id}\` • ${getLanguageLabel(settings.language)}).${statusWarning}`,
      })
    );
    return;
  }

  if (sub === 'language') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const code = interaction.options.getString('code', true);
    const matchingVoices = findVoicesByLanguage(code, config.tts.modelsDir);
    const preferredVoice =
      matchingVoices.find((v) => v.installed) || matchingVoices[0] || null;

    const patch = { language: code };
    if (preferredVoice) {
      patch.voiceModel = preferredVoice.id;
    }

    settings = await guildRepo.updateSettings(guild.id, patch);
    await refreshPersistedPanel(client, guild.id);

    await interaction.editReply(
      buildNoticeContainer({
        title: '🌐 Language Updated',
        message: [
          `• **Language:** ${getLanguageLabel(code)} (\`${code}\`)`,
          preferredVoice
            ? `• **Voice Model:** ${preferredVoice.name} (\`${preferredVoice.id}\`)`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      })
    );
    return;
  }

  if (sub === 'speed') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const rate = interaction.options.getNumber('rate', true);
    const clamped = Math.round(Math.min(2.0, Math.max(0.5, rate)) * 100) / 100;

    settings = await guildRepo.updateSettings(guild.id, { speechSpeed: clamped });
    await refreshPersistedPanel(client, guild.id);

    await interaction.editReply(
      buildNoticeContainer({
        title: '⏩ Speech Speed Updated',
        message: `Speech playback speed set to \`${clamped.toFixed(2)}x\`.`,
      })
    );
    return;
  }

  if (sub === 'queue') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const queueSnapshot = queueManager.getQueueSnapshot(guild.id);
    await interaction.editReply(buildQueueView({ guild, queueSnapshot }));
    return;
  }

  if (sub === 'skip') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const skipped = queueManager.skip(guild.id);
    await refreshPersistedPanel(client, guild.id);

    await interaction.editReply(
      buildNoticeContainer({
        title: skipped ? '⏭️ Skipped Current Message' : 'ℹ️ Nothing to Skip',
        message: skipped
          ? 'Skipped the active TTS message and moved to the next item.'
          : 'There is no active or queued TTS message to skip.',
      })
    );
    return;
  }

  if (sub === 'clear') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const count = await queueManager.clear(guild.id);
    await refreshPersistedPanel(client, guild.id);

    await interaction.editReply(
      buildNoticeContainer({
        title: '🧹 Queue Cleared',
        message: `Removed \`${count}\` message(s) from the TTS queue.`,
      })
    );
    return;
  }

  if (sub === 'statistics') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const stats = await guildRepo.getGuildStatistics(guild.id);
    await interaction.editReply(buildStatisticsView({ guild, stats }));
  }
}

module.exports = {
  data,
  autocomplete,
  execute,
};
