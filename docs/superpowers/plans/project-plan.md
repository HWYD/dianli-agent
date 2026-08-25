# 海上风电维检 Agent 统一实施计划

> 本文是项目唯一的 Superpowers Plan，记录已完成工作、当前质量门槛与待决事项。

## 已完成工作

- [x] 接入 shadcn/ui 最小组件集：`Button`、`Textarea`、`Card`、`Collapsible`、`ScrollArea`；未改变 Agent、RAG、SSE 或 Evidence 协议。
- [x] 实现受控查询契约、必需规程/手册召回、派生规则与 `VerifiedClaim`，覆盖重复故障、优先级、远程复位、工单关闭和更换条件的确定性结论。
- [x] 约束模型只基于本轮 Evidence 作答，并实现引用校验、来源锚点、请求/查询/Evidence 预算与资料不足表达。
- [x] 调整流式阅读顺序：生成时显示进度和正文；完成后显示核验结论、依据来源和推荐问题，同时保留正文引用跳转。
- [x] 统一测试目录到 `tests/`，更新 Vitest、Playwright、验收脚本和测试导入约定。
- [x] 调整执行进度折叠图标：展开向下、折叠向右。
- [x] 将题外问题处理为无检索的范围提示：以 `unsupported` 安全包络阻止 SQLite、RAG 和回答模型调用，并在 UI 中展示范围说明和 3 条题目内推荐问题。

## 当前质量门槛

每次业务或交互变更应按风险运行相关验证：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:acceptance
pnpm test:e2e
```

若已有同一项目的 Next 开发服务，使用 `PLAYWRIGHT_BASE_URL` 复用该服务运行浏览器测试；详细约定见 `tests/README.md`。

新增或移动测试时：Vitest 使用 `.test.ts`/`.test.tsx`，Playwright 使用 `.spec.ts`；测试源码只能放在 `tests/`，业务模块导入统一使用 `@/`。

## 待决事项

- [ ] 对齐“清空会话”功能与组件测试：当前 UI 中该入口被注释，组件测试仍断言其存在。需由产品决定恢复入口，或删除/改写对应测试；在决定前不应擅自改变功能。
- [ ] 对 Evidence 正文引用的密度与视觉形态进行产品评估后，再决定是否将 `[E#]` 聚合为更紧凑的引文标记；该调整不得降低每个关键结论的可追溯性或破坏来源锚点。

## 变更流程

1. 先更新本 Spec 中受影响的产品或架构约束；没有约束变化时无需改动。
2. 为行为变更补充或修订相关测试；仅视觉微调由用户明确免测时，可不新增测试。
3. 保持 SQLite、Markdown、Evidence 与外部模型调用的安全边界不变。
4. 运行与改动匹配的验证，并在交付中报告未执行或失败的检查及原因。
