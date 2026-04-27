## 项目概述

Chrome 扩展（Manifest V3），在每个标签页中独立控制 HTML5 视频播放速度，互不影响。

## 开发命令

```bash
# 没有构建系统；直接将项目文件夹加载到 Chrome 扩展管理中即可
# chrome://extensions → 开启开发者模式 → 加载已解压的扩展
```

## 项目架构

```
manifest.json              # MV3 配置：content_scripts（所有URL，含iframe）、storage+activeTab 权限
background/
  service-worker.js        # 长期运行的后台脚本：开放 session storage 给 content script，提供 tabId 查询
content/
  content.js               # 注入到每个页面的 content script：核心逻辑所在
popup/
  popup.html               # 弹出窗口 UI
  popup.js                 # 弹出窗口逻辑：与 content script 通过 chrome.tabs.sendMessage 通信
  popup.css                # 弹出窗口样式（含暗色模式）
icons/                     # 扩展图标 16/32/48/128
```

## 项目规范
- **修正CLAUDE.md**: 完成一次对项目的关键改动后，要将这次改动的概述更新到CLAUDE.md中

## 关键设计决策

- **每标签独立速度**：使用 `chrome.storage.session`，键值为 `speed_{tabId}`。session storage 是内存级存储，关闭浏览器后速度不保留
- **直接读写 session storage**：content script 可直接读写 `chrome.storage.session`（需 background 调用 `setAccessLevel`），无需每次都唤醒 service worker
- **无构建工具**：纯原生 JavaScript 扩展，无 npm/webpack 等依赖
- **键盘快捷键硬编码**：A=减速0.25，D=加速0.25，S=切换 1x/2x，内容输入框中不生效
- **动态视频侦测**：通过 MutationObserver 监听新添加的 video 元素（SPA 换页、播放列表等场景）
- **弹出窗口实时同步**：popup 通过 `chrome.storage.onChanged` 监听键盘触发的速度变更，保持 UI 同步
- **全屏 OSD 显示机制**：全屏 API 只渲染 `document.fullscreenElement` 及其后代。OSD 全屏时追加到 `fullscreenElement`（`position: absolute`），非全屏时追加到 `document.body`（`position: fixed`）。对于裸 `<video>` 全屏（如原生视频控件），通过 monkey-patch `HTMLVideoElement.prototype.requestFullscreen` 自动将 video 包裹在 `<div>` 容器中，使全屏元素始终是可容纳 OSD 的容器
- **按键冲突阻止**：使用捕获阶段监听（`addEventListener('keydown', handler, true)`）拦截快捷键，在事件传播到页面脚本之前调用 `event.stopPropagation()` + `event.preventDefault()`。防止网站自身的同名快捷键（如 Bilibili 的 D 键弹幕开关）与扩展快捷键冲突。输入框/无视频场景下不拦截，保留网站原生行为
