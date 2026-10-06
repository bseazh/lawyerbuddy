---
name: lawyerbuddy-document-drafting
description: LawyerBuddy 通用法律文书起草入口。用户要求起草或实质修改答辩状、代理词、律师函、法律意见书或其他非起诉状法律文书时使用；民事起诉状使用 lawyerbuddy-complaint-draft，合同协议使用 lawyerbuddy-contract-draft。
---

# 法律文书起草

## 授权前置门禁

读取案情或开始起草前，必须先定位并执行共享的 `authorization-gate.md`（GitHub Skills CLI 总路由默认位于 `.agents/skills/lawyerbuddy/runtime/references/`，旧安装器位于 `.agents/lawyerbuddy/references/`，整包位于 `runtime/references/`）。只有本次检查输出 `status: AUTHORIZED` 才能继续；否则立即停止并提示先调用 `@lawyerbuddy-paid`。

## 执行流程

1. 本 Skill 不承接民事起诉状或合同协议起草；分别转入 `lawyerbuddy-complaint-draft` 或 `lawyerbuddy-contract-draft`。确认其他文书类型、用户立场、程序阶段、目标读者和交付格式；关键信息缺失时先列出缺失清单。
2. 按 `.agents/lawyerbuddy/routing/pipelines.json` 分阶段读取内部能力，每阶段最多三个。
3. 先提取事实、争议焦点和证据链，再检索并核验法律依据，最后构建论证和格式化正文。
4. `legal-document-formatting` 和 `judgment-document-generation` 主要面向裁判文书；起诉状、答辩状、代理词、律师函和法律意见书不得机械套用判决书结构。
5. 完稿前使用 `legal-terminology` 和 `argument-strength-evaluation` 检查术语、逻辑、依据与不确定性。

不得补造事实、证据、案号或法律依据。未经真实检索核验的法条与案例标记“待检索”；所有成果均为律师审阅稿。
