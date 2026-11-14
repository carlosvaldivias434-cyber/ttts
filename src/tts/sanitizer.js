'use strict';

/**
 * Sanitizes Discord message content for safe, natural local TTS speech synthesis.
 * Never evaluates or executes message contents.
 */
function sanitizeMessageText(rawText, options = {}) {
  const {
    maxLength = 300,
    message = null,
    authorName = null,
    announceAuthor = false,
  } = options;

  if (typeof rawText !== 'string') return '';

  let text = rawText;

  // Remove zero-width & non-printable control characters (keep spaces/newlines/tabs)
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '');

  // Replace fenced code blocks with a spoken placeholder
  text = text.replace(/```[\s\S]*?```/g, ' code block ');

  // Strip inline code backticks while preserving readable content
  text = text.replace(/`([^`]+)`/g, '$1');

  // Resolve or strip Discord mentions cleanly
  if (message?.guild) {
    text = text.replace(/<@!?(\d{17,20})>/g, (_, userId) => {
      const member = message.guild.members.cache.get(userId);
      const user = message.client?.users?.cache?.get(userId);
      const name = member?.displayName || user?.username;
      return name ? `@${name}` : 'someone';
    });

    text = text.replace(/<@&(\d{17,20})>/g, (_, roleId) => {
      const role = message.guild.roles.cache.get(roleId);
      return role ? role.name : 'role';
    });

    text = text.replace(/<#(\d{17,20})>/g, (_, channelId) => {
      const channel = message.guild.channels.cache.get(channelId);
      return channel ? channel.name : 'channel';
    });
  } else {
    text = text.replace(/<@!?\d{17,20}>/g, 'someone');
    text = text.replace(/<@&\d{17,20}>/g, 'role');
    text = text.replace(/<#\d{17,20}>/g, 'channel');
  }

  // Convert custom Discord emojis <:smile:123456> or <a:wave:123456> into their spoken name
  text = text.replace(/<a?:([a-zA-Z0-9_]+):\d{17,20}>/g, ' $1 ');

  // Convert markdown links [label](url) -> label
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1');

  // Replace raw URLs so TTS doesn't read out long hex strings
  text = text.replace(/https?:\/\/\S+/gi, ' link ');

  // Strip spoiler tags and markdown emphasis characters
  text = text.replace(/\|\|/g, '');
  text = text.replace(/[*_~>#|]/g, ' ');

  // Collapse excessive repeated characters (e.g. "heyyyyyyyyy" -> "heyyy")
  text = text.replace(/(.)\1{4,}/g, '$1$1$1');

  // Normalize whitespace & line breaks into natural pauses
  text = text
    .replace(/\r?\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  // Reject messages that contain only punctuation/symbols after sanitization
  if (!/[\p{L}\p{N}]/u.test(text)) {
    return '';
  }

  if (announceAuthor && authorName) {
    const cleanAuthor = String(authorName)
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/[*_~`<>|]/g, '')
      .trim();
    if (cleanAuthor) {
      text = `${cleanAuthor} says: ${text}`;
    }
  }

  // Enforce configured maximum message length
  const clampedMax = Math.max(20, Math.min(2000, Number(maxLength) || 300));
  if (text.length > clampedMax) {
    text = `${text.slice(0, clampedMax - 1).trimEnd()}…`;
  }

  return text;
}

module.exports = {
  sanitizeMessageText,
};
