---
name: lawyerbuddy-alipay
description: 为 LawyerBuddy 业务资源接入支付宝 AI 按量付费。支持沙箱联调和正式付费下载；用于 402 账单、Payment-Proof、资源交付、履约回执与订单幂等。
---

# LawyerBuddy 支付适配

这是一个独立的支付适配入口，不改变案件整理、案件总结、时间轴和文书 Skill 的业务逻辑。需要执行支付宝官方接入步骤时，可另行安装并读取 `@alipay/alipay-aipay` 提供的官方 Skill。

## 默认资源下载接口

没有明确业务接口时，使用已部署的付费资源下载接口：

```text
GET https://snorlaxden.fun/v1/skill/download
单次价格：0.01 元
成功响应：lawyerbuddy-paid.zip 文件下载
```

也可以将同一支付适配器绑定到其他业务接口。真实接入前必须确认收费资源、接口路径、请求体、成功响应和失败响应。

## 流程

1. 读取 `references/payment-flow.md` 和 `references/sandbox-testing.md`。
2. 检查项目 `.env` 或部署环境中的沙箱/生产配置；缺少配置时列出缺项，不猜测 App ID、密钥或回调地址。
3. 未提供有效 Payment-Proof 时返回 `402 Payment Required`，不得提前执行收费业务。
4. 服务端校验凭证、订单号、金额、业务参数和幂等键；客户端不能覆盖服务端价格。
5. 验证通过后交付资源并写入履约回执；生成失败不能标记为已履约。
6. 同一订单重试返回同一结果，不重复扣费或重复生成资源。
7. 本地和沙箱测试禁止真实付款。生产私钥只能由环境变量或密钥服务提供；不得提交 GitHub 或打包进 Skill。

## 配置

复制 `references/environment.example.md` 的变量到项目 `.env`。`.env` 不得提交 GitHub：

```text
ALIPAY_ENV=production
PAYMENT_MODE=alipay_production
ALIPAY_APP_ID=
ALIPAY_APP_PRIVATE_KEY_FILE=/secure/path/app_private_key.pem
ALIPAY_PUBLIC_KEY_FILE=/secure/path/alipay_public_key.pem
ALIPAY_SELLER_ID=
ALIPAY_SERVICE_ID=
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_UNIT_PRICE_CNY=0.01
RESOURCE_FILE=/secure/path/lawyerbuddy-paid.zip
```

没有真实业务接口和生产配置时，只能完成流程设计或沙箱验收，不能声称已完成真实扣款。当前正式下载接口由服务端保护，付款成功后返回 ZIP；Skill 本身不保存生产私钥。
