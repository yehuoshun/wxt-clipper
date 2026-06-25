/**
 * Yuque (语雀) integration — OAuth-style one-click auth + full API client.
 *
 * Since browser extensions can't securely store OAuth client_secret,
 * we use a "Token-based one-click auth" flow:
 *   1. Click "一键授权" → opens yuque token settings page
 *   2. User creates/pastes token → auto-validate → auto-fetch repos
 *   3. Select repo → done
 *
 * API patterns based on yuque-ai-mcp api-client + webclipper yuque_oauth service.
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
  description: string;
}

export interface YuqueGroup {
  id: number;
  name: string;
  login: string;
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

async function sleep(ms: number): Promise<void> {
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

// ===== OAuth-Style One-Click Auth =====

/** Open yuque token settings page for one-click auth */
export function openYuqueTokenPage(): void {
  window.open('https://www.yuque.com/settings/tokens', '_blank');
}

/** Validate token and get user info (like OAuth callback verification) */
export async function yuqueGetUser(token: string): Promise<{ success: boolean; user?: YuqueUser; error?: string }> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/user`, {
      headers: authHeaders(token),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { success: false, error: (errData as any)?.message || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { success: true, user: data.data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ===== Repository Management =====

/** List all user repos with pagination (like webclipper's getAllRepositories) */
export async function yuqueListAllRepos(
  token: string,
  repoType: 'all' | 'self' | 'group' = 'all'
): Promise<{ success: boolean; repos?: Array<YuqueRepo & { groupName?: string }>; error?: string }> {
  try {
    const userResult = await yuqueGetUser(token);
    if (!userResult.success || !userResult.user) {
      return { success: false, error: userResult.error || 'Invalid token' };
    }
    const user = userResult.user;

    let repos: Array<YuqueRepo & { groupName?: string }> = [];

    // Fetch user's own repos
    if (repoType !== 'group') {
      let offset = 0;
      let batch: YuqueRepo[];
      do {
        const res = await fetchWithRetry(
          `${API_BASE}/users/${user.login}/repos?offset=${offset}`,
          { headers: authHeaders(token) },
        );
        if (!res.ok) break;
        const data = await res.json();
        batch = data.data || [];
        repos.push(...batch.map((r: YuqueRepo) => ({ ...r })));
        offset += batch.length;
      } while (batch.length === 20);
    }

    // Fetch group repos
    if (repoType !== 'self') {
      const groupsRes = await fetchWithRetry(
        `${API_BASE}/users/${user.login}/groups`,
        { headers: authHeaders(token) },
      );
      if (groupsRes.ok) {
        const groupsData = await groupsRes.json();
        const groups: YuqueGroup[] = groupsData.data || [];

        for (const group of groups) {
          let offset = 0;
          let batch: YuqueRepo[];
          do {
            const res = await fetchWithRetry(
              `${API_BASE}/groups/${group.login}/repos?offset=${offset}`,
              { headers: authHeaders(token) },
            );
            if (!res.ok) break;
            const data = await res.json();
            batch = data.data || [];
            repos.push(...batch.map((r: YuqueRepo) => ({
              ...r,
              name: `[${group.name}] ${r.name}`,
              groupName: group.name,
            })));
            offset += batch.length;
          } while (batch.length === 20);
        }
      }
    }

    return { success: true, repos };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ===== Document Operations =====

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
      return { success: false, error: (errData as any)?.message || `HTTP ${res.status}` };
    }

    const data = await res.json();
    const doc = data.data;

    // TOC append (best-effort)
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
      } catch { /* best-effort */ }
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

/** Search for a document by title (for auto-save dedup) */
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
    const docs: YuqueDoc[] = data.data || [];
    const match = docs.find(d => d.title === title);
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
