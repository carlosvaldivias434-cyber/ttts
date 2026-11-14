# Discord Automatic Text-to-Speech Bot (Discord.js v14.28.1 + Components V2 + Piper TTS)

A production-ready **CommonJS** Discord bot that **automatically reads normal messages aloud** in a configured text channel into a configured voice channel using **local, free Piper neural TTS** and **PostgreSQL** persistence — with a native **Discord Components V2** dark-blue control panel.

Members **never need slash commands or prefixes** to speak: once an administrator sets up the TTS text channel and voice channel, members simply type normally in that channel and the bot speaks each message in order.

---

## Features

- **Automatic Message Reading**: Reads normal messages from the designated text channel in FIFO order without any command or prefix.
- **100% Free Local TTS (Piper)**: Runs locally via Piper neural ONNX models (`piper` binary + FFmpeg PCM conversion via `ffmpeg-static`). No AWS Polly, no Google Cloud, no paid APIs.
- **Native Discord Components V2 Control Panel**:
  - `ContainerBuilder` (dark card with `#2563EB` blue accent), `SectionBuilder`, `ThumbnailBuilder`, `TextDisplayBuilder`, `SeparatorBuilder`, `ButtonBuilder`, `StringSelectMenuBuilder`, `ChannelSelectMenuBuilder`, `RoleSelectMenuBuilder`, `ModalBuilder`, `LabelBuilder`, and `MessageFlags.IsComponentsV2`.
  - Displays live bot status, Auto-TTS status, connected voice channel, configured text channel, current voice, language, speed/volume/max length, current playback, queue length, and total messages read.
  - Working buttons: **Enable Auto TTS**, **Disable Auto TTS**, **Connect Voice**, **Disconnect**, **Pause**, **Resume**, **Skip**, **Clear Queue**, **Refresh Panel**, **Advanced Settings** (modal), and **Manage Filters** (ignored roles/channels).
  - Working dropdowns: **Text Channel**, **Voice Channel**, **Voice Model**, **Language**, and **Speech Speed**.
- **PostgreSQL Persistence**: Persists guild settings, channels, voice/language/speed/volume/max-length preferences, ignored roles & channels, pending queue items, and usage statistics.
- **Safety & Reliability**:
  - Administrator-only configuration (`PermissionFlagsBits.Administrator`).
  - Ignores bots, webhooks, system messages, empty messages, attachment-only messages, bot's own messages, and ignored roles/channels.
  - Text sanitization (resolves mentions, custom emojis, strips URLs/code blocks/markdown, caps length, never executes message text as shell or bot commands).
  - Anti-spam rate limiting, duplicate message deduplication, and queue length caps.
  - Automatic voice gateway reconnection, audio playback error recovery, temp WAV cleanup, PostgreSQL reconnection, and graceful shutdown.

---

## 1. Discord Bot Permissions & Gateway Intents

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create an application and open the **Bot** tab.
2. Enable these **Privileged Gateway Intents**:
   - **MESSAGE CONTENT INTENT** (Required to read normal messages in the configured TTS text channel)
   - *(Optional)* Server Members Intent (if you want faster role/nickname cache resolution for large servers)
3. Under **OAuth2 → URL Generator**, select scopes:
   - `bot`
   - `applications.commands`
4. Select **Bot Permissions**:
   - `View Channels`
   - `Send Messages`
   - `Read Message History`
   - `Connect`
   - `Speak`
   - *(Optional)* `Manage Messages` or `Use External Emojis` if desired.

Copy your **Bot Token** (`DISCORD_TOKEN`) and **Application ID** (`DISCORD_CLIENT_ID`) into `.env`.

---

## 2. Quick Start with Docker Compose (Recommended)

Docker Compose starts **PostgreSQL 16** (with `db/init.sql` auto-applied) and builds the bot with **Piper TTS**, **FFmpeg**, and the default `en_US-lessac-medium` voice model pre-installed.

1. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`:
   ```bash
   cp .env.example .env
   ```
2. *(Optional)* Download additional voice models to `./models/piper`:
   ```bash
   bash scripts/download-voices.sh
   ```
3. Build and start both containers:
   ```bash
   docker compose up -d --build
   ```
4. View logs:
   ```bash
   docker compose logs -f tts-bot
   ```

---

## 3. Linux Installation Instructions (Ubuntu / Debian)

### Prerequisites
- Node.js **20+**
- PostgreSQL **14+**
- `curl`, `tar`, `ffmpeg`

### Steps
1. **Install dependencies**:
   ```bash
   sudo apt update && sudo apt install -y curl tar ffmpeg postgresql postgresql-contrib
   ```
2. **Create PostgreSQL user and database**:
   ```bash
   sudo -u postgres psql -c "CREATE USER ttsbot WITH PASSWORD 'ttsbot_secure_password';"
   sudo -u postgres psql -c "CREATE DATABASE discord_tts OWNER ttsbot;"
   ```
3. **Install Node dependencies**:
   ```bash
   npm install
   ```
4. **Install Piper TTS binary and voice models**:
   ```bash
   chmod +x scripts/download-voices.sh
   ./scripts/download-voices.sh
   ```
   This installs Piper to `./bin/piper/piper` and downloads multi-language `.onnx` + `.onnx.json` models to `./models/piper/`.
5. **Configure `.env`**:
   ```bash
   cp .env.example .env
   ```
   Set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`, and:
   ```env
   PIPER_BIN_PATH=./bin/piper/piper
   PIPER_MODELS_DIR=./models/piper
   ```
6. **Run database schema migration & deploy slash commands**:
   ```bash
   npm run db:migrate
   npm run deploy-commands
   ```
7. **Start the bot**:
   ```bash
   npm start
   ```

---

## 4. Windows Installation Instructions (Windows 10 / 11)

### Prerequisites
- **Node.js 20 LTS** ([nodejs.org](https://nodejs.org/))
- **PostgreSQL 16** ([postgresql.org/download/windows](https://www.postgresql.org/download/windows/))

### Steps
1. Open **PowerShell** in the project folder and install Node packages:
   ```powershell
   npm install
   ```
   *(Note: `ffmpeg-static` and `opusscript` are bundled so no Visual Studio C++ build tools are required.)*
2. **Download Piper for Windows and voice models**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\download-voices.ps1
   ```
   This downloads `piper_windows_amd64.zip` into `.\bin\piper\piper.exe` and installs voice models into `.\models\piper\`.
3. **Initialize PostgreSQL database** (using `psql` or pgAdmin):
   ```sql
   CREATE USER ttsbot WITH PASSWORD 'ttsbot_secure_password';
   CREATE DATABASE discord_tts OWNER ttsbot;
   ```
4. **Create `.env`** from `.env.example`:
   ```powershell
   Copy-Item .env.example .env
   ```
   Edit `.env` and set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`, and:
   ```env
   PIPER_BIN_PATH=.\bin\piper\piper.exe
   PIPER_MODELS_DIR=.\models\piper
   ```
5. **Run database migration & deploy slash commands**:
   ```powershell
   npm run db:migrate
   npm run deploy-commands
   ```
6. **Start the bot**:
   ```powershell
   npm start
   ```

---

## 5. Voice Model Installation

Curated voice models included in `scripts/download-voices.sh` and `scripts/download-voices.ps1`:
- `en_US-lessac-medium` — English (US) Female
- `en_US-amy-medium` — English (US) Female
- `en_US-ryan-medium` — English (US) Male
- `en_GB-alan-medium` — English (UK) Male
- `en_GB-alba-medium` — English (UK) Female
- `es_ES-davefx-medium` — Spanish (Spain) Male
- `fr_FR-siwis-medium` — French (France) Female
- `de_DE-thorsten-medium` — German (Germany) Male
- `it_IT-paola-medium` — Italian (Italy) Female
- `pt_BR-faber-medium` — Portuguese (Brazil) Male

You can also drop **any** Piper `.onnx` + `.onnx.json` model pair from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) into `./models/piper/` and the bot will automatically detect and list it!

---

## 6. Slash Commands (Admin Configuration Only)

| Command | Description |
| --- | --- |
| `/tts setup` | Set the automatic TTS text channel & voice channel |
| `/tts panel` | Post the interactive Components V2 Control Panel |
| `/tts enable` | Enable automatic message reading |
| `/tts disable` | Disable automatic message reading |
| `/tts connect` | Connect the bot to the configured voice channel |
| `/tts disconnect` | Disconnect the bot from voice |
| `/tts settings` | View or update volume, max length, rate limit, ignored roles/channels |
| `/tts voice` | Choose a local Piper voice model |
| `/tts language` | Choose TTS language |
| `/tts speed` | Set speech playback speed (`0.50x` – `2.00x`) |
| `/tts queue` | View current playback & pending message queue |
| `/tts skip` | Skip the currently playing message |
| `/tts clear` | Clear all pending queued messages |
| `/tts statistics` | View server TTS usage statistics |
