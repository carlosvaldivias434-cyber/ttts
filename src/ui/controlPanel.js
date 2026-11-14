'use strict';

const {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');
const { config } = require('../config/env');
const {
  LANGUAGES,
  SPEED_PRESETS,
  getAllAvailableVoices,
  getLanguageLabel,
} = require('../config/voices');
const piperEngine = require('../tts/piperEngine');

const BLUE_ACCENT = 0x2563eb;

function truncateText(str, maxLen = 90) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

function buildControlPanel({
  client,
  guild,
  settings,
  voiceStatus,
  queueSnapshot,
  piperAvailable = piperEngine.isBinaryAvailable(),
}) {
  const isOnline = Boolean(client?.isReady?.());
  const pingMs = isOnline && Number.isFinite(client.ws?.ping) ? `${Math.round(client.ws.ping)}ms` : 'N/A';
  const avatarUrl =
    client?.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) ||
    'https://cdn.discordapp.com/embed/avatars/0.png';

  const botStatusText = isOnline ? `🟢 Online (${pingMs})` : '🔴 Offline';
  const autoTtsText = settings.ttsEnabled ? '🟢 Enabled' : '🔴 Disabled';

  let voiceConnText = '⚪ Disconnected';
  if (voiceStatus?.reconnecting) {
    voiceConnText = '🟡 Reconnecting...';
  } else if (voiceStatus?.isConnected && voiceStatus?.channelId) {
    voiceConnText = `🟢 <#${voiceStatus.channelId}>`;
  } else if (settings.voiceChannelId) {
    voiceConnText = `⚪ Disconnected (Target: <#${settings.voiceChannelId}>)`;
  }

  const textChannelText = settings.textChannelId
    ? `<#${settings.textChannelId}>`
    : '*Not configured*';

  const allVoices = getAllAvailableVoices(config.tts.modelsDir);
  const currentVoiceObj = allVoices.find((v) => v.id === settings.voiceModel);
  const voiceInstalledBadge = currentVoiceObj?.installed ? 'Installed' : 'Model missing';
  const currentVoiceText = currentVoiceObj
    ? `${currentVoiceObj.name} (\`${settings.voiceModel}\` • ${voiceInstalledBadge})`
    : `\`${settings.voiceModel}\``;

  const currentLangText = `${getLanguageLabel(settings.language)} (\`${settings.language}\`)`;

  let playbackText = '⏹️ Idle';
  if (queueSnapshot.isPaused) {
    playbackText = queueSnapshot.current
      ? `⏸️ Paused — **${queueSnapshot.current.authorName}**: "${truncateText(queueSnapshot.current.sanitizedText, 60)}"`
      : '⏸️ Paused';
  } else if (queueSnapshot.current) {
    playbackText = `🔊 Playing — **${queueSnapshot.current.authorName}**: "${truncateText(queueSnapshot.current.sanitizedText, 60)}"`;
  }

  const engineLine = piperAvailable ? 'Piper Local TTS (Ready)' : '⚠️ Piper binary not found';

  const headerSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `# 🎙️ Automatic TTS Control Panel`,
          `**${guild?.name || 'Discord Server'}** • Local Engine: \`${engineLine}\``,
          `Members can type normal messages in the configured text channel for automatic voice playback.`,
        ].join('\n')
      )
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(avatarUrl)
        .setDescription('Bot Avatar')
    );

  const telemetryDisplay = new TextDisplayBuilder().setContent(
    [
      `### System & Playback Status`,
      `• **Bot Status:** ${botStatusText}  |  **Automatic TTS:** ${autoTtsText}`,
      `• **Configured Text Channel:** ${textChannelText}`,
      `• **Connected Voice Channel:** ${voiceConnText}`,
      `• **Current Voice:** ${currentVoiceText}`,
      `• **Current Language:** ${currentLangText}`,
      `• **Speed / Volume / Max Length:** \`${Number(settings.speechSpeed).toFixed(2)}x\` • \`${settings.volume}%\` • \`${settings.maxMessageLength} chars\``,
      `• **Current Playback:** ${playbackText}`,
      `• **Queue Length:** \`${queueSnapshot.queueLength}\` pending  |  **Total Messages Read:** \`${settings.totalMessagesRead.toLocaleString()}\``,
    ].join('\n')
  );

  const filtersSummarySection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Safety & Filters:** Ignored Roles: \`${settings.ignoredRoles.length}\` • Ignored Channels: \`${settings.ignoredChannels.length}\` • Rate Limit: \`${(settings.rateLimitMs / 1000).toFixed(1)}s\` • Auto-Connect: \`${settings.autoConnect ? 'ON' : 'OFF'}\``,
        ].join('\n')
      )
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId('tts:panel:filters')
        .setLabel('Manage Filters')
        .setStyle(ButtonStyle.Secondary)
    );

  // Action Row 1: Power & Voice Connection Controls
  const rowPower = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tts:btn:enable')
      .setLabel('Enable Auto TTS')
      .setStyle(ButtonStyle.Success)
      .setDisabled(settings.ttsEnabled),
    new ButtonBuilder()
      .setCustomId('tts:btn:disable')
      .setLabel('Disable Auto TTS')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!settings.ttsEnabled),
    new ButtonBuilder()
      .setCustomId('tts:btn:connect')
      .setLabel('Connect Voice')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!settings.voiceChannelId),
    new ButtonBuilder()
      .setCustomId('tts:btn:disconnect')
      .setLabel('Disconnect')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!voiceStatus?.isConnected && !voiceStatus?.reconnecting),
    new ButtonBuilder()
      .setCustomId('tts:btn:refresh')
      .setLabel('Refresh Panel')
      .setStyle(ButtonStyle.Secondary)
  );

  // Action Row 2: Playback & Queue Controls + Modal Trigger
  const rowPlayback = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tts:btn:pause')
      .setLabel('Pause')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(queueSnapshot.isPaused),
    new ButtonBuilder()
      .setCustomId('tts:btn:resume')
      .setLabel('Resume')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!queueSnapshot.isPaused),
    new ButtonBuilder()
      .setCustomId('tts:btn:skip')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!queueSnapshot.current && queueSnapshot.queueLength === 0),
    new ButtonBuilder()
      .setCustomId('tts:btn:clear')
      .setLabel('Clear Queue')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!queueSnapshot.current && queueSnapshot.queueLength === 0),
    new ButtonBuilder()
      .setCustomId('tts:btn:advanced')
      .setLabel('Advanced Settings')
      .setStyle(ButtonStyle.Primary)
  );

  // Dropdown 1: Select TTS Text Channel
  const textChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('tts:select:text_channel')
    .setPlaceholder('Select Automatic TTS Text Channel...')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (settings.textChannelId) {
    textChannelSelect.setDefaultChannels(settings.textChannelId);
  }
  const rowTextChannel = new ActionRowBuilder().addComponents(textChannelSelect);

  // Dropdown 2: Select Voice Channel
  const voiceChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('tts:select:voice_channel')
    .setPlaceholder('Select Target Voice Channel...')
    .setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    .setMinValues(1)
    .setMaxValues(1);
  if (settings.voiceChannelId) {
    voiceChannelSelect.setDefaultChannels(settings.voiceChannelId);
  }
  const rowVoiceChannel = new ActionRowBuilder().addComponents(voiceChannelSelect);

  // Dropdown 3: Select Voice Model (max 25 options)
  const voiceOptions = allVoices.slice(0, 25).map((voice) => ({
    label: truncateText(`${voice.name}`, 100),
    value: voice.id,
    description: truncateText(
      `${voice.language} • ${voice.installed ? 'Installed locally' : 'Needs model download'}`,
      100
    ),
    default: voice.id === settings.voiceModel,
  }));
  const rowVoiceModel = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tts:select:voice_model')
      .setPlaceholder('Select Piper Voice Model...')
      .addOptions(voiceOptions)
  );

  // Dropdown 4: Select Language
  const languageOptions = LANGUAGES.map((lang) => ({
    label: lang.label,
    value: lang.code,
    description: lang.description,
    default: lang.code === settings.language,
  }));
  const rowLanguage = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tts:select:language')
      .setPlaceholder('Select TTS Language...')
      .addOptions(languageOptions)
  );

  // Dropdown 5: Select Speech Speed
  const currentSpeedStr = Number(settings.speechSpeed).toFixed(2);
  const speedList = [...SPEED_PRESETS];
  if (!speedList.some((p) => p.value === currentSpeedStr)) {
    speedList.push({
      value: currentSpeedStr,
      label: `${currentSpeedStr}x — Custom Speed`,
      speed: Number(settings.speechSpeed),
    });
    speedList.sort((a, b) => a.speed - b.speed);
  }

  const speedOptions = speedList.slice(0, 25).map((preset) => ({
    label: preset.label,
    value: preset.value,
    default: preset.value === currentSpeedStr,
  }));
  const rowSpeed = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tts:select:speed')
      .setPlaceholder('Select Speech Speed...')
      .addOptions(speedOptions)
  );

  const container = new ContainerBuilder()
    .setAccentColor(BLUE_ACCENT)
    .addSectionComponents(headerSection)
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(telemetryDisplay)
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addSectionComponents(filtersSummarySection)
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(rowPower, rowPlayback)
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      rowTextChannel,
      rowVoiceChannel,
      rowVoiceModel,
      rowLanguage,
      rowSpeed
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = {
  buildControlPanel,
  BLUE_ACCENT,
};
