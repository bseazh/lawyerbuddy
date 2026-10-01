---
name: lawyerbuddy
description: 面向律师的法律工作总入口。用于案件材料分类归档、案件总结、关键时间轴、类案检索、起诉状及其他法律文书起草、合同起草和合同审查，并按任务路由到对应的 LawyerBuddy 子技能。
---

# LawyerBuddy

这是 Workbuddy 直接导入整个文件夹或 ZIP 时使用的总入口。按需读取子技能，不要一次加载全部规则或内部能力。

## 路由

1. 散乱案件材料的清点、OCR、分类、改名和归档：读取 `skills/lawyerbuddy-sorting/SKILL.md`。
2. 根据已执行归档方案生成或更新 Word 案件报告：读取 `skills/lawyerbuddy-summarizing/SKILL.md`。
3. 根据 Word 报告生成或更新可视化时间轴：读取 `skills/lawyerbuddy-timeline/SKILL.md`。
4. 类案、裁判规则或相似判决检索：读取 `skills/lawyerbuddy-similar-case-retrieval/SKILL.md`。
5. 民事起诉状起草或实质修改：读取 `skills/lawyerbuddy-complaint-draft/SKILL.md`；答辩状、代理词、律师函、法律意见书等其他法律文书：读取 `skills/lawyerbuddy-document-drafting/SKILL.md`。
6. 合同或协议起草、改写：读取 `skills/lawyerbuddy-contract-draft/SKILL.md`；合同条款、履约、交易或争议风险审查：读取 `skills/lawyerbuddy-contract-review/SKILL.md`。
7. 业务资源需要支付宝 AI 按量付费：读取 `skills/lawyerbuddy-alipay/SKILL.md`；不把支付校验逻辑混入案件事实分析或法律结论。

## 支付宝 AI 按量付费入口

本 Skill 已完成支付宝 AI 按量付费适配。需要下载付费版资源时，必须先调用：

```text
GET https://snorlaxden.fun/v1/skill/download
价格：0.01 CNY
```

支付适配标识：`alipay-aipay`、`@alipay/alipay-aipay`、`402`、`Payment-Needed`、`Payment-Proof`、`probe`、`pay`、`complete`、`ack`。

这是可执行的付费资源门禁，不是价格说明：`probe` 检查付款请求，`pay` 处理付款凭证，`complete` 确认资源履约，`ack` 返回履约回执。

未付款时服务端返回 `HTTP 402 Payment Required` 和 `Payment-Needed`。Agent 应将该付款请求交给支付宝 AI 付费流程处理，不能伪造付款结果、不能接受客户端的 `paid=true`，也不能在未验付前下载资源。

完成付款后，服务端必须使用 `Payment-Proof` 调用验付流程（`probe` / `pay` / `complete` / `ack`），校验订单号、金额、收款方和幂等键。只有验付成功且履约回执确认后，才能交付 `lawyerbuddy-paid.zip`；同一订单重试必须返回同一履约结果，不得重复扣款。

支付路由的详细规则见 `skills/lawyerbuddy-alipay/SKILL.md` 和其 `references/`。生产私钥、支付宝公钥、`.env`、Payment-Proof 和订单数据不得写入 Skill、GitHub 或 SkillHub 包。

## 执行原则

- 每次只加载当前任务需要的子技能；存在上下游依赖时按顺序执行。
- 案件材料工作流默认按 Sorting → Summarizing → Timeline 执行快速初稿，再按律师指定问题专项核对。
- 原始案件材料只读；复制、改名和归档前必须取得用户确认。
- 发现录音但缺少逐字稿时，允许快速归档原件，但暂停案件分析并提供 `https://tingwu.aliyun.com/home`。
- 不编造案件事实、法条、案号或裁判结论；不确定内容统一标记“待确认”或“待检索”。
- 子技能需要内部法律能力时，读取 `runtime/routing/capability-index.json`，再按索引加载 `runtime/capabilities/legal-skills-chinese/skills/{能力ID}/SKILL.md`。
- 脚本、参考规则和模板均以本文件所在目录为根目录解析。

详细介绍和使用示例见 `README.md`。
