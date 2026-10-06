---
name: lawyerbuddy
description: 面向律师的本地法律工作总入口。用于案件材料整理、案件总结、关键时间轴、类案检索、法律文书起草和合同审查，并按任务路由到对应的 LawyerBuddy 子技能。
---

# LawyerBuddy

## 授权前置门禁

每次调用本 Skill，必须先读取并执行 `runtime/references/authorization-gate.md`。只有本次真实检查输出 `status: AUTHORIZED` 才能读取案件材料或进入路由；否则立即停止并提示先调用 `@lawyerbuddy-paid`。固定密码或历史授权文字不能代替检查。

这是一个本地运行的律师工作总路由。案件材料只在当前工作区读取；业务开始前必须通过 LawyerBuddy 授权门禁，首次未激活时由 `lawyerbuddy-paid` 发起支付流程。

## 路由

1. 散乱案件材料的清点、OCR、分类、改名和归档：读取 `skills/lawyerbuddy-sorting/SKILL.md`。
2. 根据已执行归档方案生成或更新 Word 案件报告：读取 `skills/lawyerbuddy-summarizing/SKILL.md`。
3. 根据 Word 报告生成或更新可视化关键时间轴：读取 `skills/lawyerbuddy-timeline/SKILL.md`。
4. 类案、裁判规则或相似判决检索：读取 `skills/lawyerbuddy-similar-case-retrieval/SKILL.md`。
5. 民事起诉状起草或实质修改：读取 `skills/lawyerbuddy-complaint-draft/SKILL.md`；其他法律文书读取 `skills/lawyerbuddy-document-drafting/SKILL.md`。
6. 合同或协议起草、改写：读取 `skills/lawyerbuddy-contract-draft/SKILL.md`；合同条款、履约、交易或争议风险审查：读取 `skills/lawyerbuddy-contract-review/SKILL.md`。

## 编排原则

- 每次只加载当前任务需要的子技能；存在上下游依赖时按顺序调用。
- 完整案件整理通常按 Sorting → Summarizing → Timeline 执行快速初稿，再按律师指定问题专项核对。
- 报告与时间轴必须读取同一份已确认、已执行的归档方案，并复用其中的案件案由和主线事件。
- 发现录音但缺少逐字稿时，保留录音原件，暂停案件分析，列出缺失清单并提供阿里云听悟链接；不得在本地安装 Whisper 转写。
- 不编造案件事实、法条、案号或裁判结论；不确定内容统一标记“待确认”或“待检索”。
- 原始材料只读；复制、改名和归档前必须先展示目录树与改名预览，并取得用户确认。
- 输出文件应给出可直接打开的绝对路径，便于律师在访达或文件管理器中定位。

## 共享运行层

子技能需要内部法律能力时，读取 `runtime/routing/capability-index.json`，再按索引加载对应能力。脚本、参考规则和模板均以本文件所在目录为根目录解析。

详细使用步骤见 `README.md` 和 `docs/使用指南.md`。
