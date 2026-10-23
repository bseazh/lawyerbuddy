---
name: lawyerbuddy-paid
description: 面向律师的付费本地法律工作助手。首次使用通过支付宝 AI 按量付费接口完成 0.01 元永久授权激活；激活后本地执行案件材料整理、总结、时间轴、类案检索、文书和合同工作，不重复收费。
metadata:
  version: "1.10.0"
  payment:
    protocol: "HTTP 402"
    price: "0.01 CNY"
    resource: "LawyerBuddy 永久授权"
  openclaw:
    requires:
      bins: ["node", "curl", "alipay-bot"]
    install:
      - kind: node
        package: "@alipay/agent-payment@1.0.28"
        bins: ["alipay-bot"]
        integrity: "sha512-GGDYJS5cGRg0VFIXufLh9L9JomOhhKq3I/5MVXtoOJ5i+8dRK7sd3zNBzQGOhRMMRj6u+b5W4cYSubeFq5mJag=="
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

后端已独立部署。未付款时返回 `HTTP 402` 和 `Payment-Needed`；付款后使用同一请求、同一订单并携带 `Payment-Proof` 重试。服务端调用支付宝验付、签发授权、确认履约并持久化订单；同一订单重试返回同一授权令牌，不重复扣费或交付。若买家侧官方查询凭证丢失或查询通道异常，服务端还可按商户订单号/交易号调用支付宝 `alipay.trade.query` 做商户侧对账，确认已付款后交付同一授权，不需要买家再次付款。

## 授权启动门禁

以下命令中的支付脚本必须相对于本 `SKILL.md` 所在目录解析。GitHub 双入口安装默认是 `.agents/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs`；WorkBuddy 整包是 `skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs`；SkillHub 付费包是根目录 `scripts/lawyerbuddy-paid.mjs`。状态目录放在当前律师项目中，以便升级 Skill 后继续使用授权。

在执行任何 LawyerBuddy 产品能力前，先运行：

```bash
node <支付脚本> probe --state-dir .lawyerbuddy-license
```

脚本只发送随机生成的 `client_id`、Skill 版本和功能列表，不发送案件材料、文件名或法律事实。

网络兼容由脚本自动处理。若本机代理使用 Fake-IP，脚本会在验证受信任 HTTPS 证书后自动切换到同一服务器的公网 IP 入口；不得要求用户修改 Clash、DNS、`hosts` 或关闭安全校验。遇到网络错误只向用户显示简短结果，不扫描代理配置、不反复安装支付工具、不创建新订单。

- 输出 `AUTHORIZED`：永久授权有效且已取得 12 小时会话凭证，可以进入业务路由。
- 输出 `PAYMENT_REQUIRED`：已取得真实 `402` 和 `Payment-Needed`，继续支付流程。
- 授权文件存在但验证失败：停止并向用户说明，不擅自创建新账单。

脚本退出码：`0` 成功或等待付款；`3` 尚未激活；`4` 服务或网络暂不可用；`5` 需要用户先处理买家钱包或付款账号问题。

## 支付流程

### 第 0 步：确认买家钱包

创建账单前后都可以运行以下命令。它只读检查，不发起付款：

```bash
node <支付脚本> wallet --state-dir .lawyerbuddy-license
```

脚本内部调用官方 `alipay-bot check-wallet --json` 并校验真实结果；只有返回 `BUYER_WALLET_READY` 才能继续。必须向用户说明账号角色：

- **卖家/收款方**：LawyerBuddy 服务所属支付宝商家账号，保持不变，不负责扫码付款。
- **买家/付款方**：用户用于支付 0.01 元的支付宝账号，必须与卖家不是同一账号；开通支付功能和最终付款都由买家账号完成。

未开通时，Agent 应直接引导用户在当前对话说“开启支付宝支付功能”，并按支付宝官方页面完成开通。只有用户同意且尚未申请过时，才执行 `wallet --apply true`；该命令会调用官方 `apply-wallet` 并把官方链接或二维码原样交给用户。

- 已经提交过申请但还没绑定：不要重复申请。向用户索取支付宝页面显示的 6 位授权码并完成绑定，然后运行 `wallet` 检查。
- 提交 6 位授权码后：运行 `wallet` 检查结果，不要重复提交授权码。
- 输出 `BUYER_SELLER_SAME` 或官方提示“买家和卖家不能相同”：立即停止付款，要求改用另一买家账号；不得重复使用当前订单。
- 不得扫描支付宝内部文件、修改设备标识、手工删除钱包凭证，或让普通用户反复切换 DNS、代理和系统配置。官方钱包管理页无法解绑时，保留订单信息并按支付宝官方反馈流程处理。

不得只凭用户口述、页面已打开或二维码已扫描推断钱包可用；必须以 `wallet` 或官方 `check-wallet` 的真实结果为准。

### `probe`：取得 402 账单

`probe` 保存原始 POST 请求、订单号、`pay_before` 和 `Payment-Needed`，权限为 `0600`。不得解码、改写或伪造账单。25 分钟内已经存在未完成订单、且账单仍在有效期内时自动沿用该订单。只有官方查询明确返回订单不存在、订单关闭或账单已过期，并取得用户明确同意后，才执行 `probe --new-order true` 创建新订单。

如果 `pay` 明确返回“买家和卖家不能相同”，脚本会把原订单标记为不可复用；换好买家账号后直接重新运行 `probe` 即可，不要继续使用旧账单。

### `pay`：交给官方买家支付能力

优先从当前 Agent 运行时取得稳定 `sessionId` 并通过 `--session-id` 传入；取不到时脚本会读取常见运行时环境变量，仍没有则在状态目录生成并持久化一个稳定 ID。不得让用户手工填写，也不得每次付款重新生成。

```bash
node <支付脚本> pay \
  --state-dir .lawyerbuddy-license \
  --session-id '<当前运行时 sessionId，可省略>' \
  --intent-summary '原始请求：激活 LawyerBuddy 本地法律工作套件'
```

脚本调用官方 `alipay-bot 402-buyer-pay`，把保存的账单与原始请求交给支付宝。原样向用户展示官方输出和支付入口，然后停止，等待用户明确表示已付款或继续。

若官方 CLI 返回 `PROXY_TARGET_BLOCKED`，脚本只会对固定的 LawyerBuddy 公网 IP HTTPS 入口自动重试一次；仍失败则停止并提示稍后重试。该兼容入口使用公开 CA 签发的 IP 证书，不能替换为任意地址，也不能关闭 TLS 或 SSRF 校验。

`pay` 遇到明确失败时会额外输出 `PAYMENT_ACTION_REQUIRED` 或 `PAYMENT_NOT_COMPLETED` JSON，并写入 `.lawyerbuddy-license/payment-error.json`。必须按其中的 `code`、`message` 和 `next` 处理；不得只重复执行 `pay`。

### `complete`：携带凭证重试并取得授权

用户表示已付款、完成或继续后，只查询原订单。支付链接过期也先查询原订单，不直接重新 `probe`：

```bash
node <支付脚本> complete --state-dir .lawyerbuddy-license
```

脚本会从本次 `pay` 输出中自动取支付宝查询单号；官方输出只有交易号时自动改用 `--trade-no`。需要手工指定时只能传 `--out-shake-no '<支付宝查询单号>'` 或 `--trade-no '<支付宝交易号>'`。

- `LBORDER_` 开头的是 LawyerBuddy 商户订单号，**不能**作为 `--out-shake-no` 或 `--trade-no`，脚本会直接拒绝。
- 官方返回 `SYSTEM_ERROR：查询支付凭证失败` 时，不要用 `LBORDER_` 商户订单号反复查询，也不要据此判定支付失败；直接运行下面的 `recover`，让服务端按交易号做商户侧对账。
- 返回 `PAYMENT_QUERY_CREDENTIAL_UNAVAILABLE` 时，说明当前环境没有买家侧查询凭证；不要换环境重复付款，直接运行 `recover`。

官方买家 CLI 会继续原始 POST 请求并携带 `Payment-Proof`。服务端完成验付和履约确认后返回永久授权；脚本保存 `license_token` 并签发 12 小时会话凭证，以后不再付款。授权成功后原账单会归档为 `payment-needed.completed.txt`，订单标记为已完成；`pay` 发现已有有效授权或已完成订单时会直接拒绝再次付款。

### `recover`：已扣款但无法验付时的服务端对账

当支付宝账单已经扣款，但买家侧 `complete` 返回 `SYSTEM_ERROR：查询支付凭证失败`、`PAYMENT_QUERY_CREDENTIAL_UNAVAILABLE`，或官方查询拿不到授权时，使用原订单和交易号做商户侧对账：

```bash
node <支付脚本> recover --state-dir .lawyerbuddy-license --trade-no '<pay 输出中的交易号>'
```

`--trade-no` 可省略，脚本会从本次 `pay` 输出自动读取。也可以直接重新运行 `complete`，脚本在遇到上述查询失败时会自动调用同一对账接口。

服务端会：

1. 校验原订单号、`client_id`、Skill 版本和功能列表与创建订单时一致；
2. 优先用商户侧 `alipay.trade.query` 按 `out_trade_no` 查询支付宝交易；如果当前应用没有该接口权限（支付宝返回 `40006 Insufficient Permissions`），改用 AI 付的 `alipay.aipay.agent.fulfillment.confirm` 校验交易号：未付款或不存在的交易返回 `TRADE_NOT_FOUND`，已付款交易返回成功或“已履约”状态；
3. 能取得交易详情时校验交易状态为 `TRADE_SUCCESS` / `TRADE_FINISHED`、金额、收款商家和交易号；
4. 签发与正常验付完全相同的永久授权，并持久化订单，重复对账返回同一 `license_token`。

`recover` 不会再次扣款。常见结果：

- `AUTHORIZED`：对账成功，授权已保存，可以继续业务。
- `TRADE_NOT_PAID`：支付宝侧尚未确认付款。先核对账单；若已扣款，等待 1—2 分钟后再次 `recover`，不要重新付款。
- `TRADE_NOT_FOUND` / `TRADE_QUERY_FAILED`：支付宝查询暂不可用或交易尚未同步；保留订单号和交易号，稍后重试。
- `ORDER_NOT_FOUND` / `ORDER_REQUEST_MISMATCH`：状态目录、客户端或订单号不匹配；不要重新下单或付款，先核对原状态目录。
- `RECONCILE_DISABLED` / `RECONCILE_NOT_AVAILABLE`：服务端还没有部署对账接口；保留订单号和交易号，更新服务端后再试，不要重新付款。

### 常见支付问题与处理

| 现象或错误码 | 含义 | 正确处理 |
| --- | --- | --- |
| `买家和卖家不能相同` / `BUYER_SELLER_SAME` | 付款账号就是 LawyerBuddy 收款商家账号 | 停止付款；换另一买家账号并开启支付功能；原订单已标记不可复用，重新 `probe` 即可 |
| `未开通` / `BUYER_WALLET_REQUIRED` | 当前账号没有开启 AI 支付钱包 | 在当前对话说“开启支付宝支付功能”，按官方页面开通；已申请过就不要重复申请 |
| `BUYER_WALLET_BIND_REQUIRED` | 已申请但未绑定 6 位授权码 | 取得授权码完成绑定，再运行 `wallet`；不要重复提交授权码或重新申请 |
| `WALLET_ALREADY_BOUND` | 钱包已经绑定 | 运行 `wallet` 检查后继续；不要重复绑定 |
| `PAYMENT_QUERY_CREDENTIAL_UNAVAILABLE` | 当前环境没有买家侧查询凭证 | 不要重新付款；运行 `recover --trade-no '<交易号>'` 做服务端商户对账 |
| `SYSTEM_ERROR` / `查询支付凭证失败` | 买家侧查询参数或查询通道异常 | 不要用 `LBORDER_` 订单号反复查询，也不要判定支付失败；运行 `recover` 按交易号对账 |
| `TRADE_ALREADY_PAID` / `PAYMENT_PROCESSING` | 原订单已付款或处理中 | 不要再次付款；执行 `complete` 或 `recover` 查询并领取授权 |
| `TRADE_STATUS_NOT_ALLOW_GENERATE_PROOF` / `TRADE_NOT_FOUND` / `REQUEST_EXPIRED` | 账单不能继续或已失效 | 先 `complete` 查询原订单；仅确认不存在、关闭或过期且用户同意后，才 `probe --new-order true` |
| `PAYMENT_QUERY_ORDER_MISMATCH` / `RESOURCE_ORDER_MISMATCH_AFTER_PAYMENT` | 付款后订单或交易号不一致 | 不要再次付款；用原订单查询并在同一请求重试，保留交易号走官方反馈 |
| `RESOURCE_OUTCOME_UNKNOWN` / `PAYMENT_COMPLETED_RESOURCE_NOT_DELIVERED` | 可能已付款但授权未交付 | 不要再次付款；执行 `complete` 重试同一请求，仍失败则保留订单号联系支持 |
| `AMOUNT_MISMATCH` / `SERVICE_PRICE_MISMATCH` / `SERVICE_SELLER_ID_MISMATCH` | 服务端金额、服务或收款商家配置不一致 | 停止付款并检查服务端配置；不要修改客户端金额或重复下单 |
| `USER_LIMITED` / `USER_NOT_ALLOW` / `PERM_LIMIT_FAILED` | 支付宝侧限制当前账号或服务 | 换买家账号或按支付宝提示处理；保留订单号和错误码走官方反馈 |
| `PAY_TIMEOUT` / `PROXY_PAYMENT_RESULT_UNKNOWN` | 支付结果暂时未知 | 不要直接再次付款；先 `complete` 查询原订单 |
| `PROXY_TARGET_BLOCKED` | 本机代理拦截支付入口 | 脚本会自动切换兼容入口一次；仍失败则稍后重试，不关闭 TLS 或 SSRF 校验 |

状态不明时一律先查询原订单，不得重新 `probe`、重复付款或接受客户端自报 `paid=true`。

### `gate`：每次业务调用前在线验权

总路由和每个产品 Skill 在读取材料前必须运行：

```bash
node <支付脚本> gate --state-dir .lawyerbuddy-license
```

只有输出 `status: AUTHORIZED` 才能继续。会话凭证有效 12 小时，但每次调用仍向服务器确认；到期后使用永久授权自动续签，不创建新账单。固定密码、历史输出或用户口述不能代替真实检查。

### `ack`：仅恢复失败回执

成功路径不额外发送回执。只有同一次 `complete` 已取得授权、官方输出明确表示买家回执失败，并且用户后续要求恢复时，才执行一次：

```bash
node <支付脚本> ack --trade-no '<同次输出中的交易号>'
```

状态不明时查询原订单；不得重新 `probe`、重复付款或接受客户端自报 `paid=true`。只有查询明确返回 `BIZ_ORDER_NOT_FOUND`、订单已关闭或账单已过期，且用户明确同意重新下单时，才重新执行 `probe` 和 `pay`。

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

### 已扣款但无法验付时的商户对账

买家侧查询凭证丢失时，客户端调用 `POST /v1/license/reconcile`。服务端校验原订单和请求摘要后，优先以商户身份调用 `alipay.trade.query`；如果应用没有该接口权限，则调用 AI 付 `alipay.aipay.agent.fulfillment.confirm` 校验交易号，未付款/不存在的交易返回 `TRADE_NOT_FOUND`，已付款交易返回成功或“已履约”。确认后签发同一永久授权。该路径只做已付款订单的恢复，不接受客户端自报 `paid=true`，也不会重复扣款。

### 履约确认

服务端签发授权后调用 `alipay.aipay.agent.fulfillment.confirm`；买家成功路径由官方 CLI 处理回执，失败时用 `ack` 恢复。

### 订单持久化与幂等

服务端持久化 `out_trade_no`、请求摘要和授权记录；同一订单重试返回同一 `license_token`，不重复扣费或交付。

支付脚本不得接触支付宝私钥。生产密钥、订单数据库和授权签名密钥只存在于服务端。
