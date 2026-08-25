# 海上风电维检 Agent 统一技术规格

> 本文是项目唯一的 Superpowers Spec，描述当前已落地的产品、架构与约束。

## 目标与范围

系统基于题目提供的只读 SQLite 和 Markdown 资料，为海上风电维检问题提供可追溯的中文回答。用户可查询风机状态、告警、工单、故障处理要求与安全规程；系统必须明确区分资料支持的事实、服务端规则结论和需要现场核实的事项。

通识定义、闲聊或与随题资料无关的问题属于题外问题：系统以正常的“问题范围提示”结束本轮，不回答模型通识，不检索 SQLite/RAG，也不生成 Evidence 或 VerifiedClaim。题目范围内但检索无记录的请求仍应进入受控检索链路，并按资料不足或现场核实语义回答。

系统定位为本地机试演示，不包含鉴权、持久化会话、生产监控、部署体系或题目资料写入能力。

## 核心架构

采用“规则主导、模型表达”的受控链路：

1. 规划器将问题解析为受 `QueryPlan` 约束的查询意图、风机、故障码和数据源；纯规程问题使用 `policy_lookup`，不要求风机编号；题外问题使用无检索条件的 `unsupported` 安全包络。
2. 服务端仅以只读、参数化查询访问 SQLite，并从故障处理手册与安全规程检索必要章节。
3. Runner 为数据库记录、文档条款和派生规则生成带 `E#` ID 的 Evidence；单轮 Evidence 最多 16 条，受控查询最多 8 次。
4. 服务端从 Evidence 生成 `VerifiedClaim`，用于重复故障、工单优先级、远程复位、关闭合规与更换条件等关键结论。
5. 回答模型仅接收当前问题、VerifiedClaim 和受控 Evidence，负责组织中文说明；不得虚构现场事实、责任归因或作业指令。
6. UI Message Stream 在正文前传输 Evidence，以便正文中的引用可即时校验和跳转；前端在用户阅读层面控制各区块的展示时机。

## 可靠性与安全约束

- SQLite 与题目 Markdown 只读；`docs/require/` 是唯一题目数据来源，不复制为测试夹具。
- 数据库状态不等同于实时现场状态；`COMPLETED` 不等于工单关闭合规；告警解除不等于根因消除；备件可用不等于可立即更换。
- 正常请求最多调用规划模型与回答模型各一次；规划 JSON 校验失败时可受控修复一次。
- `unsupported` 仅允许空实体、空筛选和空数据源的固定安全包络；服务端收到它后只返回范围提示，不访问题目数据或调用回答模型。
- 查询范围、请求体大小与 Evidence 数量在服务端预检；没有足够资料时必须输出“现有资料无法确认，需要现场核实”。
- Evidence ID 必须与本轮 Evidence 对应；未知引用在 UI 中显式标记，来源锚点按消息 ID 隔离。

## 回答与交互规范

- 回答采用 Markdown，可按需使用“分析结果”“处理建议”“需要现场核实”三个章节。
- 每个关键事实、数量、时间、状态、规程要求或有限判断紧邻其 Evidence 引用；核验结论与正文均可跳转到来源。
- 最新回答生成中，仅展示执行进度和正文；完成后按“核验结论 → 正文 → 依据来源 → 推荐问题”展示。历史回答始终展示完整信息。
- 题外问题展示“问题范围提示”和 3 条题目内推荐问题；不展示执行完成面板、核验结论、依据来源或 Evidence 引用。
- 执行进度使用可折叠面板：展开时图标尖角向下，折叠时尖角向右。
- 前端使用 shadcn/ui 的 `Button`、`Textarea`、`Card`、`Collapsible`、`ScrollArea` 基础组件，保留项目现有浅色布局和中文文案。

## 测试与工程约定

所有测试源码置于顶层 `tests/`：

- `unit/`：无题目数据和 HTTP 路由依赖的逻辑测试。
- `integration/`：SQLite、RAG、Next 路由和多模块协作测试。
- `component/`：JSDOM React 组件测试。
- `acceptance/`：与机试题要求直接对应的验收测试。
- `e2e/`：仅由 Playwright 执行的浏览器测试。

Vitest 发现 `tests/**/*.test.{ts,tsx}`，Playwright 发现 `tests/e2e/**/*.spec.ts`。测试对业务模块统一使用 `@/` 别名。根目录的 `vitest.config.mts` 和 `playwright.config.ts` 是工具入口，保留在项目根目录。

## 技术栈

Next.js 16、React 19、TypeScript、AI SDK 7、Zod、better-sqlite3、LangChain、Vitest、Testing Library、Playwright、Tailwind CSS v4 与 shadcn/ui。
