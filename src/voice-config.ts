// Persistent voice configuration on the Fly volume.
//
// The active ElevenLabs voice ID is stored at /app/store/voice-config.json
// so the dashboard's voice picker can update it instantly without bouncing
// the machine or rotating Fly secrets. Falls back to the ELEVENLABS_VOICE_ID
// env var when the file is missing.
//
// Used by both src/voice.ts (Telegram/WarRoom TTS cascade) and the
// /api/chat/tts endpoint so Nikki sounds the same on every channel.

import fs from 'node:fs';
import path from 'node:path';
import { STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const FILE = path.join(STORE_DIR, 'voice-config.json');

interface Storage {
  elevenlabsVoiceId?: string;
  updatedAt?: number;
}

function readFile(): Storage | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Storage;
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'voice-config: read failed');
    return null;
  }
}

function writeFile(data: Storage): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.error({ err: String((e as Error)?.message || e) }, 'voice-config: write failed');
    throw e;
  }
}

/**
 * Get the active ElevenLabs voice ID. Priority:
 *   1. /app/store/voice-config.json (set via dashboard picker)
 *   2. ELEVENLABS_VOICE_ID env var (Fly secret fallback)
 * Returns empty string when neither is set.
 */
export function getElevenLabsVoiceId(): string {
  const fromFile = readFile()?.elevenlabsVoiceId;
  if (fromFile && fromFile.trim()) return fromFile.trim();
  const env = readEnvFile(['ELEVENLABS_VOICE_ID']);
  return (env.ELEVENLABS_VOICE_ID || '').trim();
}

/** Set the active ElevenLabs voice ID on the volume. */
export function setElevenLabsVoiceId(voiceId: string): void {
  const clean = String(voiceId || '').trim();
  if (!clean) throw new Error('voiceId required');
  writeFile({ elevenlabsVoiceId: clean, updatedAt: Date.now() });
}
