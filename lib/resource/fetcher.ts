/**
 * Resource fetching utilities — fetch and inline external resources.
 * Respects rate limits with exponential backoff.
 */

import { getLogger } from '../logger';

const log = getLogger('fetcher');

interface FetchOptions {
  timeout?: number;
  maxRetries?: number;
  baseDelay?: number;
}

const DEFAULT_OPTIONS: FetchOptions = {
  timeout: 10000,
  maxRetries: 3,
  baseDelay: 200,
};

// Rate limiting — max concurrent requests
let activeRequests = 0;
const MAX_CONCURRENT = 4;
const queue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return;
  }
  return new Promise(resolve => {
    queue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests--;
  const next = queue.shift();
  if (next) next();
}

export async function fetchText(url: string, options?: FetchOptions): Promise<string | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < opts.maxRetries!; attempt++) {
    try {
      await acquireSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeout);

      const res = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      });
      clearTimeout(timer);
      releaseSlot();

      if (!res.ok) return null;
      return res.text();
    } catch (err) {
      releaseSlot();
      lastError = err as Error;
      if (attempt < opts.maxRetries! - 1) {
        await sleep(opts.baseDelay! * Math.pow(2, attempt));
      }
    }
  }

  log.warn(`Failed to fetch text`, { url, error: lastError?.message });
  return null;
}

export async function fetchAsDataUri(url: string, options?: FetchOptions): Promise<string | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < opts.maxRetries!; attempt++) {
    try {
      await acquireSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeout);

      const res = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      });
      clearTimeout(timer);
      releaseSlot();

      if (!res.ok) return null;

      const blob = await res.blob();
      // Skip very large resources (>5MB)
      if (blob.size > 5 * 1024 * 1024) {
        return url; // Return original URL
      }

      return blobToDataUri(blob);
    } catch (err) {
      releaseSlot();
      lastError = err as Error;
      if (attempt < opts.maxRetries! - 1) {
        await sleep(opts.baseDelay! * Math.pow(2, attempt));
      }
    }
  }

  log.warn(`Failed to fetch resource`, { url, error: lastError?.message });
  return null;
}

export async function fetchAsBlob(url: string, options?: FetchOptions): Promise<Blob | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let attempt = 0; attempt < opts.maxRetries!; attempt++) {
    try {
      await acquireSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeout);

      const res = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      });
      clearTimeout(timer);
      releaseSlot();

      if (!res.ok) return null;
      return res.blob();
    } catch (err) {
      releaseSlot();
      if (attempt < opts.maxRetries! - 1) {
        await sleep(opts.baseDelay! * Math.pow(2, attempt));
      }
    }
  }

  return null;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
