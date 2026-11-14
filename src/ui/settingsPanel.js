'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');
const { getLanguageLabel, findVoiceById } = require('../config/voices');
const { config } = require('../config/env');
const { BLUE_ACCENT } = require('./controlPanel');

function buildNoticeContainer({ title, message, accentColor = BLUE_ACCENT }) {
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${title}\n${message}`)
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildQueueView({ guild, queueSnapshot }) {
  const lines = [];
  if (queueSnapshot.current) {
    const statusLabel = queueSnapshot.isPaused ? '⏸️ Paused' : '🔊 Now Playing';
    lines.push(
      `**${statusLabel}:** <@${queueSnapshot.current.authorId}> — "${queueSnapshot.current.sanitizedText}"`
    );
  } else {
    lines.push('**Now Playing:** *Nothing currently playing*');
  }

  lines.push('');

  if (queueSnapshot.items.length === 0) {
    lines.push('*The TTS message queue is currently empty.*');
  } else {
    lines.push(`**Up Next (${queueSnapshot.items.length}):**`);
    const preview = queueSnapshot.items.slice(0, 12);
    for (const item of preview) {
      const snippet =
        item.sanitizedText.length > 75
          ? `${item.sanitizedText.slice(0, 74)}…`
          : item.sanitizedText;
      lines.push(`\`${item.position}.\` <@${item.authorId}>: "${snippet}"`);
    }
    if (queueSnapshot.items.length > preview.length) {
      lines.push(`*...and ${queueSnapshot.items.length - preview.length} more message(s)*`);
    }
  }

  const container = new ContainerBuilder()
    .setAccentColor(BLUE_ACCENT)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## 📜 TTS Queue — ${guild.name}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildSettingsView({ guild, settings, voiceStatus }) {
  const voiceInfo = findVoiceById(settings.voiceModel, config.tts.modelsDir);
  const ignoredRolesText =
    settings.ignoredRoles.length > 0
      ? settings.ignoredRoles.map((id) => `<@&${id}>`).join(', ')
      : '*None*';
  const ignoredChannelsText =
    settings.ignoredChannels.length > 0
      ? settings.ignoredChannels.map((id) => `<#${id}>`).join(', ')
      : '*None*';

  const container = new ContainerBuilder()
    .setAccentColor(BLUE_ACCENT)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ⚙️ TTS Configuration — ${guild.name}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `• **Automatic TTS:** ${settings.ttsEnabled ? '🟢 Enabled' : '🔴 Disabled'}`,
          `• **TTS Text Channel:** ${settings.textChannelId ? `<#${settings.textChannelId}>` : '*Not set*'}`,
          `• **Target Voice Channel:** ${settings.voiceChannelId ? `<#${settings.voiceChannelId}>` : '*Not set*'}`,
          `• **Voice Connection:** ${voiceStatus?.isConnected ? `🟢 Connected (<#${voiceStatus.channelId}>)` : '⚪ Disconnected'}`,
          `• **Auto-Connect on Message:** ${settings.autoConnect ? 'ON' : 'OFF'}`,
          `• **Announce Author Name:** ${settings.announceAuthor ? 'ON' : 'OFF'}`,
          `• **Voice Model:** ${voiceInfo ? voiceInfo.name : settings.voiceModel} (\`${settings.voiceModel}\`)`,
          `• **Language:** ${getLanguageLabel(settings.language)} (\`${settings.language}\`)`,
          `• **Speech Speed:** \`${Number(settings.speechSpeed).toFixed(2)}x\``,
          `• **Volume:** \`${settings.volume}%\``,
          `• **Max Message Length:** \`${settings.maxMessageLength} characters\``,
          `• **Per-User Rate Limit:** \`${(settings.rateLimitMs / 1000).toFixed(1)}s\``,
          `• **Ignored Roles:** ${ignoredRolesText}`,
          `• **Ignored Channels:** ${ignoredChannelsText}`,
        ].join('\n')
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildStatisticsView({ guild, stats }) {
  const totalMinutes = (stats.totalDurationMs / 60000).toFixed(1);
  const topLines =
    stats.topSpeakers.length > 0
      ? stats.topSpeakers
          .map((s, idx) => `\`#${idx + 1}\` <@${s.authorId}> — **${s.count}** message(s)`)
          .join('\n')
      : '*No speech activity logged yet.*';

  const container = new ContainerBuilder()
    .setAccentColor(BLUE_ACCENT)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## 📊 TTS Usage Statistics — ${guild.name}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `• **Total Messages Read:** \`${stats.totalMessagesRead.toLocaleString()}\``,
          `• **Total Characters Spoken:** \`${stats.totalCharactersRead.toLocaleString()}\``,
          `• **Reads in Last 24 Hours:** \`${stats.readsLast24h.toLocaleString()}\``,
          `• **Unique Speakers:** \`${stats.uniqueSpeakers.toLocaleString()}\``,
          `• **Estimated Playback Time:** \`${totalMinutes} minutes\``,
        ].join('\n')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### Top Speakers\n${topLines}`)
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildFiltersPanel({ guild, settings }) {
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('tts:select:ignored_roles')
    .setPlaceholder('Select roles to ignore for TTS (optional)...')
    .setMinValues(0)
    .setMaxValues(10);
  if (settings.ignoredRoles.length > 0) {
    roleSelect.setDefaultRoles(settings.ignoredRoles.slice(0, 10));
  }

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('tts:select:ignored_channels')
    .setPlaceholder('Select channels to ignore (optional)...')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(10);
  if (settings.ignoredChannels.length > 0) {
    channelSelect.setDefaultChannels(settings.ignoredChannels.slice(0, 10));
  }

  const togglesRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tts:btn:toggle_autoconnect')
      .setLabel(`Auto-Connect: ${settings.autoConnect ? 'ON' : 'OFF'}`)
      .setStyle(settings.autoConnect ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tts:btn:toggle_announce')
      .setLabel(`Announce Author: ${settings.announceAuthor ? 'ON' : 'OFF'}`)
      .setStyle(settings.announceAuthor ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tts:btn:clear_filters')
      .setLabel('Clear All Filters')
      .setStyle(ButtonStyle.Danger)
  );

  const container = new ContainerBuilder()
    .setAccentColor(BLUE_ACCENT)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `## 🛡️ Safety Filters & Behavior — ${guild.name}`,
          `Configure ignored roles, ignored channels, and automatic playback behavior.`,
        ].join('\n')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(channelSelect),
      togglesRow
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = {
  buildNoticeContainer,
  buildQueueView,
  buildSettingsView,
  buildStatisticsView,
  buildFiltersPanel,
};
