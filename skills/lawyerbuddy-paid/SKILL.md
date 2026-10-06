---
name: lawyerbuddy-paid
description: 面向律师的付费本地法律工作助手。首次使用通过支付宝 AI 按量付费接口完成 0.01 元永久授权激活；激活后本地执行案件材料整理、总结、时间轴、类案检索、文书和合同工作，不重复收费。
metadata:
  version: "1.9.3"
  payment:
    protocol: "HTTP 402"
    price: "0.01 CNY"
    resource: "LawyerBuddy 永久授权"
  openclaw:
    requires:
      bins: ["node", "curl", "alipay-bot"]
    install:
      - kind: node
        package: "@alipay/agent-payment@1.0.23"
        bins: ["alipay-bot"]
        integrity: "sha512-7OGSHhPnuKsyENpivpY60NgE77ktKtWTP8UBtmizeB1Et44KHFFIjDcSRIFpitEdKAC7uMBx3Mp1Zg/wbYmYCQ=="
---

# LawyerBuddy Pay Skill

本 Skill 可直接从 GitHub 安装，也可作为 SkillHub 付费包使用。GitHub 安装只负责把本地付费入口放入 Agent 的 Skills 目录；首次运行仍必须走下方支付宝授权流程。

```bash
npx --yes skills add https://github.com/bseazh/lawyerbuddy --skill lawyerbuddy-paid --full-depth --copy --yes
```

如果 Agent 只安装了本目录，还需要同时安装 `lawyerbuddy` 本地总路由或其他产品 Skill；本目录不上传案件材料，也不下载法律代码。

本包是 SkillHub 付费版本。收费业务 API 是 LawyerBuddy 永久授权激活，不是代码下载：

```text
POST https://snorlaxden.fun/v1/license/activate
单次价格：0.01 CNY
交付结果：永久 license_token，expires_at=null
```

后端已独立部署。未付款时返回 `HTTP 402` 和 `Payment-Needed`；付款后使用同一请求、同一订单并携带 `Payment-Proof` 重试。服务端调用支付宝验付、签发授权、确认履约并持久化订单；同一订单重试返回同一授权令牌，不重复扣费或交付。

## 授权启动门禁

以下命令中的支付脚本必须相对于本 `SKILL.md` 所在目录解析；GitHub Skills CLI 默认路径为 `.agents/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs`。状态目录放在当前律师项目中，以便升级 Skill 后继续使用授权。

在执行任何 LawyerBuddy 产品能力前，先运行：

```bash
node .agents/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs probe --state-dir .lawyerbuddy-license
```

脚本只发送随机生成的 `client_id`、Skill 版本和功能列表，不发送案件材料、文件名或法律事实。

- 输出 `AUTHORIZED`：永久授权有效且已取得 12 小时会话凭证，可以进入业务路由。
- 输出 `PAYMENT_REQUIRED`：已取得真实 `402` 和 `Payment-Needed`，继续支付流程。
- 授权文件存在但验证失败：停止并向用户说明，不擅自创建新账单。

## 支付流程

### `probe`：取得 402 账单

`probe` 保存原始 POST 请求、订单号和 `Payment-Needed`，权限为 `0600`。不得解码、改写或伪造账单。

### `pay`：交给官方买家支付能力

从当前 Agent 运行时取得稳定 `sessionId`，不得自行生成或让用户填写。然后执行：

```bash
node .agents/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs pay \
  --state-dir .lawyerbuddy-license \
  --session-id '<当前运行时 sessionId>' \
  --intent-summary '原始请求：激活 LawyerBuddy 本地法律工作套件'
```

脚本调用官方 `alipay-bot 402-buyer-pay`，把保存的账单与原始请求交给支付宝。原样向用户展示官方输出和支付入口，然后停止，等待用户明确表示已付款或继续。

### `complete`：携带凭证重试并取得授权

用户表示已付款、完成或继续后，只查询原订单：

```bash
node .agents/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs complete \
  --state-dir .lawyerbuddy-license \
  --out-shake-no '<pay 输出中的订单号或查询单号>'
```

官方买家 CLI 会继续原始 POST 请求并携带 `Payment-Proof`。服务端完成验付和履约确认后返回永久授权；脚本保存 `license_token` 并签发 12 小时会话凭证，以后不再付款。

### `gate`：每次业务调用前在线验权

总路由和每个产品 Skill 在读取材料前必须运行：

```bash
node .agents/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs gate --state-dir .lawyerbuddy-license
```

只有输出 `status: AUTHORIZED` 才能继续。会话凭证有效 12 小时，但每次调用仍向服务器确认；到期后使用永久授权自动续签，不创建新账单。固定密码、历史输出或用户口述不能代替真实检查。

### `ack`：仅恢复失败回执

成功路径不额外发送回执。只有同一次 `complete` 已取得授权、官方输出明确表示买家回执失败，并且用户后续要求恢复时，才执行一次：

```bash
node .agents/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs ack --trade-no '<同次输出中的交易号>'
```

状态不明时查询原订单；不得重新 `probe`、重复付款或接受客户端自报 `paid=true`。

## 业务路由

授权有效后按需读取子技能：

1. 材料分类、OCR、改名和归档：`skills/lawyerbuddy-sorting/SKILL.md`。
2. Word 案件梳理报告：`skills/lawyerbuddy-summarizing/SKILL.md`。
3. 可视化关键时间轴：`skills/lawyerbuddy-timeline/SKILL.md`。
4. 类案检索：`skills/lawyerbuddy-similar-case-retrieval/SKILL.md`。
5. 民事起诉状：`skills/lawyerbuddy-complaint-draft/SKILL.md`；其他文书：`skills/lawyerbuddy-document-drafting/SKILL.md`。
6. 合同起草：`skills/lawyerbuddy-contract-draft/SKILL.md`；合同审查：`skills/lawyerbuddy-contract-review/SKILL.md`。

原始案件材料只在本地读取。复制、改名和归档前必须展示预览并取得确认；不编造案件事实、法条、案号或裁判结论。

## 支付实现证据

### 402账单下发

`probe` 请求授权 API，要求返回 `HTTP 402` 并校验、保存 `Payment-Needed`。

### 携带凭证重试

官方 `alipay-bot` 保留原 POST body、订单头和资源 URL，付款后携带 `Payment-Proof` 重试同一请求。

### 验付调用

服务端调用 `alipay.aipay.agent.payment.verify`，无效或过期凭证不能取得授权。

### 履约确认

服务端签发授权后调用 `alipay.aipay.agent.fulfillment.confirm`；买家成功路径由官方 CLI 处理回执，失败时用 `ack` 恢复。

### 订单持久化与幂等

服务端持久化 `out_trade_no`、请求摘要和授权记录；同一订单重试返回同一 `license_token`，不重复扣费或交付。

支付脚本不得接触支付宝私钥。生产密钥、订单数据库和授权签名密钥只存在于服务端。
