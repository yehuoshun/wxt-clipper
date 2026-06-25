<p align="center">
  <img src="public/icon_128.png" alt="Web Clipper" width="128" height="128">
</p>

<h1 align="center">Web Clipper</h1>

<p align="center">
  <strong>全平台浏览器剪藏插件</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/yehuoshun/wxt-clipper?style=flat-square" alt="Release">
  <img src="https://img.shields.io/github/license/yehuoshun/wxt-clipper?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/platform-Chrome%20%7C%20Firefox%20%7C%20Edge%20%7C%20Safari-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square" alt="TypeScript">
</p>

---

## 📖 目录

- [功能](#-功能)
- [安装](#-安装)
- [使用](#-使用)
- [配置](#-配置)
- [开发](#-开发)
- [架构](#-架构)
- [技术栈](#-技术栈)
- [贡献](#-贡献)
- [许可证](#-许可证)

## ✨ 功能

### 剪藏模式

| 模式 | 说明 | 输出 |
|------|------|------|
| 📄 完整页面 | 保存整个网页，所有资源内联为 data URI | HTML / Markdown |
| 📰 正文提取 | 基于 Mozilla Readability 提取文章主体 | 干净 HTML / Markdown |
| ✂️ 选区剪藏 | 保存鼠标选中的内容 | HTML / Markdown |
| 🎯 元素选择 | 点击页面任意元素精确剪藏 | HTML / Markdown |

### 亮点

- 🌐 **全平台** — Chrome / Firefox / Edge / Safari（基于 WXT 框架）
- 📥 **本地下载** — 一键保存到本地
- ☁️ **云端同步** — WebDAV / 语雀 / GitHub Gist
- ⌨️ **快捷键** — `Ctrl+Shift+Y` / `X` / `S` 快速剪藏
- 🖱️ **右键菜单** — 页面任意位置右键剪藏
- 🎨 **暗色模式** — 保存的 HTML 自动适配系统颜色方案
- 🧹 **水印清洗** — 检测并移除 6 种隐藏追踪水印
- ⚡ **速率控制** — 内置并发限制 + 指数退避
- 📊 **进度提示** — 8 步可视化进度

### 资源处理

- CSS 样式表内联
- CSS `background-image` 内联（行内样式 + `<style>` 块）
- 字体捕获（`@font-face` → base64）
- Canvas → `<img>` 转换
- Shadow DOM 递归遍历
- iframe 递归处理
- 懒加载触发（`loading="lazy"` + `data-src`）

## 📥 安装

### 从 Release 安装

1. 前往 [Releases](https://github.com/yehuoshun/wxt-clipper/releases)
2. 下载对应浏览器的 zip 文件（`wxt-clipper-chrome.zip` / `wxt-clipper-firefox.zip` / `wxt-clipper-edge.zip`）
3. 解压 zip 文件
4. 打开浏览器扩展管理页面：
   - Chrome/Edge：`chrome://extensions` → 开启**开发者模式** → **加载已解压的扩展程序**
   - Firefox：`about:debugging#/runtime/this-firefox` → **临时载入附加组件**
5. 选择解压后的文件夹

### 从源码构建

```bash
git clone https://github.com/yehuoshun/wxt-clipper.git
cd wxt-clipper
npm install
npm run build
# 在浏览器中加载 .output/chrome-mv3 文件夹
```

## 🚀 使用

### 弹出面板

1. 点击工具栏中的 Web Clipper 图标
2. 选择剪藏模式（完整页面 / 正文提取 / 选区剪藏 / 元素选择）
3. 选择输出格式（HTML / Markdown）
4. 点击**剪藏**

### 快捷键

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+Shift+Y` | 保存完整页面 |
| `Ctrl+Shift+X` | 提取正文 |
| `Ctrl+Shift+S` | 剪藏选中区域 |

### 右键菜单

在页面上右键 → 选择剪藏模式。

### 元素选择器

选择 **🎯 元素选择** 模式 → 点击页面上任意元素即可剪藏。

## ⚙️ 配置

打开扩展设置页面进行配置：

### 剪藏选项

- 默认剪藏模式和输出格式
- 开关：内联图片、移除脚本、清洗水印、压缩 CSS

### 自动保存

- 开启页面加载后自动剪藏
- 支持域名白名单

### 云端同步

| 后端 | 配置方式 |
|------|---------|
| **WebDAV** | 输入地址 + 用户名密码 |
| **语雀** | 点击 **🔑 一键授权** → 粘贴 Token → 选择知识库 |
| **GitHub Gist** | 输入 Personal Access Token |

## 💻 开发

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev           # Chrome
npm run dev:firefox   # Firefox

# 构建
npm run build         # 全平台

# 类型检查
npm run lint
```

## 🏗️ 架构

```
entrypoints/
├── background.ts         # Service Worker — 右键菜单、快捷键、消息路由
├── content.ts            # Content Script — 剪藏命令分发
├── content-hooks.ts      # MAIN world — 拦截 fetch/XHR 捕获动态资源
├── popup/                # 弹出面板（模式选择、格式、进度）
└── options/              # 设置页（云端同步、自动保存、偏好）

lib/
├── capture/
│   ├── fullpage.ts       # 全页保存引擎
│   ├── readability.ts    # 正文提取引擎（Mozilla Readability）
│   ├── selection.ts      # 选区剪藏引擎
│   └── watermark.ts      # 隐藏水印检测与清洗
├── format/
│   ├── html.ts           # HTML 序列化（含暗色模式）
│   └── markdown.ts       # HTML → Markdown（Turndown + 轻量回退）
├── resource/
│   └── fetcher.ts        # 资源抓取（并发控制 + 重试）
└── storage/
    ├── cloud.ts          # WebDAV / GitHub Gist 后端
    └── yuque.ts          # 语雀 API Client（一键授权 + 完整 API）
```

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | [WXT](https://wxt.dev) + Vite |
| 语言 | TypeScript 5.7 |
| 正文提取 | [Mozilla Readability](https://github.com/mozilla/readability) |
| Markdown 转换 | [Turndown](https://github.com/mixmark-io/turndown) |
| CSS 处理 | [csstree](https://github.com/csstree/csstree) |
| 图像处理 | [sharp](https://sharp.pixelplumbing.com)（图标生成） |

## 🤝 贡献

欢迎提交 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: 添加新功能'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 📄 许可证

[AGPL-3.0](LICENSE) © 2025 yehuoshun
