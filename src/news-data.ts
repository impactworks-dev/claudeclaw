// AI news data layer.
//
// Pulls "AI" news from the last 24 hours via Google News RSS — no API
// key, no auth, fast XML response. Equivalent to the user typing
// "AI" into news.google.com with the "Past 24 hours" filter and
// hitting the RSS export.
//
// Cache: 10 minutes on the persistent volume. The feed updates
// constantly throughout the day; 10min keeps the page snappy without
// hammering Google or showing data more than a few minutes stale.
//
// Source query can be overridden via AI_NEWS_QUERY env var; defaults to
// a sane "AI OR artificial intelligence" combo with the 1d filter.

import path from 'node:path';
import fs from 'node:fs';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const CACHE_FILE = path.join(STORE_DIR, 'ai-news-cache.json');
const TTL_MS = 10 * 60 * 1000;

// Default search: items from past 24 hours, mentioning AI or artificial intelligence.
// Google News query syntax: when:1d = last 24 hours; OR = logical or.
const DEFAULT_QUERY = '("artificial intelligence" OR "AI") when:1d';

export interface NewsItem {
  title: string;
  link: string;
  source: string | null;     // Publisher name (parsed from <source> tag)
  pubDate: number | null;    // epoch ms
  description: string | null;
  // Publisher logo/favicon for visual identification. We use Google's
  // public s2/favicons proxy (no auth, cached on their CDN, returns a
  // PNG square at the requested size). Frontend renders this as a small
  // circular badge next to the story title.
  iconUrl: string | null;
  // Publisher domain (e.g. "politico.com") extracted from the source URL.
  // Useful for sorting / grouping / showing a small text label too.
  sourceDomain: string | null;
}

export interface NewsSummary {
  asOf: number;
  query: string;
  items: NewsItem[];
  error?: string | null;
}

function readCache(): NewsSummary | null {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - j.asOf < TTL_MS) return j;
  } catch { /* ignore */ }
  return null;
}
function writeCache(data: NewsSummary): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'news: cache write failed');
  }
}

// --- XML parsing ---
//
// Google News RSS structure (per item):
//   <item>
//     <title>Foo bar - The Verge</title>
//     <link>https://news.google.com/rss/articles/CBM...</link>
//     <guid isPermaLink="false">...</guid>
//     <pubDate>Tue, 03 Jun 2026 14:23:00 GMT</pubDate>
//     <description><![CDATA[<a href="...">Foo bar</a>&nbsp;&nbsp;<font color="#6f6f6f">The Verge</font>]]></description>
//     <source url="https://www.theverge.com">The Verge</source>
//   </item>
//
// We use simple regex extraction rather than a full XML parser — the
// schema is stable and a 3rd-party dep is unnecessary for one feed.

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function stripCdata(s: string): string {
  const m = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return m ? m[1] : s;
}

function pick(itemXml: string, tag: string): string | null {
  // Greedy until the matching close. RSS items don't nest the same tag inside
  // themselves at item-scope so a non-greedy match is safe.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
  const m = itemXml.match(re);
  if (!m) return null;
  return decodeEntities(stripCdata(m[1].trim()));
}

function pickAttr(itemXml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\s+[^>]*${attr}="([^"]*)"`);
  const m = itemXml.match(re);
  return m ? m[1] : null;
}

// Extract the bare host from a URL, ignoring port + protocol.
// Returns null if the URL is unparseable.
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const title = pick(block, 'title');
    const link = pick(block, 'link');
    const description = pick(block, 'description');
    const pubDateStr = pick(block, 'pubDate');
    const source = pick(block, 'source');
    // Google News RSS items put the publisher's homepage URL on the <source>
    // tag's url= attribute. We use that domain (not the news.google.com
    // redirect link) to fetch the favicon.
    const sourceUrl = pickAttr(block, 'source', 'url');
    if (!title || !link) continue;

    // Google News titles end in " - <Source>" — strip that for cleaner display
    // since we already track the source separately.
    let cleanedTitle = title;
    if (source) {
      const tail = new RegExp(`\\s+[-\\u2013\\u2014]\\s+${source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`);
      cleanedTitle = title.replace(tail, '').trim() || title;
    }

    const pubDate = pubDateStr ? Date.parse(pubDateStr) : null;
    const sourceDomain = hostOf(sourceUrl) || null;
    // Google's public favicon proxy: returns a square PNG at the requested
    // size. sz=64 is the smallest that still looks decent in a circular crop
    // on retina displays. CDN-cached, no auth.
    const iconUrl = sourceDomain
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(sourceDomain)}&sz=64`
      : null;

    items.push({
      title: cleanedTitle,
      link,
      source: source || null,
      pubDate: pubDate && !isNaN(pubDate) ? pubDate : null,
      description: description || null,
      iconUrl,
      sourceDomain,
    });
  }
  return items;
}

export async function getNewsData(opts: { force?: boolean; limit?: number } = {}): Promise<NewsSummary> {
  if (!opts.force) {
    const c = readCache();
    if (c) return c;
  }

  const query = process.env.AI_NEWS_QUERY || DEFAULT_QUERY;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

  let xml = '';
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!r.ok) {
      const err = `HTTP ${r.status}`;
      const result: NewsSummary = { asOf: Date.now(), query, items: [], error: err };
      writeCache(result);
      return result;
    }
    xml = await r.text();
  } catch (e) {
    const err = String((e as Error)?.message || e);
    return { asOf: Date.now(), query, items: [], error: err };
  }

  const items = parseRss(xml);
  // Cap to top-N freshest items
  const limit = opts.limit ?? 12;
  items.sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0));
  const trimmed = items.slice(0, limit);

  const result: NewsSummary = { asOf: Date.now(), query, items: trimmed };
  writeCache(result);
  return result;
}
