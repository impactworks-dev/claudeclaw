import { GoogleGenAI } from '@google/genai';

import { GOOGLE_API_KEY } from './config.js';
import { logger } from './logger.js';
import { requireEnabled } from './kill-switches.js';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is not set. Add it to .env for memory extraction.');
  }
  client = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
  return client;
}

/**
 * Generate text content via Gemini.
 * Defaults to gemini-2.5-flash. Google's free tier on 2.0 models was retired
 * in 2026; 2.5-flash is the current flash-tier default with the same API shape.
 *
 * thinkingBudget is set to 0 by default to prevent Gemini 2.5 Flash from
 * leaking chain-of-thought "reasoning" fields into structured JSON responses,
 * which breaks JSON.parse with "Expected ',' or ']' after array element".
 */
export async function generateContent(
  prompt: string,
  model = 'gemini-2.5-flash',
  mimeType: 'application/json' | 'text/plain' = 'application/json',
): Promise<string> {
  // Kill-switch: refuse Gemini calls when LLM_SPAWN_ENABLED is off.
  requireEnabled('LLM_SPAWN_ENABLED');
  const ai = getClient();
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: mimeType,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    if (!response.text) {
      logger.warn({ model }, 'Gemini returned empty response');
      return '';
    }
    return response.text;
  } catch (err) {
    logger.error({ err, model }, 'Gemini generateContent failed');
    throw err;
  }
}

/**
 * Sanitize a JSON string by escaping literal control characters
 * (newlines, carriage returns, tabs) that appear inside string values.
 */
function sanitizeJsonControlChars(text: string): string {
  let inString = false;
  let escaped = false;
  let result = '';
  for (const ch of text) {
    if (escaped) {
      result += ch;
      escaped = false;
    } else if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
    } else if (ch === '"') {
      result += ch;
      inString = !inString;
    } else if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
      result += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Parse a JSON response from Gemini, with fallback on malformed output.
 * Returns null if parsing fails.
 */
export function parseJsonResponse<T>(text: string): T | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    try {
      const sanitized = sanitizeJsonControlChars(cleaned);
      return JSON.parse(sanitized) as T;
    } catch (err) {
      logger.warn({ err, text: text.slice(0, 200) }, 'Failed to parse Gemini JSON response');
      return null;
    }
  }
}
