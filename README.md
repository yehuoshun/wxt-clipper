# Web Clipper

A cross-platform browser extension for web clipping — full page save / article extraction / selection clipping, with HTML / Markdown output, local download & cloud sync.

## Features

| Mode | Description | Output |
|------|-------------|--------|
| 📄 Full Page | Save complete web page, resources inlined as data URIs | HTML / Markdown |
| 📰 Article | Extract article content via Readability | Clean HTML / Markdown |
| ✂️ Selection | Clip selected content | HTML / Markdown |

## Highlights

- 🌐 **Cross-platform**: Chrome / Firefox / Edge / Safari (built on WXT)
- 📥 **Local download**: One-click save to disk
- ☁️ **Cloud sync**: WebDAV / Yuque / GitHub Gist
- ⌨️ **Shortcuts**: `Ctrl+Shift+Y` / `X` / `S` for quick clipping
- 🖱️ **Context menu**: Right-click anywhere to clip
- 🎨 **Dark mode**: Saved HTML auto-adapts to dark mode
- ⚡ **Rate limiting**: Built-in concurrency limit + exponential backoff

## Install

Download the zip for your browser from [Releases](https://github.com/yehuoshun/wxt-clipper/releases), unzip, and load the unpacked extension in your browser's extension management page.

## Development

```bash
npm install
npm run dev          # Chrome dev mode
npm run dev:firefox  # Firefox dev mode
npm run build        # Build all
```

## Architecture

```
entrypoints/
├── background.ts       # Service Worker — context menus, shortcuts, message routing
├── content.ts          # Content Script — clip command dispatch
├── content-hooks.ts    # MAIN world — intercept fetch/XHR for dynamic resources
├── popup/              # Popup UI
└── options/            # Settings page
lib/
├── capture/
│   ├── fullpage.ts     # Full page capture engine
│   ├── readability.ts  # Article extraction engine
│   └── selection.ts    # Selection clipping engine
├── format/
│   ├── html.ts         # HTML serialization
│   └── markdown.ts     # HTML → Markdown
├── resource/
│   └── fetcher.ts      # Resource fetching (concurrency + retry)
└── storage/
    └── cloud.ts        # Cloud storage backends
```

## Tech Stack

- **Framework**: WXT (Web Extension Tools) + Vite
- **Language**: TypeScript
- **Extraction**: Mozilla Readability
- **Markdown**: Turndown
- **CSS Processing**: csstree

## License

AGPL-3.0
