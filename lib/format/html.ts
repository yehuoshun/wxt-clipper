/**
 * HTML serialization — produce clean, self-contained HTML output.
 */

export function serializeHTML(bodyHtml: string, title?: string): string {
  const t = title || 'Clipped Page';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t)}</title>
<style>
  body {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem 1rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.8;
    color: #333;
    background: #fff;
  }
  img { max-width: 100%; height: auto; }
  pre { overflow-x: auto; background: #f5f5f5; padding: 1rem; border-radius: 4px; }
  code { font-family: "SF Mono", Monaco, "Cascadia Code", monospace; font-size: 0.9em; }
  blockquote { border-left: 3px solid #ddd; margin: 0; padding: 0 1rem; color: #666; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
  hr { border: none; border-top: 1px solid #eee; margin: 2rem 0; }
  a { color: #0366d6; }
  @media (prefers-color-scheme: dark) {
    body { color: #ddd; background: #1a1a1a; }
    pre { background: #2a2a2a; }
    blockquote { border-color: #444; color: #999; }
    th, td { border-color: #444; }
    hr { border-color: #333; }
    a { color: #58a6ff; }
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, c => map[c]);
}
