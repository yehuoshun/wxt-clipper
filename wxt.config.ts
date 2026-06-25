import { defineConfig } from 'wxt';
import { resolve } from 'path';

export default defineConfig({
  vite: () => ({
    resolve: {
      alias: {
        '@': resolve(__dirname, 'lib'),
      },
    },
  }),
  manifest: {
    name: 'Web Clipper',
    description: '全平台剪藏插件 — 全页保存 / 正文提取 / 选区剪藏',
    permissions: [
      'activeTab',
      'storage',
      'downloads',
      'scripting',
      'contextMenus',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Web Clipper',
      default_popup: 'popup/index.html',
      default_icon: {
        '16': 'icon_16.png',
        '32': 'icon_32.png',
        '48': 'icon_48.png',
        '64': 'icon_64.png',
        '128': 'icon_128.png',
      },
    },
    icons: {
      '16': 'icon_16.png',
      '32': 'icon_32.png',
      '48': 'icon_48.png',
      '64': 'icon_64.png',
      '128': 'icon_128.png',
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        run_at: 'document_start',
        js: ['content-hooks.js'],
        all_frames: true,
        match_about_blank: true,
        world: 'MAIN',
      },
    ],
    commands: {
      'clip-fullpage': {
        suggested_key: { default: 'Ctrl+Shift+Y' },
        description: '保存完整页面',
      },
      'clip-article': {
        suggested_key: { default: 'Ctrl+Shift+X' },
        description: '提取正文',
      },
      'clip-selection': {
        suggested_key: { default: 'Ctrl+Shift+S' },
        description: '剪藏选中区域',
      },
    },
  },
  webExt: {
    disabled: true,
  },
});
