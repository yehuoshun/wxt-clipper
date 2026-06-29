/**
 * HTML → Markdown conversion using Turndown.
 * Falls back to a lightweight converter if Turndown isn't available.
 */

// We'll use Turndown when bundled, but also provide a lightweight fallback
export function toMarkdown(html: string): string {
  // Try Turndown first (will be available after npm install)
  try {
    // Dynamic import won't work in content scripts, so we bundle Turndown
    // @ts-ignore — Turndown is bundled
    if (typeof TurndownService !== 'undefined') {
      // @ts-ignore
      const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
      });
      return td.turndown(html);
    }
  } catch { /* fall through */ }

  // Lightweight fallback
  return lightweightMarkdown(html);
}

function lightweightMarkdown(html: string): string {
  let md = html;

  // Remove script/style tags
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, (_, t) => `# ${stripTags(t)}\n\n`);
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, t) => `## ${stripTags(t)}\n\n`);
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, (_, t) => `### ${stripTags(t)}\n\n`);
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, (_, t) => `#### ${stripTags(t)}\n\n`);
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, (_, t) => `##### ${stripTags(t)}\n\n`);
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, (_, t) => `###### ${stripTags(t)}\n\n`);

  // Bold / Italic
  md = md.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '*$2*');

  // Code
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, t) => `\`\`\`\n${decodeEntities(t)}\n\`\`\`\n\n`);

  // Links
  md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Images
  md = md.replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![]($1)');

  // Lists
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) =>
    t.split('\n').map((l: string) => `> ${l}`).join('\n') + '\n\n'
  );

  // Horizontal rules
  md = md.replace(/<hr[^>]*\/?>/gi, '---\n\n');

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode entities
  md = decodeEntities(md);

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
    '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
    '&lsquo;': '\u2018', '&rsquo;': '\u2019',
    '&ldquo;': '\u201C', '&rdquo;': '\u201D',
  };
  return text.replace(/&[#\w]+;/g, m => entities[m] || m);
}
