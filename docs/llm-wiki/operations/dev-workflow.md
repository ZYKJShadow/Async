# 开发与发布流程

- 状态：已根据 `package.json`、`esbuild.main.mjs`、`vite.config.ts`、README 校验。
- 主题：如何运行、构建、测试和发布这个项目。

## 运行脚本总览

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 主进程构建后，启动主进程 watch、Vite 和 Electron |
| `npm run dev:debug` | 同上，但显式打开 Electron DevTools |
| `npm run desktop` | 构建 main + renderer 后启动桌面应用 |
| `npm run build` | 构建主进程和渲染进程 |
| `npm run build:main` | 构建主进程 bundle |
| `npm run build:main:watch` | 监听主进程源码并重建 |
| `npm run build:renderer` | 类型检查后构建 Vite renderer |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | 运行 Vitest |
| `npm run test:watch` | 运行 Vitest watch |
| `npm run icons` | 从 SVG 导出应用图标 |
| `npm run readme:screenshots` | 导出 README 截图 |
| `npm run release:win` | 打包 Windows 安装包（nsis + msi） |
| `npm run release:win:dir` | 打包 Windows dir 产物 |
| `npm run release:mac` | 打包 macOS 安装包（dmg + zip，x64 + arm64） |
| `npm run release:mac:unsigned` | 同上，但不签名 |
| `npm run release:mac:dir` | 打包 macOS dir 产物 |
| `npm run release:mac:arm64` / `release:mac:x64` | 打包指定架构 macOS 产物 |
| `npm run sync:builtin-team` | 同步内置 Team 仓库 |
| `npm run preview` | 构建 renderer 后启动 Vite preview |
| `npm run rebuild:native` | 重建原生依赖（electron-builder） |

## 构建链路

### 主进程

- 源码在 `main-src/`
- 构建脚本是 `esbuild.main.mjs`
- 产物是 `electron/main.bundle.cjs`

### 渲染进程

- 源码在 `src/`
- 使用 Vite 构建
- 构建前会先跑 `tsc --noEmit`
- 产物在 `dist/`

## 开发时的关键事实

- Electron 应用入口来自 `package.json -> main: electron/main.bundle.cjs`
- `npm run dev` 会同时拉起多进程，因此很多“前端改了没生效”的问题可能是 main bundle 没同步刷新
- `desktop` 与 `dev` 的体验不同，前者更像一次完整构建后的运行

## 打包与发布

`electron-builder` 配置位于 `package.json`：

- appId: `com.asyncshell.app`
- productName: `Async IDE`
- Windows target: `nsis` 与 `msi`
- 发布源：GitHub Release

## 不应手改的文件

- `electron/main.bundle.cjs`
- `electron/main.bundle.cjs.map`
- `dist/**`

这些都是产物，应该回到源码层修改。

## 测试现状

仓库中已有较多 Vitest 测试，覆盖面包括：

- Agent 结构化消息和工具协议
- 计划解析
- git 辅助逻辑
- 索引/统计/工作流文本
- 一部分 UI 逻辑工具函数

这说明项目不是“完全无测试”，但测试仍偏模块级，不等同于端到端覆盖。

## Primary Sources

- `package.json`
- `esbuild.main.mjs`
- `vite.config.ts`
- `README.md`
- `README.zh-CN.md`

## 相关页面

- [项目总览](../project-overview.md)
- [仓库地图](../repo-map.md)

## 更新触发条件

- npm scripts 变化。
- 构建或发布链变化。
- 产物目录变化。
