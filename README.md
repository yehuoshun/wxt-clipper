> **⚠️ ARCHIVED — This project is no longer maintained.**
> The code quality is terrible. Do not use it. I'm keeping it here as a reminder of what not to do.<p align="center">
  <img src="public/icon_128.png" alt="WXT Clipper" width="128" height="128">
</p>

<h1 align="center">WXT Clipper</h1>

<p align="center">
  <a href="README_CN.md">中文文档</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <strong>A cross-platform browser extension for web clipping</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/yehuoshun/wxt-clipper?style=flat-square" alt="Release">
  <img src="https://img.shields.io/github/license/yehuoshun/wxt-clipper?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/platform-Chrome%20%7C%20Firefox%20%7C%20Edge%20%7C%20Safari-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square" alt="TypeScript">
</p>

---

## 📖 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Usage](#-usage)
- [Configuration](#-configuration)
- [Development](#-development)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

### Clipping Modes

| Mode | Description | Output |
|------|-------------|--------|
| 📄 Full Page | Save complete web page with all resources inlined as data URIs | HTML / Markdown |
| 📰 Article | Extract clean article content via Mozilla Readability | Clean HTML / Markdown |
| ✂️ Selection | Clip selected text/content on the page | HTML / Markdown |
| 🎯 Element Picker | Click any element on the page to clip it precisely | HTML / Markdown |

### Highlights

- 🌐 **Cross-platform** — Chrome, Firefox, Edge, Safari (built on WXT)
- 📥 **Local download** — One-click save to disk
- ☁️ **Cloud sync** — WebDAV, Yuque (语雀), GitHub Gist
- ⌨️ **Keyboard shortcuts** — `Ctrl+Shift+Y` / `X` / `S` for quick clipping
- 🖱️ **Context menu** — Right-click anywhere on a page to clip
- 🎨 **Dark mode** — Saved HTML auto-adapts to system color scheme
- 🧹 **Watermark removal** — Detects and strips 6 types of hidden tracking watermarks
- ⚡ **Rate limiting** — Built-in concurrency control with exponential backoff
- 📊 **Progress indicator** — 8-step visual progress during capture

### Resource Handling

- CSS stylesheet inlining
- CSS `background-image` inlining (inline styles + `<style>` blocks)
- Font capture (`@font-face` → base64)
- Canvas → `<img>` conversion
- Shadow DOM recursive traversal
- iframe recursive processing
- Lazy-load trigger (`loading="lazy"` + `data-src`)

## 📥 Installation

### From Releases

1. Go to [Releases](https://github.com/yehuoshun/wxt-clipper/releases)
2. Download the zip for your browser (`wxt-clipper-chrome.zip`, `wxt-clipper-firefox.zip`, or `wxt-clipper-edge.zip`)
3. Unzip the file
4. Open your browser's extension management page:
   - Chrome/Edge: `chrome://extensions` → Enable **Developer mode** → **Load unpacked**
   - Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
5. Select the unzipped folder

### From Source

```bash
git clone https://github.com/yehuoshun/wxt-clipper.git
cd wxt-clipper
npm install
npm run build
# Load the .output/chrome-mv3 folder in your browser
```

## 🚀 Usage

### Via Popup

1. Click the WXT Clipper icon in the toolbar
2. Select a clipping mode (Full Page / Article / Selection / Element Picker)
3. Choose output format (HTML / Markdown)
4. Click **剪藏** (Clip)

### Via Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+Y` | Save full page |
| `Ctrl+Shift+X` | Extract article |
| `Ctrl+Shift+S` | Clip selection |

### Via Context Menu

Right-click on any page → choose the clipping mode.

### Element Picker

Select **🎯 Element Picker** mode → click any element on the page to clip it.

## ⚙️ Configuration

Open the extension options page to configure:

### Clipping Options

- Default clipping mode and output format
- Toggle: inline images, remove scripts, strip watermarks, compress CSS

### Auto-Save

- Enable automatic clipping on page load
- Domain whitelist support

### Cloud Sync

| Backend | Setup |
|---------|-------|
| **WebDAV** | Enter endpoint URL + credentials |
| **Yuque (语雀)** | Click **🔑 One-Click Auth** → paste token → select knowledge base |
| **GitHub Gist** | Enter personal access token |

## 💻 Development

```bash
# Install dependencies
npm install

# Dev mode (hot reload)
npm run dev           # Chrome
npm run dev:firefox   # Firefox

# Build
npm run build         # All platforms

# Lint
npm run lint
```

## 🏗️ Architecture

```
entrypoints/
├── background.ts         # Service Worker — context menus, shortcuts, message routing
├── content.ts            # Content Script — clip command dispatch
├── content-hooks.ts      # MAIN world — intercept fetch/XHR for dynamic resources
├── popup/                # Popup UI (mode selection, format, progress)
└── options/              # Settings page (cloud sync, auto-save, preferences)

lib/
├── capture/
│   ├── fullpage.ts       # Full page capture engine
│   ├── readability.ts    # Article extraction engine (Mozilla Readability)
│   ├── selection.ts      # Selection clipping engine
│   └── watermark.ts      # Hidden watermark detection & removal
├── format/
│   ├── html.ts           # HTML serialization with dark mode
│   └── markdown.ts       # HTML → Markdown (Turndown + lightweight fallback)
├── resource/
│   └── fetcher.ts        # Resource fetching with concurrency control + retry
└── storage/
    ├── cloud.ts          # WebDAV / GitHub Gist backends
    └── yuque.ts          # Yuque API client (OAuth-style auth + full API)
```

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | [WXT](https://wxt.dev) + Vite |
| Language | TypeScript 5.7 |
| Article Extraction | [Mozilla Readability](https://github.com/mozilla/readability) |
| Markdown Conversion | [Turndown](https://github.com/mixmark-io/turndown) |
| CSS Processing | [csstree](https://github.com/csstree/csstree) |
| Image Processing | [sharp](https://sharp.pixelplumbing.com) (icon generation) |

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

[AGPL-3.0](LICENSE) © 2025 yehuoshun