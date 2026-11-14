FROM node:20-bookworm-slim

ARG TARGETARCH
ARG PIPER_VERSION=2023.11.14-2

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    libatomic1 \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Install local Piper TTS binary for amd64 or arm64
RUN mkdir -p /usr/local/bin/piper /app/models/piper /app/tmp/tts && \
    ARCH="$(dpkg --print-architecture)" && \
    if [ "$ARCH" = "amd64" ]; then PIPER_ARCH="linux_x86_64"; \
    elif [ "$ARCH" = "arm64" ]; then PIPER_ARCH="linux_aarch64"; \
    else echo "Unsupported architecture: $ARCH" && exit 1; fi && \
    curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_${PIPER_ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin && \
    chmod +x /usr/local/bin/piper/piper

# Download default English Piper voice model (en_US-lessac-medium)
RUN curl -fsSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx" \
      -o /app/models/piper/en_US-lessac-medium.onnx && \
    curl -fsSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" \
      -o /app/models/piper/en_US-lessac-medium.onnx.json

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY db ./db
COPY scripts ./scripts
COPY src ./src

ENV NODE_ENV=production \
    PIPER_BIN_PATH=/usr/local/bin/piper/piper \
    PIPER_MODELS_DIR=/app/models/piper \
    TTS_TEMP_DIR=/app/tmp/tts

RUN chown -R node:node /app
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
