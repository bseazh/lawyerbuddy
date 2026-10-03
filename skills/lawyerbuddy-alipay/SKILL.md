---
name: lawyerbuddy-alipay
description: 为独立的 LawyerBuddy 授权服务接入支付宝 AI 按量付费。用于授权激活的 402 账单、Payment-Proof 验付、授权令牌签发、履约回执与订单幂等；不用于下载或更新 Skill 代码。
---

# LawyerBuddy 授权服务

本 Skill 只供服务端开发和运维使用，不随免费本地版 SkillHub 或 WorkBuddy 包分发。案件材料整理、报告、时间轴和文书功能仍在用户本地运行。

## 业务接口

```text
POST /v1/license/activate
POST /v1/license/status
GET  /v1/skill/download  → 410 DOWNLOAD_DISABLED
```

激活请求包含 `client_id`、`skill_version` 和所需 `features`。未付款时返回 `HTTP 402` 与 `Payment-Needed`；付款后由服务端验证 `Payment-Proof`、确认履约并返回签名授权令牌。接口只返回授权状态，不返回 ZIP、Skill 文件或其他代码。

## 强制流程

1. 服务端固定价格，客户端不能覆盖。
2. 首次激活创建持久化订单，并将请求摘要与订单绑定。
3. 携带 `Payment-Proof` 重试时必须复用原订单和原请求。
4. 服务端调用支付宝验付，核对订单、金额和授权资源。
5. 验付成功后生成授权记录，再调用履约确认。
6. 同一订单重试返回同一授权令牌，不重复扣费或重复签发。
7. `POST /v1/license/status` 校验签名及持久化授权记录，不接受客户端自报 `active=true`。

## 安全边界

- 支付宝私钥、公钥、`.env`、订单、授权记录和授权签名密钥只保留在服务器。
- `LICENSE_SIGNING_SECRET_FILE` 必须指向至少 32 个字符的独立服务器密钥，不得复用支付宝私钥。
- 公共 Skill 包不应出现本服务域名、付款指令或远程下载逻辑。
- 授权只控制许可状态，不能阻止用户复制已经下载到本地的代码。

详细接口、配置、测试与发布步骤见本目录 `references/` 以及 `services/lawyerbuddy-paid-api/README.md`。
