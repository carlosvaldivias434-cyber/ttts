'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');

function collectJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = [
  ...collectJsFiles(srcDir),
  path.join(__dirname, 'check-syntax.js'),
];

let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    console.error(`Syntax error in ${path.relative(rootDir, file)}:`);
    console.error(err.stderr?.toString() || err.message);
  }
}

// Verify core modules load cleanly without runtime import/syntax issues
const verifyModules = [
  './src/config/env',
  './src/config/voices',
  './src/logger',
  './src/healthServer',
  './src/tts/sanitizer',
  './src/ui/controlPanel',
  './src/ui/settingsPanel',
  './src/ui/modals',
  './src/commands/tts',
];

for (const mod of verifyModules) {
  try {
    require(path.join(rootDir, mod));
  } catch (err) {
    failed += 1;
    console.error(`Module load error in ${mod}:`, err);
  }
}

if (failed > 0) {
  console.error(`Verification failed with ${failed} error(s).`);
  process.exit(1);
}

console.log(`Verified ${files.length} CommonJS files and ${verifyModules.length} core modules successfully.`);
