'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LANGUAGES = [
  { code: 'en_US', label: 'English (US)', description: 'American English voices' },
  { code: 'en_GB', label: 'English (UK)', description: 'British English voices' },
  { code: 'es_ES', label: 'Spanish (Spain)', description: 'Castilian Spanish voice' },
  { code: 'fr_FR', label: 'French (France)', description: 'Standard French voice' },
  { code: 'de_DE', label: 'German (Germany)', description: 'Standard German voice' },
  { code: 'it_IT', label: 'Italian (Italy)', description: 'Standard Italian voice' },
  { code: 'pt_BR', label: 'Portuguese (Brazil)', description: 'Brazilian Portuguese voice' },
];

const VOICE_MODELS = [
  {
    id: 'en_US-lessac-medium',
    name: 'Lessac (US Female)',
    language: 'en_US',
    quality: 'medium',
    hfPath: 'en/en_US/lessac/medium',
  },
  {
    id: 'en_US-amy-medium',
    name: 'Amy (US Female)',
    language: 'en_US',
    quality: 'medium',
    hfPath: 'en/en_US/amy/medium',
  },
  {
    id: 'en_US-ryan-medium',
    name: 'Ryan (US Male)',
    language: 'en_US',
    quality: 'medium',
    hfPath: 'en/en_US/ryan/medium',
  },
  {
    id: 'en_GB-alan-medium',
    name: 'Alan (UK Male)',
    language: 'en_GB',
    quality: 'medium',
    hfPath: 'en/en_GB/alan/medium',
  },
  {
    id: 'en_GB-alba-medium',
    name: 'Alba (UK Female)',
    language: 'en_GB',
    quality: 'medium',
    hfPath: 'en/en_GB/alba/medium',
  },
  {
    id: 'es_ES-davefx-medium',
    name: 'Davefx (Spanish Male)',
    language: 'es_ES',
    quality: 'medium',
    hfPath: 'es/es_ES/davefx/medium',
  },
  {
    id: 'fr_FR-siwis-medium',
    name: 'Siwis (French Female)',
    language: 'fr_FR',
    quality: 'medium',
    hfPath: 'fr/fr_FR/siwis/medium',
  },
  {
    id: 'de_DE-thorsten-medium',
    name: 'Thorsten (German Male)',
    language: 'de_DE',
    quality: 'medium',
    hfPath: 'de/de_DE/thorsten/medium',
  },
  {
    id: 'it_IT-paola-medium',
    name: 'Paola (Italian Female)',
    language: 'it_IT',
    quality: 'medium',
    hfPath: 'it/it_IT/paola/medium',
  },
  {
    id: 'pt_BR-faber-medium',
    name: 'Faber (Portuguese Male)',
    language: 'pt_BR',
    quality: 'medium',
    hfPath: 'pt/pt_BR/faber/medium',
  },
];

const SPEED_PRESETS = [
  { value: '0.75', label: '0.75x — Slow & Clear', speed: 0.75 },
  { value: '0.90', label: '0.90x — Slightly Slow', speed: 0.9 },
  { value: '1.00', label: '1.00x — Normal (Default)', speed: 1.0 },
  { value: '1.15', label: '1.15x — Slightly Fast', speed: 1.15 },
  { value: '1.30', label: '1.30x — Fast', speed: 1.3 },
  { value: '1.50', label: '1.50x — Very Fast', speed: 1.5 },
  { value: '1.75', label: '1.75x — Rapid', speed: 1.75 },
];

function getInstalledModels(modelsDir) {
  const installed = new Set();
  try {
    if (!fs.existsSync(modelsDir)) return installed;
    const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.onnx')) {
        installed.add(entry.name.slice(0, -'.onnx'.length));
      }
    }
  } catch {
    return installed;
  }
  return installed;
}

function getAllAvailableVoices(modelsDir) {
  const installed = getInstalledModels(modelsDir);
  const catalogIds = new Set(VOICE_MODELS.map((v) => v.id));
  const combined = VOICE_MODELS.map((voice) => ({
    ...voice,
    installed: installed.has(voice.id),
  }));

  // Include any custom .onnx models dropped into PIPER_MODELS_DIR
  for (const modelId of installed) {
    if (!catalogIds.has(modelId)) {
      const langMatch = modelId.match(/^([a-z]{2}_[A-Z]{2})/);
      combined.push({
        id: modelId,
        name: `${modelId} (Custom)`,
        language: langMatch ? langMatch[1] : 'custom',
        quality: 'custom',
        hfPath: null,
        installed: true,
      });
    }
  }

  return combined;
}

function findVoiceById(voiceId, modelsDir) {
  const voices = getAllAvailableVoices(modelsDir);
  return voices.find((v) => v.id === voiceId) || null;
}

function findVoicesByLanguage(languageCode, modelsDir) {
  const voices = getAllAvailableVoices(modelsDir);
  return voices.filter((v) => v.language === languageCode);
}

function getLanguageLabel(languageCode) {
  const found = LANGUAGES.find((l) => l.code === languageCode);
  return found ? found.label : languageCode;
}

function getModelPaths(voiceId, modelsDir) {
  const safeId = path.basename(String(voiceId || ''));
  return {
    onnxPath: path.join(modelsDir, `${safeId}.onnx`),
    configPath: path.join(modelsDir, `${safeId}.onnx.json`),
  };
}

module.exports = {
  LANGUAGES,
  VOICE_MODELS,
  SPEED_PRESETS,
  getInstalledModels,
  getAllAvailableVoices,
  findVoiceById,
  findVoicesByLanguage,
  getLanguageLabel,
  getModelPaths,
};
