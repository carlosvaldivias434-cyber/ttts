'use strict';

const { AudioPlayerStatus, entersState } = require('@discordjs/voice');
const { config } = require('../config/env');
const guildRepo = require('../db/guildRepository');
const piperEngine = require('./piperEngine');
const voiceManager = require('../voice/voiceManager');
const logger = require('../logger').child({ module: 'tts-queue' });

class QueueManager {
  constructor() {
    this.queues = new Map(); // guildId -> GuildQueueState
    this.client = null;
    this.panelRefreshHandler = null;
    this.panelRefreshTimers = new Map();
  }

  setClient(client) {
    this.client = client;
  }

  setPanelRefreshHandler(handler) {
    this.panelRefreshHandler = handler;
  }

  _schedulePanelRefresh(guildId) {
    if (!this.panelRefreshHandler) return;
    if (this.panelRefreshTimers.has(guildId)) return;

    const timer = setTimeout(() => {
      this.panelRefreshTimers.delete(guildId);
      Promise.resolve(this.panelRefreshHandler(guildId)).catch((err) => {
        logger.debug({ err: err.message, guildId }, 'Panel auto-refresh skipped/failed');
      });
    }, 1200);

    this.panelRefreshTimers.set(guildId, timer);
  }

  _getState(guildId) {
    let state = this.queues.get(guildId);
    if (!state) {
      state = {
        guildId,
        items: [],
        current: null,
        isProcessing: false,
        isPaused: false,
        skipCurrent: false,
        currentCleanup: null,
        recentMessageIds: new Map(),
        userLastSpokeAt: new Map(),
        userLastContent: new Map(),
      };

      voiceManager.setPlaybackErrorHandler(guildId, () => {
        if (state.currentCleanup) {
          state.currentCleanup();
          state.currentCleanup = null;
        }
      });

      this.queues.set(guildId, state);
    }
    return state;
  }

  _pruneCaches(state) {
    const now = Date.now();
    for (const [msgId, expiresAt] of state.recentMessageIds.entries()) {
      if (expiresAt <= now) state.recentMessageIds.delete(msgId);
    }
    for (const [userId, entry] of state.userLastContent.entries()) {
      if (now - entry.timestamp > Math.max(60000, config.queue.duplicateCooldownMs * 2)) {
        state.userLastContent.delete(userId);
      }
    }
  }

  getQueueSnapshot(guildId) {
    const state = this._getState(guildId);
    return {
      current: state.current
        ? {
            messageId: state.current.messageId,
            authorId: state.current.authorId,
            authorName: state.current.authorName,
            sanitizedText: state.current.sanitizedText,
            voiceModel: state.current.voiceModel,
            speechSpeed: state.current.speechSpeed,
          }
        : null,
      items: state.items.map((item, index) => ({
        position: index + 1,
        messageId: item.messageId,
        authorId: item.authorId,
        authorName: item.authorName,
        sanitizedText: item.sanitizedText,
        voiceModel: item.voiceModel,
        speechSpeed: item.speechSpeed,
      })),
      queueLength: state.items.length,
      isPaused: state.isPaused,
      isProcessing: state.isProcessing,
    };
  }

  async enqueueMessage(guild, settings, item) {
    const state = this._getState(guild.id);
    this._pruneCaches(state);

    const now = Date.now();

    // 1. Prevent duplicate message playback by Discord message ID
    if (state.recentMessageIds.has(item.messageId)) {
      return { enqueued: false, reason: 'duplicate_message_id' };
    }
    if (
      state.current?.messageId === item.messageId ||
      state.items.some((q) => q.messageId === item.messageId)
    ) {
      return { enqueued: false, reason: 'already_queued' };
    }

    // 2. Per-user rate-limiting (anti-spam)
    const rateLimitMs = settings.rateLimitMs ?? config.queue.userRateLimitMs;
    if (rateLimitMs > 0) {
      const lastSpoke = state.userLastSpokeAt.get(item.authorId) || 0;
      if (now - lastSpoke < rateLimitMs) {
        return { enqueued: false, reason: 'rate_limited' };
      }
    }

    // 3. Per-user identical message cooldown (anti-duplicate spam)
    if (config.queue.duplicateCooldownMs > 0) {
      const prev = state.userLastContent.get(item.authorId);
      const normalized = item.sanitizedText.toLowerCase();
      if (
        prev &&
        prev.text === normalized &&
        now - prev.timestamp < config.queue.duplicateCooldownMs
      ) {
        return { enqueued: false, reason: 'duplicate_content' };
      }
    }

    // 4. Prevent excessive queue buildup
    if (state.items.length >= config.queue.maxQueueSize) {
      return { enqueued: false, reason: 'queue_full' };
    }

    state.recentMessageIds.set(item.messageId, now + 120000);
    state.userLastSpokeAt.set(item.authorId, now);
    state.userLastContent.set(item.authorId, {
      text: item.sanitizedText.toLowerCase(),
      timestamp: now,
    });

    const queueEntry = {
      guildId: guild.id,
      messageId: item.messageId,
      channelId: item.channelId,
      authorId: item.authorId,
      authorName: item.authorName,
      rawContent: item.rawContent,
      sanitizedText: item.sanitizedText,
      voiceModel: settings.voiceModel,
      language: settings.language,
      speechSpeed: settings.speechSpeed,
    };

    state.items.push(queueEntry);
    await guildRepo.enqueueDbItem(queueEntry);

    logger.debug(
      {
        guildId: guild.id,
        messageId: item.messageId,
        authorId: item.authorId,
        queueLength: state.items.length,
      },
      'Enqueued automatic TTS message'
    );

    this._schedulePanelRefresh(guild.id);
    this._kickProcessor(guild);

    return { enqueued: true, position: state.items.length };
  }

  _kickProcessor(guild) {
    const state = this._getState(guild.id);
    if (state.isProcessing || state.isPaused) return;
    if (state.items.length === 0) return;

    this._processLoop(guild, state).catch((err) => {
      logger.error({ err: err.message, guildId: guild.id }, 'Unhandled TTS queue processor error');
    });
  }

  async _processLoop(guild, state) {
    if (state.isProcessing) return;
    state.isProcessing = true;

    try {
      while (!state.isPaused && state.items.length > 0) {
        const settings = await guildRepo.getOrCreateSettings(guild.id);
        if (!settings.ttsEnabled) {
          break;
        }

        // Verify voice connection
        let voiceStatus = voiceManager.getStatus(guild.id);
        if (!voiceStatus.isConnected) {
          if (settings.autoConnect && settings.voiceChannelId) {
            try {
              await voiceManager.connect(guild, settings.voiceChannelId);
              voiceStatus = voiceManager.getStatus(guild.id);
            } catch (err) {
              logger.warn(
                { err: err.message, guildId: guild.id, voiceChannelId: settings.voiceChannelId },
                'Auto-connect to voice channel failed; pausing queue processing'
              );
              break;
            }
          } else {
            break;
          }
        }

        if (!voiceStatus.isConnected) {
          break;
        }

        const nextItem = state.items.shift();
        if (!nextItem) break;

        state.current = nextItem;
        state.skipCurrent = false;
        await guildRepo.markDbQueueStatus(guild.id, nextItem.messageId, 'playing');
        this._schedulePanelRefresh(guild.id);

        const playbackStart = Date.now();
        let wavPath = null;

        try {
          const synth = await piperEngine.synthesizeToWav(nextItem.sanitizedText, {
            voiceModel: nextItem.voiceModel || settings.voiceModel,
            speechSpeed: nextItem.speechSpeed || settings.speechSpeed,
          });
          wavPath = synth.wavPath;

          // If skipped or cleared during synthesis, clean up WAV immediately
          if (state.skipCurrent || !state.current || state.current.messageId !== nextItem.messageId) {
            await require('node:fs').promises.unlink(wavPath).catch(() => {});
            await guildRepo.removeDbQueueItem(guild.id, nextItem.messageId);
            continue;
          }

          const { resource, cleanup } = piperEngine.createDiscordAudioResource(
            wavPath,
            settings.volume
          );
          state.currentCleanup = cleanup;

          const player = voiceManager.getPlayer(guild.id);
          player.play(resource);

          await this._waitForPlaybackCompletion(player, state);

          if (!state.skipCurrent) {
            const durationMs = Date.now() - playbackStart;
            await guildRepo.recordMessageRead(guild.id, {
              authorId: nextItem.authorId,
              voiceModel: synth.voiceModel,
              language: settings.language,
              characterCount: nextItem.sanitizedText.length,
              durationMs,
            });
          }
        } catch (err) {
          logger.error(
            { err: err.message, guildId: guild.id, messageId: nextItem.messageId },
            'TTS playback failed for queued message; recovering to next item'
          );
          if (wavPath) {
            await require('node:fs').promises.unlink(wavPath).catch(() => {});
          }
        } finally {
          if (state.currentCleanup) {
            state.currentCleanup();
            state.currentCleanup = null;
          }
          await guildRepo.removeDbQueueItem(guild.id, nextItem.messageId);
          state.current = null;
          state.skipCurrent = false;
          this._schedulePanelRefresh(guild.id);
        }
      }
    } finally {
      state.isProcessing = false;
      this._schedulePanelRefresh(guild.id);
    }
  }

  async _waitForPlaybackCompletion(player, state) {
    try {
      await entersState(player, AudioPlayerStatus.Playing, 5000);
    } catch {
      // May already have transitioned directly to Idle for very short clips
      if (player.state.status === AudioPlayerStatus.Idle) return;
    }

    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearInterval(pauseWatcher);
        player.off(AudioPlayerStatus.Idle, onIdle);
        player.off('error', onError);
        resolve();
      };

      const onIdle = () => {
        // Do not complete while paused in AutoPaused or Paused state
        if (state.isPaused && !state.skipCurrent) return;
        done();
      };

      const onError = (err) => {
        logger.warn({ err: err.message, guildId: state.guildId }, 'Audio player emitted error mid-playback');
        done();
      };

      const pauseWatcher = setInterval(() => {
        if (state.skipCurrent) {
          try {
            player.stop(true);
          } catch {
            // Ignore
          }
          done();
        } else if (player.state.status === AudioPlayerStatus.Idle && !state.isPaused) {
          done();
        }
      }, 250);

      player.on(AudioPlayerStatus.Idle, onIdle);
      player.on('error', onError);
    });
  }

  pause(guildId) {
    const state = this._getState(guildId);
    state.isPaused = true;
    const player = voiceManager.getPlayer(guildId);
    const paused = player.pause(true);
    this._schedulePanelRefresh(guildId);
    return paused || state.isPaused;
  }

  resume(guild) {
    const state = this._getState(guild.id);
    state.isPaused = false;
    const player = voiceManager.getPlayer(guild.id);
    const unpaused = player.unpause();
    this._schedulePanelRefresh(guild.id);
    this._kickProcessor(guild);
    return unpaused || !state.isPaused;
  }

  skip(guildId) {
    const state = this._getState(guildId);
    if (!state.current && state.items.length === 0) {
      return false;
    }

    state.skipCurrent = true;
    if (state.currentCleanup) {
      state.currentCleanup();
      state.currentCleanup = null;
    }
    const player = voiceManager.getPlayer(guildId);
    player.stop(true);
    this._schedulePanelRefresh(guildId);
    return true;
  }

  async clear(guildId) {
    const state = this._getState(guildId);
    const clearedCount = state.items.length + (state.current ? 1 : 0);

    state.items = [];
    state.skipCurrent = true;
    if (state.currentCleanup) {
      state.currentCleanup();
      state.currentCleanup = null;
    }

    const player = voiceManager.getPlayer(guildId);
    player.stop(true);
    await guildRepo.clearDbQueue(guildId);

    this._schedulePanelRefresh(guildId);
    return clearedCount;
  }

  async removeByMessageId(guildId, messageId) {
    const state = this._getState(guildId);
    const initialLen = state.items.length;
    state.items = state.items.filter((item) => item.messageId !== messageId);

    if (state.current?.messageId === messageId) {
      this.skip(guildId);
    }

    if (state.items.length !== initialLen) {
      await guildRepo.removeDbQueueItem(guildId, messageId);
      this._schedulePanelRefresh(guildId);
      return true;
    }
    return false;
  }

  async restorePersistedQueues(client) {
    const enabledGuilds = await guildRepo.getEnabledGuilds();
    for (const settings of enabledGuilds) {
      const guild = client.guilds.cache.get(settings.guildId);
      if (!guild) continue;

      const pending = await guildRepo.getPendingDbQueue(settings.guildId);
      if (pending.length === 0) continue;

      const state = this._getState(settings.guildId);
      for (const item of pending) {
        if (!state.items.some((existing) => existing.messageId === item.messageId)) {
          state.items.push({
            ...item,
            language: settings.language,
          });
        }
      }

      logger.info(
        { guildId: settings.guildId, restoredCount: pending.length },
        'Restored pending TTS queue items from PostgreSQL'
      );

      this._kickProcessor(guild);
    }
  }
}

module.exports = new QueueManager();
