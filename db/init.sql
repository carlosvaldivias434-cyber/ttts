-- ============================================================================
-- Discord Automatic TTS Bot - PostgreSQL Schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id            VARCHAR(32) PRIMARY KEY,
  text_channel_id     VARCHAR(32) DEFAULT NULL,
  voice_channel_id    VARCHAR(32) DEFAULT NULL,
  panel_channel_id    VARCHAR(32) DEFAULT NULL,
  panel_message_id    VARCHAR(32) DEFAULT NULL,
  tts_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  auto_connect        BOOLEAN NOT NULL DEFAULT TRUE,
  announce_author     BOOLEAN NOT NULL DEFAULT FALSE,
  voice_model         VARCHAR(128) NOT NULL DEFAULT 'en_US-lessac-medium',
  language            VARCHAR(32) NOT NULL DEFAULT 'en_US',
  speech_speed        NUMERIC(4, 2) NOT NULL DEFAULT 1.00
                        CHECK (speech_speed >= 0.50 AND speech_speed <= 2.00),
  volume              INTEGER NOT NULL DEFAULT 100
                        CHECK (volume >= 10 AND volume <= 200),
  max_message_length  INTEGER NOT NULL DEFAULT 300
                        CHECK (max_message_length >= 20 AND max_message_length <= 2000),
  rate_limit_ms       INTEGER NOT NULL DEFAULT 2500
                        CHECK (rate_limit_ms >= 0 AND rate_limit_ms <= 60000),
  ignored_roles       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ignored_channels    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  total_messages_read BIGINT NOT NULL DEFAULT 0,
  total_characters_read BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tts_queue (
  id                  BIGSERIAL PRIMARY KEY,
  guild_id            VARCHAR(32) NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  message_id          VARCHAR(32) NOT NULL,
  channel_id          VARCHAR(32) NOT NULL,
  author_id           VARCHAR(32) NOT NULL,
  author_name         VARCHAR(128) NOT NULL,
  raw_content         TEXT NOT NULL,
  sanitized_text      TEXT NOT NULL,
  voice_model         VARCHAR(128) NOT NULL,
  speech_speed        NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
  status              VARCHAR(16) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'playing')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_tts_queue_guild_status_id
  ON tts_queue (guild_id, status, id);

CREATE TABLE IF NOT EXISTS tts_usage_logs (
  id                  BIGSERIAL PRIMARY KEY,
  guild_id            VARCHAR(32) NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  author_id           VARCHAR(32) NOT NULL,
  voice_model         VARCHAR(128) NOT NULL,
  language            VARCHAR(32) NOT NULL,
  character_count     INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tts_usage_logs_guild_created
  ON tts_usage_logs (guild_id, created_at DESC);

-- Trigger to automatically maintain updated_at on guild_settings
CREATE OR REPLACE FUNCTION update_guild_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guild_settings_updated_at ON guild_settings;
CREATE TRIGGER trg_guild_settings_updated_at
  BEFORE UPDATE ON guild_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_guild_settings_timestamp();
