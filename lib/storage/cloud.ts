/**
 * Cloud storage backends for clipped content.
 */

interface StorageConfig {
  type: 'yuque' | 'github' | 'webdav' | 'none';
  token?: string;
  repo?: string;
  endpoint?: string;
}

interface SaveResult {
  success: boolean;
  url?: string;
  error?: string;
}

// ===== Yuque (语雀) =====

export async function saveToYuque(
  content: string,
  title: string,
  config: { token: string; repoId: number; format?: string }
): Promise<SaveResult> {
  try {
    const body = config.format === 'markdown' ? content : content;
    const res = await fetch(`https://www.yuque.com/api/v2/repos/${config.repoId}/docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': config.token,
      },
      body: JSON.stringify({
        title,
        body,
        format: config.format || 'markdown',
        public: 0,
      }),
    });

    if (!res.ok) throw new Error(`Yuque API error: ${res.status}`);
    const data = await res.json();
    return { success: true, url: data.data?.url };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ===== GitHub Gist =====

export async function saveToGist(
  content: string,
  title: string,
  config: { token: string; format?: string }
): Promise<SaveResult> {
  try {
    const ext = config.format === 'markdown' ? 'md' : 'html';
    const filename = `${title}.${ext}`;
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Authorization': `token ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: `Clipped: ${title}`,
        public: false,
        files: { [filename]: { content } },
      }),
    });

    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    return { success: true, url: data.html_url };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ===== WebDAV =====

export async function saveToWebDAV(
  content: string,
  title: string,
  config: { endpoint: string; username?: string; password?: string; format?: string }
): Promise<SaveResult> {
  try {
    const ext = config.format === 'markdown' ? 'md' : 'html';
    const filename = `${sanitizeFilename(title)}.${ext}`;
    const url = `${config.endpoint.replace(/\/$/, '')}/${filename}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
    };
    if (config.username && config.password) {
      headers['Authorization'] = 'Basic ' + btoa(`${config.username}:${config.password}`);
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: content,
    });

    if (!res.ok) throw new Error(`WebDAV error: ${res.status}`);
    return { success: true, url };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}
