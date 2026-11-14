'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const { config } = require('../config/env');
const { getModelPaths, getInstalledModels } = require('../config/voices');
const logger = require('../logger').child({ module: 'piper-engine' });

let resolvedFfmpegPath = config.tts.ffmpegPath || null;
if (!resolvedFfmpegPath) {
  try {
    resolvedFfmpegPath = require('ffmpeg-static');
  } catch {
    resolvedFfmpegPath = 'ffmpeg';
  }
}

class PiperEngine {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    fs.mkdirSync(config.tts.modelsDir, { recursive: true });
    fs.mkdirSync(config.tts.tempDir, { recursive: true });
  }

  isBinaryAvailable() {
    const binPath = config.tts.piperBinPath;
    if (!binPath) return false;
    if (path.isAbsolute(binPath) || binPath.includes(path.sep) || binPath.includes('/')) {
      return fs.existsSync(binPath);
    }
    return true;
  }

  resolveModelPath(voiceModel) {
    const requested = getModelPaths(voiceModel, config.tts.modelsDir);
    if (fs.existsSync(requested.onnxPath)) {
      return {
        voiceModel,
        onnxPath: requested.onnxPath,
        configPath: requested.configPath,
        fallbackUsed: false,
      };
    }

    // Fallback to default configured voice if installed
    const defaultPaths = getModelPaths(config.tts.defaultVoiceModel, config.tts.modelsDir);
    if (fs.existsSync(defaultPaths.onnxPath)) {
      logger.warn(
        { requestedVoice: voiceModel, fallbackVoice: config.tts.defaultVoiceModel },
        'Requested Piper model not found; using default model'
      );
      return {
        voiceModel: config.tts.defaultVoiceModel,
        onnxPath: defaultPaths.onnxPath,
        configPath: defaultPaths.configPath,
        fallbackUsed: true,
      };
    }

    // Fallback to any installed .onnx model
    const installed = [...getInstalledModels(config.tts.modelsDir)];
    if (installed.length > 0) {
      const anyId = installed[0];
      const anyPaths = getModelPaths(anyId, config.tts.modelsDir);
      logger.warn(
        { requestedVoice: voiceModel, fallbackVoice: anyId },
        'Requested Piper model not found; using first installed model'
      );
      return {
        voiceModel: anyId,
        onnxPath: anyPaths.onnxPath,
        configPath: anyPaths.configPath,
        fallbackUsed: true,
      };
    }

    throw new Error(
      `No Piper voice models (.onnx) found in ${config.tts.modelsDir}. Run scripts/download-voices.sh (Linux/macOS) or scripts/download-voices.ps1 (Windows).`
    );
  }

  async synthesizeToWav(text, { voiceModel, speechSpeed = 1.0 } = {}) {
    this.ensureDirectories();

    if (!this.isBinaryAvailable()) {
      throw new Error(
        `Piper executable not found at "${config.tts.piperBinPath}". Check PIPER_BIN_PATH in .env or run the voice setup script.`
      );
    }

    const modelInfo = this.resolveModelPath(voiceModel || config.tts.defaultVoiceModel);
    const speed = Math.min(2.0, Math.max(0.5, Number(speechSpeed) || 1.0));
    // Piper's --length_scale is inverse of speed (lower = faster, higher = slower)
    const lengthScale = (1.0 / speed).toFixed(3);

    const fileId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const wavPath = path.join(config.tts.tempDir, `tts-${fileId}.wav`);

    const args = [
      '--model',
      modelInfo.onnxPath,
      '--output_file',
      wavPath,
      '--length_scale',
      lengthScale,
    ];

    if (fs.existsSync(modelInfo.configPath)) {
      args.push('--config', modelInfo.configPath);
    }

    const startedAt = Date.now();

    await new Promise((resolve, reject) => {
      const proc = spawn(config.tts.piperBinPath, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        shell: false,
        windowsHide: true,
      });

      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGKILL');
          reject(new Error(`Piper TTS timed out after ${config.tts.piperTimeoutMs}ms`));
        }
      }, config.tts.piperTimeoutMs);

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`Failed to spawn Piper TTS: ${err.message}`));
        }
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (code !== 0) {
          reject(new Error(`Piper TTS exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        if (!fs.existsSync(wavPath)) {
          reject(new Error('Piper TTS completed without producing an output WAV file'));
          return;
        }
        resolve();
      });

      // Pass sanitized text strictly via stdin (never CLI arguments or shell)
      proc.stdin.end(`${text}\n`, 'utf8');
    });

    const elapsedMs = Date.now() - startedAt;
    logger.debug(
      { wavPath, voiceModel: modelInfo.voiceModel, speed, elapsedMs },
      'Synthesized local Piper WAV audio'
    );

    return {
      wavPath,
      voiceModel: modelInfo.voiceModel,
      synthesisMs: elapsedMs,
    };
  }

  /**
   * Converts generated WAV into a 48kHz stereo signed 16-bit PCM stream for Discord voice
   * with inline volume control and guaranteed temp file cleanup.
   */
  createDiscordAudioResource(wavPath, volumePercent = 100) {
    const ffmpegBin = resolvedFfmpegPath || 'ffmpeg';
    const ffmpegProc = spawn(
      ffmpegBin,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        wavPath,
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        'pipe:1',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      }
    );

    let ffmpegStderr = '';
    ffmpegProc.stderr.on('data', (chunk) => {
      ffmpegStderr += chunk.toString();
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        if (!ffmpegProc.killed) {
          ffmpegProc.kill('SIGKILL');
        }
      } catch {
        // Ignore kill race
      }
      fs.promises.unlink(wavPath).catch((err) => {
        if (err && err.code !== 'ENOENT') {
          logger.warn({ err: err.message, wavPath }, 'Failed to unlink temporary TTS WAV file');
        }
      });
    };

    ffmpegProc.on('error', (err) => {
      logger.error({ err: err.message, wavPath }, 'FFmpeg audio conversion error');
      cleanup();
    });

    ffmpegProc.on('close', (code) => {
      if (code !== 0 && code !== null && !cleaned) {
        logger.warn({ code, stderr: ffmpegStderr.trim(), wavPath }, 'FFmpeg exited abnormally');
      }
      cleanup();
    });

    ffmpegProc.stdout.on('close', cleanup);
    ffmpegProc.stdout.on('error', cleanup);

    const resource = createAudioResource(ffmpegProc.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });

    const normalizedVol = Math.min(2.0, Math.max(0.1, (Number(volumePercent) || 100) / 100));
    if (resource.volume) {
      resource.volume.setVolume(normalizedVol);
    }

    return {
      resource,
      cleanup,
    };
  }

  async cleanupStaleTempFiles(maxAgeMs = 1000 * 60 * 15) {
    try {
      this.ensureDirectories();
      const entries = await fs.promises.readdir(config.tts.tempDir, { withFileTypes: true });
      const now = Date.now();
      let removed = 0;

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.wav')) continue;
        const fullPath = path.join(config.tts.tempDir, entry.name);
        const stat = await fs.promises.stat(fullPath).catch(() => null);
        if (stat && now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(fullPath).catch(() => {});
          removed += 1;
        }
      }

      if (removed > 0) {
        logger.info({ removed }, 'Cleaned up stale temporary TTS WAV files');
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Temporary TTS directory cleanup warning');
    }
  }
}

module.exports = new PiperEngine();
