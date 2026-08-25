# 海上风电维检 Agent

用于机试现场演示的本地 Next.js 全栈系统。它只读查询题目提供的 SQLite 数据库，并按章节/条款检索两份业务 Markdown；模型不会接收完整数据库或完整文档。

## 本地启动

1. 安装 Node.js 22+ 与 pnpm。
2. 复制 `.env.example` 为 `.env.local`，仅在该本地文件中填写 `ARK_API_KEY`。不要把 Key 写入代码、README 或提交记录。
3. 安装依赖并建立本地文档向量索引：

```powershell
pnpm install
pnpm ingest:docs
pnpm verify:setup
pnpm dev
```

在浏览器打开 `http://localhost:3000`。`pnpm ingest:docs` 只索引 `故障处理手册.md` 和 `海上风电机组检修作业与安全管理规程.md`，生成的 `data/rag-index.json` 不包含 API Key。

## 本地验证

```powershell
pnpm test
pnpm typecheck
pnpm build
```

`pnpm verify:setup` 会实际检查固定的方舟 Chat/Embedding 模型、一次流式调用、SQLite 只读打开以及 RAG 索引校验和。若尚未配置 `.env.local` 或未运行文档索引，它会明确失败，不会使用模型回退或自动重试。

## 设计要点

- Chat 与 Embedding 固定共用方舟 Base URL，模型固定为 `deepseek-v4-pro` 和 `doubao-embedding-vision`。
- 单轮最多两次语言模型调用：一次 QueryPlan、一次最终 Markdown 流式回答；无自动修复或重试。
- SQLite 仅有白名单参数化查询，使用只读连接与 `query_only`，没有通用 SQL 工具或写入接口。
- RAG 使用“Exact 元数据路由 + Keyword/Semantic 双路 RRF”；向量不可用时保留 Exact/Keyword 降级并展示步骤状态。
- 最终模型只接收本轮受控 Evidence。真实来源由服务端 `data-evidence` part 发送，前端不会展示模型思维链。
- UI 仅面向本地桌面演示：开始生成时显示“思考中”，首段正文到达后自动折叠为“已完成思考”。

## 现场演示建议

可依次演示：

- T06 最新状态；
- T04 闭区间告警；
- 24002 故障处理与更换安全注意事项；
- 规程第 4.1 条的远程复位边界；
- T03/24002 的连续 24 小时重复故障、工单升级与远程复位判断；
- T09/24011 的工单关闭合规性；
- T07/24012 的告警次数、工单缺失与三项检查建议。

## 当前边界

这是本地面试演示版，不包含账号、会话持久化、工单写回、部署、自动重试、断线恢复、移动端专项适配或生产级监控。现场安全条件、责任归因等题目资料未记录的事项，系统应回答“现有资料无法确认，需要现场核实”。
