'use strict';

const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

function buildAdvancedSettingsModal(settings) {
  const modal = new ModalBuilder()
    .setCustomId('tts:modal:advanced_settings')
    .setTitle('Advanced Automatic TTS Settings');

  const maxLenInput = new TextInputBuilder()
    .setCustomId('max_message_length')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(4)
    .setPlaceholder('e.g. 300 (range 20 - 2000)')
    .setValue(String(settings.maxMessageLength));

  const volumeInput = new TextInputBuilder()
    .setCustomId('volume')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(3)
    .setPlaceholder('e.g. 100 (range 10 - 200)')
    .setValue(String(settings.volume));

  const speedInput = new TextInputBuilder()
    .setCustomId('speech_speed')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(4)
    .setPlaceholder('e.g. 1.0 (range 0.50 - 2.00)')
    .setValue(Number(settings.speechSpeed).toFixed(2));

  const rateLimitInput = new TextInputBuilder()
    .setCustomId('rate_limit_ms')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(5)
    .setPlaceholder('e.g. 2500 (range 0 - 60000 ms)')
    .setValue(String(settings.rateLimitMs));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Max Message Length (20 - 2000 chars)')
      .setDescription('Messages longer than this will be safely truncated.')
      .setTextInputComponent(maxLenInput),
    new LabelBuilder()
      .setLabel('Playback Volume % (10 - 200)')
      .setDescription('Adjusts Piper speech volume in voice channels.')
      .setTextInputComponent(volumeInput),
    new LabelBuilder()
      .setLabel('Speech Speed (0.50 - 2.00)')
      .setDescription('1.00 is normal speed; higher values speak faster.')
      .setTextInputComponent(speedInput),
    new LabelBuilder()
      .setLabel('Per-User Rate Limit in ms (0 - 60000)')
      .setDescription('Minimum cooldown between messages from the same user.')
      .setTextInputComponent(rateLimitInput)
  );

  return modal;
}

module.exports = {
  buildAdvancedSettingsModal,
};
