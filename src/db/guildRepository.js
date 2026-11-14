'use strict';

const db = require('./pool');
const { config } = require('../config/env');
const logger = require('../logger').child({ module: 'guild-repository' });

class GuildRepository {
  constructor() {
    this.cache = new Map();
    this.cacheTtlMs = 30000;
  }

  _normalizeRow(row) {
    if (!row) return null;
    return {
      guildId: row.guild_id,
      textChannelId: row.text_channel_id || null,
      voiceChannelId: row.voice_channel_id || null,
      panelChannelId: row.panel_channel_id || null,
      panelMessageId: row.panel_message_id || null,
      ttsEnabled: Boolean(row.tts_enabled),
      autoConnect: Boolean(row.auto_connect),
      announceAuthor: Boolean(row.announce_author),
      voiceModel: row.voice_model || config.tts.defaultVoiceModel,
      language: row.language || config.tts.defaultLanguage,
      speechSpeed: Number.parseFloat(row.speech_speed) || config.tts.defaultSpeechSpeed,
      volume: Number.parseInt(row.volume, 10) || config.tts.defaultVolume,
      maxMessageLength:
        Number.parseInt(row.max_message_length, 10) || config.tts.defaultMaxMessageLength,
      rateLimitMs: Number.parseInt(row.rate_limit_ms, 10) ?? config.queue.userRateLimitMs,
      ignoredRoles: Array.isArray(row.ignored_roles) ? row.ignored_roles : [],
      ignoredChannels: Array.isArray(row.ignored_channels) ? row.ignored_channels : [],
      totalMessagesRead: Number.parseInt(row.total_messages_read, 10) || 0,
      totalCharactersRead: Number.parseInt(row.total_characters_read, 10) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _setCache(guildId, settings) {
    this.cache.set(guildId, {
      data: settings,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  invalidateCache(guildId) {
    this.cache.delete(guildId);
  }

  async getOrCreateSettings(guildId) {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const result = await db.query(
      `
      INSERT INTO guild_settings (
        guild_id,
        voice_model,
        language,
        speech_speed,
        volume,
        max_message_length,
        rate_limit_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (guild_id) DO UPDATE SET guild_id = EXCLUDED.guild_id
      RETURNING *
      `,
      [
        guildId,
        config.tts.defaultVoiceModel,
        config.tts.defaultLanguage,
        config.tts.defaultSpeechSpeed,
        config.tts.defaultVolume,
        config.tts.defaultMaxMessageLength,
        config.queue.userRateLimitMs,
      ]
    );

    const normalized = this._normalizeRow(result.rows[0]);
    this._setCache(guildId, normalized);
    return normalized;
  }

  async updateSettings(guildId, patch) {
    await this.getOrCreateSettings(guildId);

    const columnMap = {
      textChannelId: 'text_channel_id',
      voiceChannelId: 'voice_channel_id',
      panelChannelId: 'panel_channel_id',
      panelMessageId: 'panel_message_id',
      ttsEnabled: 'tts_enabled',
      autoConnect: 'auto_connect',
      announceAuthor: 'announce_author',
      voiceModel: 'voice_model',
      language: 'language',
      speechSpeed: 'speech_speed',
      volume: 'volume',
      maxMessageLength: 'max_message_length',
      rateLimitMs: 'rate_limit_ms',
      ignoredRoles: 'ignored_roles',
      ignoredChannels: 'ignored_channels',
    };

    const sets = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(patch)) {
      const col = columnMap[key];
      if (!col) continue;
      sets.push(`${col} = $${idx}`);
      values.push(value);
      idx += 1;
    }

    if (sets.length === 0) {
      return this.getOrCreateSettings(guildId);
    }

    values.push(guildId);
    const sql = `
      UPDATE guild_settings
      SET ${sets.join(', ')}
      WHERE guild_id = $${idx}
      RETURNING *
    `;

    const result = await db.query(sql, values);
    const normalized = this._normalizeRow(result.rows[0]);
    this._setCache(guildId, normalized);
    return normalized;
  }

  async getEnabledGuilds() {
    const result = await db.query(
      `SELECT * FROM guild_settings WHERE tts_enabled = TRUE`
    );
    return result.rows.map((row) => this._normalizeRow(row));
  }

  async recordMessageRead(guildId, { authorId, voiceModel, language, characterCount, durationMs }) {
    await db.query(
      `
      UPDATE guild_settings
      SET
        total_messages_read = total_messages_read + 1,
        total_characters_read = total_characters_read + $2
      WHERE guild_id = $1
      `,
      [guildId, Math.max(0, characterCount || 0)]
    );

    this.invalidateCache(guildId);

    await db.query(
      `
      INSERT INTO tts_usage_logs (guild_id, author_id, voice_model, language, character_count, duration_ms)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        guildId,
        authorId,
        voiceModel,
        language,
        Math.max(0, characterCount || 0),
        Math.max(0, Math.round(durationMs || 0)),
      ]
    );
  }

  async getGuildStatistics(guildId) {
    const settings = await this.getOrCreateSettings(guildId);

    const aggResult = await db.query(
      `
      SELECT
        COUNT(*)::BIGINT AS logged_reads,
        COUNT(DISTINCT author_id)::BIGINT AS unique_speakers,
        COALESCE(SUM(character_count), 0)::BIGINT AS total_chars,
        COALESCE(SUM(duration_ms), 0)::BIGINT AS total_duration_ms,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::BIGINT AS reads_last_24h
      FROM tts_usage_logs
      WHERE guild_id = $1
      `,
      [guildId]
    );

    const topSpeakersResult = await db.query(
      `
      SELECT author_id, COUNT(*)::BIGINT AS message_count
      FROM tts_usage_logs
      WHERE guild_id = $1
      GROUP BY author_id
      ORDER BY message_count DESC
      LIMIT 3
      `,
      [guildId]
    );

    const agg = aggResult.rows[0] || {};
    return {
      settings,
      totalMessagesRead: settings.totalMessagesRead,
      totalCharactersRead: settings.totalCharactersRead,
      uniqueSpeakers: Number.parseInt(agg.unique_speakers, 10) || 0,
      totalDurationMs: Number.parseInt(agg.total_duration_ms, 10) || 0,
      readsLast24h: Number.parseInt(agg.reads_last_24h, 10) || 0,
      topSpeakers: topSpeakersResult.rows.map((r) => ({
        authorId: r.author_id,
        count: Number.parseInt(r.message_count, 10) || 0,
      })),
    };
  }

  // Persistent queue operations
  async enqueueDbItem(item) {
    try {
      const result = await db.query(
        `
        INSERT INTO tts_queue (
          guild_id, message_id, channel_id, author_id, author_name,
          raw_content, sanitized_text, voice_model, speech_speed, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
        ON CONFLICT (guild_id, message_id) DO NOTHING
        RETURNING id
        `,
        [
          item.guildId,
          item.messageId,
          item.channelId,
          item.authorId,
          item.authorName,
          item.rawContent,
          item.sanitizedText,
          item.voiceModel,
          item.speechSpeed,
        ]
      );
      return result.rows[0]?.id || null;
    } catch (err) {
      logger.warn({ err, guildId: item.guildId }, 'Failed to persist queue item');
      return null;
    }
  }

  async markDbQueueStatus(guildId, messageId, status) {
    try {
      await db.query(
        `UPDATE tts_queue SET status = $3 WHERE guild_id = $1 AND message_id = $2`,
        [guildId, messageId, status]
      );
    } catch (err) {
      logger.debug({ err, guildId, messageId }, 'Failed to update DB queue status');
    }
  }

  async removeDbQueueItem(guildId, messageId) {
    try {
      await db.query(
        `DELETE FROM tts_queue WHERE guild_id = $1 AND message_id = $2`,
        [guildId, messageId]
      );
    } catch (err) {
      logger.debug({ err, guildId, messageId }, 'Failed to remove DB queue item');
    }
  }

  async clearDbQueue(guildId) {
    try {
      await db.query(`DELETE FROM tts_queue WHERE guild_id = $1`, [guildId]);
    } catch (err) {
      logger.warn({ err, guildId }, 'Failed to clear DB queue');
    }
  }

  async getPendingDbQueue(guildId) {
    const result = await db.query(
      `
      SELECT * FROM tts_queue
      WHERE guild_id = $1
      ORDER BY id ASC
      `,
      [guildId]
    );
    return result.rows.map((row) => ({
      dbId: row.id,
      guildId: row.guild_id,
      messageId: row.message_id,
      channelId: row.channel_id,
      authorId: row.author_id,
      authorName: row.author_name,
      rawContent: row.raw_content,
      sanitizedText: row.sanitized_text,
      voiceModel: row.voice_model,
      speechSpeed: Number.parseFloat(row.speech_speed) || 1.0,
    }));
  }
}

module.exports = new GuildRepository();
