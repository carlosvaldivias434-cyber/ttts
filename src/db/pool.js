'use strict';

const { Pool } = require('pg');
const { config } = require('../config/env');
const logger = require('../logger').child({ module: 'db-pool' });

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    this.reconnecting = false;
    this.shuttingDown = false;
  }

  _buildPoolConfig() {
    if (config.db.connectionString) {
      return {
        connectionString: config.db.connectionString,
        ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
        max: config.db.maxPoolSize,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };
    }

    return {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
      max: config.db.maxPoolSize,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  _createPool() {
    const pool = new Pool(this._buildPoolConfig());

    pool.on('error', (err) => {
      this.isConnected = false;
      logger.error({ err }, 'Unexpected PostgreSQL pool idle client error');
      if (!this.shuttingDown) {
        this._scheduleReconnect().catch((reconnectErr) => {
          logger.error({ err: reconnectErr }, 'Database reconnection attempt failed');
        });
      }
    });

    pool.on('connect', () => {
      this.isConnected = true;
    });

    return pool;
  }

  async connectWithRetry(maxAttempts = 10) {
    if (!this.pool) {
      this.pool = this._createPool();
    }

    let attempt = 0;
    while (attempt < maxAttempts && !this.shuttingDown) {
      attempt += 1;
      try {
        await this.pool.query('SELECT 1');
        this.isConnected = true;
        logger.info('PostgreSQL connection established');
        return this.pool;
      } catch (err) {
        this.isConnected = false;
        const delayMs = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt - 1, 5)));
        logger.warn(
          { err: err.message, attempt, maxAttempts, delayMs },
          'PostgreSQL connection failed; retrying'
        );
        if (attempt >= maxAttempts) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return this.pool;
  }

  async _scheduleReconnect() {
    if (this.reconnecting || this.shuttingDown) return;
    this.reconnecting = true;

    try {
      let attempt = 0;
      while (!this.isConnected && !this.shuttingDown) {
        attempt += 1;
        const delayMs = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt - 1, 5)));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (this.shuttingDown) break;
        try {
          await this.pool.query('SELECT 1');
          this.isConnected = true;
          logger.info({ attempt }, 'PostgreSQL connection restored');
          break;
        } catch (err) {
          logger.warn({ err: err.message, attempt }, 'PostgreSQL reconnect probe failed');
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  async query(text, params = []) {
    if (!this.pool) {
      this.pool = this._createPool();
    }
    try {
      const result = await this.pool.query(text, params);
      this.isConnected = true;
      return result;
    } catch (err) {
      const transientCodes = new Set([
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        '57P01',
        '57P02',
        '57P03',
        '08000',
        '08003',
        '08006',
      ]);
      if (transientCodes.has(err.code) && !this.shuttingDown) {
        this.isConnected = false;
        logger.warn({ err: err.message, code: err.code }, 'Transient PostgreSQL error; retrying query once');
        await new Promise((resolve) => setTimeout(resolve, 750));
        return this.pool.query(text, params);
      }
      throw err;
    }
  }

  async close() {
    this.shuttingDown = true;
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      logger.info('PostgreSQL connection pool closed');
    }
  }
}

module.exports = new DatabaseManager();
