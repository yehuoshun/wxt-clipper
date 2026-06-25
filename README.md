# 🦞 Web Clipper

全平台浏览器剪藏插件 — 完整页面保存 / 正文提取 / 选区剪藏，支持 HTML / Markdown 输出，本地下载 & 云端同步。

## 功能

| 模式 | 说明 | 输出 |
|------|------|------|
| 📄 完整页面 | 保存整个网页，资源内联为 data URI | HTML / Markdown |
| 📰 正文提取 | 基于 Readability 提取文章主体 | 干净 HTML / Markdown |
| ✂️ 选区剪藏 | 保存鼠标选中的区域 | HTML / Markdown |

## 特性

- 🌐 **全平台**：Chrome / Firefox / Edge / Safari（基于 WXT 框架）
- 📥 **本地下载**：一键保存到本地
- ☁️ **云端同步**：WebDAV / 语雀 / GitHub Gist
- ⌨️ **快捷键**：Ctrl+Shift+Y/X/S 快速剪藏
- 🖱️ **右键菜单**：页面任意位置右键剪藏
- 🎨 **暗色模式**：保存的 HTML 自动适配暗色模式
- ⚡ **速率控制**：资源抓取内置并发限制 + 指数退避

## 开发

```bash
npm install
npm run dev          # Chrome 开发模式
npm run dev:firefox  # Firefox 开发模式
npm run build        # 构建
```

## 架构

```
entrypoints/
├── background.ts       # Service Worker — 右键菜单、快捷键、消息路由
├── content.ts          # Content Script — 剪藏命令分发
├── content-hooks.ts    # MAIN world — 拦截 fetch/XHR 捕获动态资源
├── popup/              # 弹出面板 UI
└── options/            # 设置页
lib/
├── capture/
│   ├── fullpage.ts     # 全页保存引擎
│   ├── readability.ts  # 正文提取引擎
│   └── selection.ts    # 选区剪藏引擎
├── format/
│   ├── html.ts         # HTML 序列化
│   └── markdown.ts     # HTML → Markdown
├── resource/
│   └── fetcher.ts      # 资源抓取（并发限制 + 重试）
└── storage/
    └── cloud.ts        # 云端存储后端
```

## 技术栈

- **框架**：WXT (Web Extension Tools) + Vite
- **语言**：TypeScript
- **正文提取**：Mozilla Readability
- **Markdown**：Turndown
- **CSS 处理**：csstree

## License

AGPL-3.0
