/**
 * Yuque (语雀) integration — full API client for browser extension.
 *
 * Based on yuque-ai-mcp api-client patterns:
 * - Exponential backoff retry (1s → 2s → 4s, max 3)
 * - Proper error handling
 * - Token-based auth (Yuque doesn't have OAuth for third-party apps)
 * - Repo listing + picker
 * - TOC support
 */

const API_BASE = 'https://www.yuque.com/api/v2';
const MAX_RETRIES = 3;
const BASE_DELAY = 1000;
const REQUEST_TIMEOUT = 30_000;

// ===== Types =====

export interface YuqueRepo {
  id: number;
  type: string;
  name: string;
  slug: string;
  namespace: string;
  description: string;
  public: number;
  items_count: number;
  created_at: string;
}

export interface YuqueUser {
  id: number;
  name: string;
  login: string;
  avatar_url: string;
}

export interface YuqueDoc {
  id: number;
  title: string;
  slug: string;
  url: string;
  created_at: string;
}

export interface SaveResult {
  success: boolean;
  url?: string;
  docId?: number;
  error?: string;
}

// ===== HTTP Client with Retry =====

function shouldRetry(res: Response | null): boolean {
  if (!res) return true;
  return res.status === 429 || (res.status >= 500 && res.status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  attempt = 1,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });

    if (shouldRetry(res) && attempt <= MAX_RETRIES) {
      const delay = BASE_DELAY * Math.pow(2, attempt - 1);
      console.warn(`[Yuque] Retry ${attempt} after ${delay}ms (${res.status})`);
      await sleep(delay);
      return fetchWithRetry(url, options, attempt + 1);
    }

    return res;
  } catch (err) {
    if (attempt <= MAX_RETRIES) {
      const delay = BASE_DELAY * Math.pow(2, attempt - 1);
      console.warn(`[Yuque] Retry ${attempt} after network error, ${delay}ms`);
      await sleep(delay);
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return { 'X-Auth-Token': token, ...extra };
}

// ===== API Methods =====

/** Test connection and get user info */
export async function yuqueGetUser(token: string): Promise<{ success: boolean; user?: YuqueUser; error?: string }> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/user`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { success: true, user: data.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** List user's repos (knowledge bases) */
export async function yuqueListRepos(token: string): Promise<{ success: boolean; repos?: YuqueRepo[]; error?: string }> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/user/repos?type=all`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { success: true, repos: data.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** List groups the user belongs to */
export async function yuqueListGroups(token: string): Promise<{ success: boolean; groups?: Array<{ id: number; name: string; login: string }>; error?: string }> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/user/groups`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { success: true, groups: data.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** List repos in a group */
export async function yuqueListGroupRepos(token: string, groupLogin: string): Promise<{ success: boolean; repos?: YuqueRepo[]; error?: string }> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/groups/${groupLogin}/repos`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { success: true, repos: data.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Create a document in a repo */
export async function yuqueCreateDoc(
  token: string,
  repoId: number,
  title: string,
  body: string,
  options?: {
    slug?: string;
    format?: 'markdown' | 'html' | 'lake';
    isPublic?: number;
    parentUuid?: string;
  }
): Promise<SaveResult> {
  try {
    const payload: Record<string, unknown> = {
      title,
      body,
      format: options?.format || 'markdown',
    };
    if (options?.slug) payload.slug = options.slug;
    if (options?.isPublic !== undefined) payload.public = options.isPublic;

    const res = await fetchWithRetry(`${API_BASE}/repos/${repoId}/docs`, {
      method: 'POST',
      headers: authHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = (errData as any)?.message || `HTTP ${res.status}`;
      return { success: false, error: msg };
    }

    const data = await res.json();
    const doc = data.data;

    // If parentUuid specified, append to TOC
    if (options?.parentUuid && doc?.id) {
      try {
        await fetchWithRetry(`${API_BASE}/repos/${repoId}/toc`, {
          method: 'POST',
          headers: authHeaders(token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            action: 'appendNode',
            target_uuid: options.parentUuid,
            doc_id: doc.id,
          }),
        });
      } catch { /* TOC append is best-effort */ }
    }

    return { success: true, url: doc?.url || doc?.slug, docId: doc?.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Update an existing document */
export async function yuqueUpdateDoc(
  token: string,
  repoId: number,
  docId: number,
  title: string,
  body: string,
  options?: { format?: 'markdown' | 'html' | 'lake'; isPublic?: number }
): Promise<SaveResult> {
  try {
    const payload: Record<string, unknown> = {
      title,
      body,
      format: options?.format || 'markdown',
    };
    if (options?.isPublic !== undefined) payload.public = options.isPublic;

    const res = await fetchWithRetry(`${API_BASE}/repos/${repoId}/docs/${docId}`, {
      method: 'PUT',
      headers: authHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { success: false, error: (errData as any)?.message || `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { success: true, url: data.data?.url, docId: data.data?.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Search for a document by title in a repo (for auto-save dedup) */
export async function yuqueSearchDoc(
  token: string,
  repoId: number,
  title: string,
): Promise<{ success: boolean; doc?: YuqueDoc; error?: string }> {
  try {
    const res = await fetchWithRetry(
      `${API_BASE}/repos/${repoId}/docs?q=${encodeURIComponent(title)}`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const docs = data.data || [];
    // Find exact title match
    const match = docs.find((d: YuqueDoc) => d.title === title);
    return { success: true, doc: match };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Get repo TOC */
export async function yuqueGetToc(
  token: string,
  repoId: number,
): Promise<{ success: boolean; toc?: unknown; error?: string }> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/repos/${repoId}/toc`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { success: true, toc: data.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
