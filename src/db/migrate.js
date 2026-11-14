'use strict';

const fs = require('node:fs');
const path = require('node:path');
const db = require('./pool');
const logger = require('../logger').child({ module: 'db-migrate' });

async function runMigrations() {
  const schemaPath = path.resolve(__dirname, '..', '..', 'db', 'init.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await db.connectWithRetry();
  await db.query(sql);
  logger.info('PostgreSQL schema migration verified/applied successfully');
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      await db.close();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Database migration failed');
      await db.close();
      process.exit(1);
    });
}

module.exports = { runMigrations };
