#!/usr/bin/env bash
set -euo pipefail

PIPER_VERSION="${PIPER_VERSION:-2023.11.14-2}"
PIPER_INSTALL_DIR="${PIPER_INSTALL_DIR:-./bin}"
MODELS_DIR="${PIPER_MODELS_DIR:-./models/piper}"

mkdir -p "$PIPER_INSTALL_DIR" "$MODELS_DIR"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" = "Linux" ]; then
  if [ "$ARCH" = "x86_64" ]; then
    PIPER_ARCHIVE="piper_linux_x86_64.tar.gz"
  elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    PIPER_ARCHIVE="piper_linux_aarch64.tar.gz"
  elif [ "$ARCH" = "armv7l" ]; then
    PIPER_ARCHIVE="piper_linux_armv7l.tar.gz"
  else
    echo "Unsupported Linux architecture: $ARCH"
    exit 1
  fi
elif [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    PIPER_ARCHIVE="piper_macos_aarch64.tar.gz"
  else
    PIPER_ARCHIVE="piper_macos_x64.tar.gz"
  fi
else
  echo "Unsupported OS for this script: $OS (use scripts/download-voices.ps1 on Windows)"
  exit 1
fi

if [ ! -f "$PIPER_INSTALL_DIR/piper/piper" ]; then
  echo "Downloading Piper ($PIPER_ARCHIVE)..."
  curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/${PIPER_ARCHIVE}" \
    | tar -xz -C "$PIPER_INSTALL_DIR"
  chmod +x "$PIPER_INSTALL_DIR/piper/piper"
  echo "Piper installed at $PIPER_INSTALL_DIR/piper/piper"
else
  echo "Piper already exists at $PIPER_INSTALL_DIR/piper/piper"
fi

download_model() {
  local base_url="$1"
  local model_id="$2"
  local onnx_path="$MODELS_DIR/${model_id}.onnx"
  local json_path="$MODELS_DIR/${model_id}.onnx.json"

  if [ ! -f "$onnx_path" ]; then
    echo "Downloading ${model_id}.onnx..."
    curl -fsSL "${base_url}/${model_id}.onnx" -o "$onnx_path"
  fi
  if [ ! -f "$json_path" ]; then
    echo "Downloading ${model_id}.onnx.json..."
    curl -fsSL "${base_url}/${model_id}.onnx.json" -o "$json_path"
  fi
}

HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"

# Curated multi-language Piper voice models
download_model "${HF_BASE}/en/en_US/lessac/medium" "en_US-lessac-medium"
download_model "${HF_BASE}/en/en_US/amy/medium" "en_US-amy-medium"
download_model "${HF_BASE}/en/en_US/ryan/medium" "en_US-ryan-medium"
download_model "${HF_BASE}/en/en_GB/alan/medium" "en_GB-alan-medium"
download_model "${HF_BASE}/en/en_GB/alba/medium" "en_GB-alba-medium"
download_model "${HF_BASE}/es/es_ES/davefx/medium" "es_ES-davefx-medium"
download_model "${HF_BASE}/fr/fr_FR/siwis/medium" "fr_FR-siwis-medium"
download_model "${HF_BASE}/de/de_DE/thorsten/medium" "de_DE-thorsten-medium"
download_model "${HF_BASE}/it/it_IT/paola/medium" "it_IT-paola-medium"
download_model "${HF_BASE}/pt/pt_BR/faber/medium" "pt_BR-faber-medium"

echo "All Piper voice models downloaded to $MODELS_DIR"
