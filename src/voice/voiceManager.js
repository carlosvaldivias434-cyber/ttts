'use strict';

const {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { config } = require('../config/env');
const logger = require('../logger').child({ module: 'voice-manager' });

class VoiceManager {
  constructor() {
    this.sessions = new Map(); // guildId -> session
    this.onPlaybackErrorCallbacks = new Map(); // guildId -> fn
    this.onStateChangeCallbacks = new Set(); // fn(guildId)
  }

  onStateChange(callback) {
    this.onStateChangeCallbacks.add(callback);
  }

  _notifyStateChange(guildId) {
    for (const cb of this.onStateChangeCallbacks) {
      try {
        cb(guildId);
      } catch (err) {
        logger.debug({ err, guildId }, 'Voice state listener callback error');
      }
    }
  }

  _getOrCreateSession(guildId) {
    let session = this.sessions.get(guildId);
    if (!session) {
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });

      session = {
        guildId,
        channelId: null,
        connection: null,
        player,
        manualDisconnect: false,
        reconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
      };

      player.on('error', (err) => {
        logger.error({ err: err.message, guildId }, 'AudioPlayer playback error');
        session.lastError = err.message;
        const cb = this.onPlaybackErrorCallbacks.get(guildId);
        if (cb) cb(err);
      });

      this.sessions.set(guildId, session);
    }
    return session;
  }

  setPlaybackErrorHandler(guildId, handler) {
    this.onPlaybackErrorCallbacks.set(guildId, handler);
  }

  getPlayer(guildId) {
    return this._getOrCreateSession(guildId).player;
  }

  getStatus(guildId) {
    const session = this.sessions.get(guildId);
    const connection = session?.connection || getVoiceConnection(guildId) || null;
    const status = connection?.state?.status || VoiceConnectionStatus.Disconnected;
    const isConnected = status === VoiceConnectionStatus.Ready;

    return {
      isConnected,
      status,
      channelId: isConnected || status === VoiceConnectionStatus.Connecting || status === VoiceConnectionStatus.Signalling
        ? (session?.channelId || connection?.joinConfig?.channelId || null)
        : null,
      reconnecting: Boolean(session?.reconnecting),
      playerStatus: session?.player?.state?.status || AudioPlayerStatus.Idle,
      lastError: session?.lastError || null,
    };
  }

  validateVoiceChannelPermissions(guild, voiceChannel) {
    if (!voiceChannel) {
      throw new Error('Configured voice channel was not found in this server.');
    }

    const validTypes = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
    if (!validTypes.has(voiceChannel.type)) {
      throw new Error('Selected channel is not a voice or stage channel.');
    }

    const me = guild.members.me;
    if (!me) {
      throw new Error('Bot member information is not available in this server.');
    }

    const perms = voiceChannel.permissionsFor(me);
    if (!perms) {
      throw new Error('Unable to verify permissions for the selected voice channel.');
    }

    const missing = [];
    if (!perms.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
    if (!perms.has(PermissionFlagsBits.Connect)) missing.push('Connect');
    if (!perms.has(PermissionFlagsBits.Speak)) missing.push('Speak');

    if (missing.length > 0) {
      throw new Error(
        `Missing required permissions in <#${voiceChannel.id}>: ${missing.join(', ')}.`
      );
    }
  }

  async connect(guild, voiceChannelId) {
    if (!guild || !voiceChannelId) {
      throw new Error('A valid Discord server and voice channel ID are required to connect.');
    }

    const voiceChannel =
      guild.channels.cache.get(voiceChannelId) ||
      (await guild.channels.fetch(voiceChannelId).catch(() => null));

    this.validateVoiceChannelPermissions(guild, voiceChannel);

    const session = this._getOrCreateSession(guild.id);
    session.manualDisconnect = false;
    session.lastError = null;

    // If already ready in the requested channel, reuse cleanly
    if (
      session.connection &&
      session.connection.state.status === VoiceConnectionStatus.Ready &&
      session.channelId === voiceChannel.id
    ) {
      session.connection.subscribe(session.player);
      return session;
    }

    // Destroy stale connection if switching channels or broken
    if (session.connection) {
      try {
        session.connection.removeAllListeners();
        session.connection.destroy();
      } catch {
        // Ignore cleanup errors
      }
      session.connection = null;
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    session.connection = connection;
    session.channelId = voiceChannel.id;

    this._attachConnectionHandlers(guild, session, connection);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15000);
      connection.subscribe(session.player);
      session.reconnectAttempts = 0;
      logger.info(
        { guildId: guild.id, channelId: voiceChannel.id, channelName: voiceChannel.name },
        'Connected to Discord voice channel'
      );
      this._notifyStateChange(guild.id);
      return session;
    } catch (err) {
      logger.error(
        { err: err.message, guildId: guild.id, channelId: voiceChannel.id },
        'Timed out waiting for voice connection Ready state'
      );
      try {
        connection.destroy();
      } catch {
        // Ignore
      }
      if (session.connection === connection) {
        session.connection = null;
        session.channelId = null;
      }
      throw new Error(`Failed to connect to <#${voiceChannel.id}>: ${err.message}`);
    }
  }

  _attachConnectionHandlers(guild, session, connection) {
    connection.on('error', (err) => {
      logger.error({ err: err.message, guildId: guild.id }, 'Voice connection error');
      session.lastError = err.message;
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (session.manualDisconnect || session.connection !== connection) {
        return;
      }

      logger.warn(
        { guildId: guild.id, channelId: session.channelId },
        'Voice gateway disconnected; attempting state recovery'
      );

      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        // Discord is automatically recovering the connection (e.g., voice server move)
        await entersState(connection, VoiceConnectionStatus.Ready, 10000);
        connection.subscribe(session.player);
        logger.info({ guildId: guild.id }, 'Voice gateway recovered automatically');
        this._notifyStateChange(guild.id);
      } catch {
        // Fatal disconnect (e.g., WebSocket 4014 or prolonged drop) -> controlled reconnect
        if (session.manualDisconnect || session.connection !== connection) return;

        logger.warn(
          { guildId: guild.id, channelId: session.channelId },
          'Automatic voice state transition failed; initiating controlled reconnect'
        );

        try {
          connection.destroy();
        } catch {
          // Ignore
        }
        if (session.connection === connection) {
          session.connection = null;
        }
        this._attemptReconnect(guild, session).catch((err) => {
          logger.error({ err: err.message, guildId: guild.id }, 'Voice reconnect loop failed');
        });
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (session.connection === connection) {
        session.connection = null;
        if (session.manualDisconnect) {
          session.channelId = null;
        }
        this._notifyStateChange(guild.id);
      }
    });
  }

  async _attemptReconnect(guild, session) {
    if (session.reconnecting || session.manualDisconnect || !session.channelId) {
      return;
    }

    session.reconnecting = true;
    this._notifyStateChange(guild.id);

    const targetChannelId = session.channelId;

    try {
      while (
        !session.manualDisconnect &&
        session.reconnectAttempts < config.queue.voiceReconnectMaxAttempts
      ) {
        session.reconnectAttempts += 1;
        const delayMs = Math.min(20000, 1500 * Math.pow(2, session.reconnectAttempts - 1));
        logger.info(
          {
            guildId: guild.id,
            channelId: targetChannelId,
            attempt: session.reconnectAttempts,
            maxAttempts: config.queue.voiceReconnectMaxAttempts,
            delayMs,
          },
          'Scheduling voice reconnection'
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (session.manualDisconnect) return;

        try {
          await this.connect(guild, targetChannelId);
          logger.info({ guildId: guild.id, channelId: targetChannelId }, 'Voice reconnection succeeded');
          return;
        } catch (err) {
          session.lastError = err.message;
          logger.warn(
            { err: err.message, guildId: guild.id, attempt: session.reconnectAttempts },
            'Voice reconnection attempt failed'
          );
        }
      }

      session.channelId = null;
      logger.error(
        { guildId: guild.id, attempts: session.reconnectAttempts },
        'Exhausted voice reconnection attempts'
      );
    } finally {
      session.reconnecting = false;
      this._notifyStateChange(guild.id);
    }
  }

  handleChannelMoved(guild, newChannelId) {
    const session = this.sessions.get(guild.id);
    if (!session) return;

    if (!newChannelId) {
      // Bot was disconnected/kicked by a moderator
      session.manualDisconnect = true;
      session.channelId = null;
      try {
        session.player.stop(true);
      } catch {
        // Ignore
      }
      if (session.connection) {
        try {
          session.connection.destroy();
        } catch {
          // Ignore
        }
        session.connection = null;
      }
      logger.info({ guildId: guild.id }, 'Bot was disconnected from voice channel');
      this._notifyStateChange(guild.id);
      return;
    }

    session.channelId = newChannelId;
    this._notifyStateChange(guild.id);
  }

  disconnect(guildId) {
    const session = this.sessions.get(guildId);
    const existingConn = session?.connection || getVoiceConnection(guildId);

    if (session) {
      session.manualDisconnect = true;
      session.reconnecting = false;
      session.reconnectAttempts = 0;
      session.channelId = null;
      try {
        session.player.stop(true);
      } catch {
        // Ignore
      }
      session.connection = null;
    }

    if (existingConn) {
      try {
        existingConn.destroy();
      } catch {
        // Ignore
      }
    }

    logger.info({ guildId }, 'Disconnected from Discord voice channel');
    this._notifyStateChange(guildId);
    return Boolean(existingConn || session);
  }

  disconnectAll() {
    for (const guildId of this.sessions.keys()) {
      this.disconnect(guildId);
    }
  }
}

module.exports = new VoiceManager();
