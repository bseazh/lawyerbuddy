---
name: lawyerbuddy-summarizing
description: LawyerBuddy 案件总结入口。用户已有经过确认并执行的案件归档方案，需要单独生成或更新包含案件主体、案件总结、关键时间轴表格和文件清单的 Word 案件梳理报告时使用。
---

# 案件总结

## 授权前置门禁

读取任何案件材料或旧报告前，必须先定位并执行共享的 `authorization-gate.md`（GitHub Skills CLI 总路由默认位于 `.agents/skills/lawyerbuddy/runtime/references/`，旧安装器位于 `.agents/lawyerbuddy/references/`，整包位于 `runtime/references/`）。只有本次检查输出 `status: AUTHORIZED` 才能继续；否则立即停止并提示先调用 `@lawyerbuddy-paid`。

本 Skill 复用 `lawyerbuddy-sorting` 的报告规则和脚本。不得无条件信任既有摘要或执行 JSON；生成或更新报告前按本次处理深度核验材料范围、事实来源和事件关联。快速初稿不要求无关材料逐页读完，也不得擅自改写材料事实。

## 执行要求

1. 定位用户指定案件下的 `整理结果/技术资料/归档方案_已执行.json`。
2. 确认方案中 `confirmed` 为 `true`；存在录音时还须确认逐字稿检查与反向核查已经完成。
3. 读取相邻 `lawyerbuddy-sorting/references/completeness.md`、`extraction.md`、`event-model.md`、`report.md`、`output-schema.md`、`lawyer-writing.md` 和 `qa.md`。
4. 用户未指定深度时将 `processing_mode` 设为 `draft`，快速核对决定主体、案情概况、主要争议和主线事件的关键材料；普通材料先登记和机器检索，未核对部分进入待确认事项。用户指定问题时使用 `focused-review`，明确要求逐页全查时才使用 `full-review`。
5. 复核 `fact_inventory` 和 `fact_disposition`；每份材料必须进入已核对、机器提取、延后核对或无法读取范围之一，不能从分析范围消失。初稿中的每项事实必须引用已核对材料并提供原文定位；`legal_fact_map` 可在专项核对或全量复核阶段完善。
6. 先运行 `scripts/check_report_readiness.py`。初稿的案件主体、案件概况、主要争议、主线事件任一为空时，不得生成占位报告；只补充当前缺项及其来源，仍不足则向用户列出具体待确认项。
7. 只有 `full-review` 可运行一次 `scripts/prepare_rescan.py` 全量补充扫描，并要求全部阅读单元覆盖率达到 100%。
8. 文件名和文档标题必须使用归档方案中已确认的主要案由。
9. 不重新分类、移动或覆盖原始材料；输入不足时列出待确认项。
10. 报告完成后更新 `workflow_handoff`，记录报告绝对路径和事件快照，并推荐下一步使用 `lawyerbuddy-timeline` 根据同一组事件生成可视化时间轴。未经用户确认不自动执行下一 Skill。

默认输出：`整理结果/{确认案由}案件梳理报告.docx`。`draft` 报告正文必须标明“初步案件梳理报告”和适用范围。

完成后询问：

> Word 案件梳理报告已经生成。建议继续生成可视化关键时间轴：
>
> A. 继续使用 `lawyerbuddy-timeline` 生成时间轴（推荐）；
> B. 补充核对金额与付款情况；
> C. 补充核对主体与合同关系；
> D. 补充核对指定材料。
