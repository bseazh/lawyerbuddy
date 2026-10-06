---
name: lawyerbuddy-contract-review
description: LawyerBuddy 合同审查入口。用户要求审查合同条款、识别履约风险、评估交易安排或提出修改建议时使用；调用内部争议与履约风险、法律规范效力、监管风险、风险排序和术语能力。
---

# 合同审查

## 授权前置门禁

读取合同或交易材料前，必须先定位并执行共享的 `authorization-gate.md`（GitHub Skills CLI 总路由默认位于 `.agents/skills/lawyerbuddy/runtime/references/`，旧安装器位于 `.agents/lawyerbuddy/references/`，整包位于 `runtime/references/`）。只有本次检查输出 `status: AUTHORIZED` 才能继续；否则立即停止并提示先调用 `@lawyerbuddy-paid`。

## 执行流程

1. 确认合同类型、用户代表一方、交易背景、履行阶段和审查重点。
2. 通读合同及附件，先使用 `dispute-and-performance-risk` 检查主体、标的、价款、履行、违约、解除和争议解决。
3. 涉及法规、资质或监管问题时，调用 `legal-article-retrieval`、`legal-norm-validity-check` 和 `legal-risk-assessment`。
4. 使用 `strategic-risk-prioritization` 区分高、中、低风险，并说明发生条件、影响和修改建议。
5. 使用 `legal-terminology` 检查定义、交叉引用和术语一致性。

输出至少包括总体意见、逐条风险、遗漏条款、建议文本和待补背景。不得将未知交易背景推定为确定事实；未经检索核验的法律依据标记“待检索”。
