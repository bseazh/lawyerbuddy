---
name: lawyerbuddy-timeline
description: LawyerBuddy 关键时间轴入口。用户已有经过确认并执行的案件归档方案，需要单独生成或更新专业 HTML 案件关键时间轴，并按需导出 PNG 或 PDF 时使用。
---

# 关键时间轴可视化

## 授权前置门禁

读取案件报告或时间轴数据前，必须先定位并执行共享的 `authorization-gate.md`（GitHub Skills CLI 总路由默认位于 `.agents/skills/lawyerbuddy/runtime/references/`，旧安装器位于 `.agents/lawyerbuddy/references/`，整包位于 `runtime/references/`）。只有本次检查输出 `status: AUTHORIZED` 才能继续；否则立即停止并提示先调用 `@lawyerbuddy-paid`。

本 Skill 复用 `lawyerbuddy-sorting` 已验证的事件模型、时间轴规则和生成脚本。

## 执行要求

1. 定位 `整理结果/技术资料/归档方案_已执行.json`；必须确认 `workflow_handoff.report_path` 指向可读取的案件梳理报告。
2. 确认方案已经执行，录音逐字稿检查已经通过。
3. 读取相邻 `lawyerbuddy-sorting/references/event-model.md`、`timeline.md` 和 `qa.md`。
4. 确认主线事件非空，并校验当前事件快照与生成 Word 报告时记录的快照一致；不一致时先重新生成报告。
5. 使用相邻 `lawyerbuddy-sorting/scripts/build_timeline.py` 生成 HTML。时间轴不得重新从文件名或材料摘要另行推导事件。
6. 时间轴必须与 Word 报告使用同一组事件和同一主要案由；`draft` 模式明确标注为初步时间轴，不能暗示已经全量复核。
7. 仅在用户明确要求时导出 PNG 或 PDF；导出失败不影响 HTML 成果。
8. 完成后更新 `workflow_handoff`，记录时间轴绝对路径并清空下一步推荐；向用户同时显示报告和时间轴的可访问路径。

默认输出：`整理结果/{确认案由}案件关键时间轴.html`。
