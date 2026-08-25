# 测试目录约定

所有测试源码统一放在 `tests/`；`app/`、`components/` 和 `lib/` 只保留运行时代码。

- `unit/`：不依赖题目 SQLite、Markdown、网络或 HTTP 路由的逻辑测试。
- `integration/`：验证 SQLite、RAG、Next 路由或多个模块协作的测试。
- `component/`：在 JSDOM 中运行的 React 组件测试。
- `acceptance/`：与机试题验收要求直接对应的场景测试。
- `e2e/`：仅由 Playwright 执行的浏览器测试。
- Vitest 文件使用 `.test.ts` 或 `.test.tsx`；Playwright 文件使用 `.spec.ts`。

## 常用命令

```bash
pnpm test
pnpm test:acceptance
pnpm test:e2e
```

若本地已有同一项目的 Next 开发服务，可在 PowerShell 中复用它：

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"
pnpm test:e2e
```
