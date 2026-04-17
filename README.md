# Trade View - Chrome 浏览器插件

## 项目简介

Trade View 是一个基于 Chrome Extension Manifest V3 的浏览器插件项目。

## 项目结构

```
trade-view/
├── manifest.json          # 插件配置文件 (Manifest V3)
├── background/
│   └── background.js      # Service Worker 后台脚本
├── content/
│   ├── content.js         # 内容脚本 (注入页面)
│   └── content.css        # 内容脚本样式
├── popup/
│   ├── popup.html         # 弹窗页面
│   ├── popup.css          # 弹窗样式
│   └── popup.js           # 弹窗脚本
├── options/
│   ├── options.html       # 设置页面
│   ├── options.css        # 设置页样式
│   └── options.js         # 设置页脚本
├── icons/                 # 图标资源
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── _locales/
│   └── zh_CN/
│       └── messages.json  # 中文国际化
└── README.md
```

## 开发指南

### 安装到 Chrome

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录

### 图标

请将 16x16、32x32、48x48、128x128 像素的 PNG 图标放入 `icons/` 目录。

### 权限说明

- `storage` - 存储插件设置
- `activeTab` - 访问当前活动标签页
- `scripting` - 动态注入脚本
- `<all_urls>` - 在所有网页上运行

## 技术栈

- Chrome Extension Manifest V3
- Vanilla JavaScript (ES6+)
- Chrome Storage API
