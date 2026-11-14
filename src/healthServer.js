'use strict';

const http = require('node:http');
const { config } = require('./config/env');
const { getInstalledModels } = require('./config/voices');
const db = require('./db/pool');
const piperEngine = require('./tts/piperEngine');
const logger = require('./logger').child({ module: 'health-server' });

let server = null;

function startHealthServer(getState) {
  if (server) return Promise.resolve(server);

  server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath !== '/' && urlPath !== '/health' && urlPath !== '/healthz') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    const state = typeof getState === 'function' ? getState() : {};
    const client = state.client || null;
    const isReady = Boolean(client?.isReady?.());

    const payload = {
      service: 'discord-auto-tts-bot',
      status: state.standby ? 'standby' : isReady ? 'online' : 'starting',
      standbyReason: state.standbyReason || null,
      discord: {
        connected: isReady,
        tag: isReady ? client.user.tag : null,
        guilds: isReady ? client.guilds.cache.size : 0,
        pingMs: isReady && Number.isFinite(client.ws?.ping) ? Math.round(client.ws.ping) : null,
      },
      database: {
        connected: Boolean(db.isConnected),
      },
      tts: {
        engine: 'piper',
        piperBinaryAvailable: piperEngine.isBinaryAvailable(),
        installedModels: [...getInstalledModels(config.tts.modelsDir)],
      },
      uptimeSeconds: Math.round(process.uptime()),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload, null, 2));
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      logger.error({ err: err.message, port: config.port }, 'Health server failed to bind');
      reject(err);
    });

    server.listen(config.port, '0.0.0.0', () => {
      logger.info({ port: config.port }, 'Bot health endpoint listening');
      resolve(server);
    });
  });
}

function closeHealthServer() {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

module.exports = {
  startHealthServer,
  closeHealthServer,
};
