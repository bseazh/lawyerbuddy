---
name: lawyerbuddy
description: LawyerBuddy 总路由。用户提出案件材料分类、案件总结、关键时间轴、类案检索、起诉状或其他法律文书起草、合同起草或合同审查时，先判断任务类型，再转交对应的 LawyerBuddy 产品 Skill；复杂任务按依赖顺序串联，避免同时加载无关能力。
---

# LawyerBuddy 总路由

## 授权前置门禁

每次调用本 Skill，必须先定位并执行共享的 `authorization-gate.md`（GitHub Skills CLI 总路由默认位于 `.agents/skills/lawyerbuddy/runtime/references/`，旧安装器位于 `.agents/lawyerbuddy/references/`，整包位于 `runtime/references/`）。仅当输出 `status: AUTHORIZED` 时继续路由；否则立即停止，不读取案件材料，并提示用户先调用 `@lawyerbuddy-paid`；平台未单独注册该名称时读取同包 `skills/lawyerbuddy-paid/SKILL.md`。

本 Skill 只负责识别任务、检查前置成果和选择产品 Skill，不重复执行具体法律工作。

## 路由规则

1. 材料清点、OCR、分类、改名、归档或完整案件整理：读取 `lawyerbuddy-sorting`。
2. 已有归档方案，需要生成或更新案件梳理 Word 报告：读取 `lawyerbuddy-summarizing`。
3. 已有归档方案，需要生成或更新可视化关键时间轴：读取 `lawyerbuddy-timeline`。
4. 类案、裁判规则或相似判决检索：读取 `lawyerbuddy-similar-case-retrieval`。
5. 民事起诉状起草或实质修改：读取 `lawyerbuddy-complaint-draft`；其他法律文书起草读取 `lawyerbuddy-document-drafting`。
6. 合同或协议起草、改写：读取 `lawyerbuddy-contract-draft`；合同条款、履约、交易或争议风险审查读取 `lawyerbuddy-contract-review`。

## 编排原则

- 每次只确定一个主 Skill；确有上下游依赖时再顺序调用其他 Skill。
- 完整案件整理默认由 `lawyerbuddy-sorting` 先生成快速初稿；后续根据律师选择进入专项核对或全量复核。
- 报告与时间轴必须读取同一份已确认、已执行的 `归档方案_已执行.json`。
- 用户选择快速初稿并确认归档预览后，按 `lawyerbuddy-summarizing` → `lawyerbuddy-timeline` 的顺序连续完成，不重复询问；只选快速归档时才在归档后推荐后续初稿。初稿完成后提供金额与付款、主体与合同关系、指定材料三类专项核对入口。
- 新会话从 `workflow_handoff.recommended_next_skill` 继续：Sorting 完成推荐 Summarizing，报告完成推荐 Timeline，时间轴完成后清空推荐。不得依赖上一会话记忆猜测进度。
- 对产品流程之外的法律任务，读取 `.agents/lawyerbuddy/routing/capability-index.json`，选择一个最匹配的内部能力；仅在存在明确依赖时增加辅助能力。
- 内部能力正文位于 `.agents/lawyerbuddy/capabilities/legal-skills-chinese/skills/{能力ID}/SKILL.md`。按阶段读取，不得一次加载全部 38 个能力。
- 调用旧编号或中文能力名称时，先用 `.agents/lawyerbuddy/routing/aliases.json` 解析为能力 ID。
- 不编造案件事实、法条、案号、裁判要旨或效力状态；不确定内容标记“待确认”或“待检索”。

安装后的模块状态见 `.agents/lawyerbuddy/skills.json`，标准调用链见 `.agents/lawyerbuddy/routing/pipelines.json`。
