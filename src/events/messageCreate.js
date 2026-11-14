'use strict';

const { Events, PermissionFlagsBits } = require('discord.js');
const guildRepo = require('../db/guildRepository');
const queueManager = require('../tts/queueManager');
const { sanitizeMessageText } = require('../tts/sanitizer');
const logger = require('../logger').child({ module: 'event-messageCreate' });

module.exports = {
  name: Events.MessageCreate,
  once: false,
  async execute(message) {
    try {
      // Never read private/DM messages
      if (!message.inGuild() || !message.guild) return;

      // Prevent reading own messages, other bots, webhooks, or Discord system messages
      if (message.author.id === message.client.user?.id) return;
      if (message.author.bot) return;
      if (message.webhookId !== null) return;
      if (message.system) return;

      // Ignore empty messages or messages with only attachments/stickers/embeds
      if (!message.content || !message.content.trim()) return;

      const settings = await guildRepo.getOrCreateSettings(message.guild.id);
      if (!settings.ttsEnabled) return;
      if (!settings.textChannelId || message.channelId !== settings.textChannelId) return;

      // Check ignored channels
      if (settings.ignoredChannels.includes(message.channelId)) return;

      // Respect Discord channel permissions
      const me = message.guild.members.me;
      if (me && message.channel?.permissionsFor) {
        const perms = message.channel.permissionsFor(me);
        if (perms && !perms.has(PermissionFlagsBits.ViewChannel)) return;
      }

      // Check ignored roles
      if (settings.ignoredRoles.length > 0) {
        const member =
          message.member ||
          (await message.guild.members.fetch(message.author.id).catch(() => null));
        if (member) {
          const hasIgnoredRole = settings.ignoredRoles.some((roleId) =>
            member.roles.cache.has(roleId)
          );
          if (hasIgnoredRole) return;
        }
      }

      const authorName = message.member?.displayName || message.author.username;
      const sanitizedText = sanitizeMessageText(message.content, {
        maxLength: settings.maxMessageLength,
        message,
        authorName,
        announceAuthor: settings.announceAuthor,
      });

      if (!sanitizedText) return;

      const result = await queueManager.enqueueMessage(message.guild, settings, {
        messageId: message.id,
        channelId: message.channelId,
        authorId: message.author.id,
        authorName,
        rawContent: message.content,
        sanitizedText,
      });

      if (!result.enqueued) {
        logger.debug(
          {
            guildId: message.guild.id,
            messageId: message.id,
            reason: result.reason,
          },
          'Skipped automatic TTS enqueue'
        );
      }
    } catch (err) {
      logger.error(
        { err: err.message, guildId: message.guild?.id, messageId: message.id },
        'Error handling automatic TTS messageCreate event'
      );
    }
  },
};
