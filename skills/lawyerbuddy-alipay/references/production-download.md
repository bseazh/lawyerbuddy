# 正式授权激活

旧的付费 ZIP 下载接口已经禁用。公共 Skill 正常本地安装；服务器只签发和验证授权。

## 接口

```text
POST https://snorlaxden.fun/v1/license/activate
POST https://snorlaxden.fun/v1/license/status
```

未携带 `Payment-Proof` 时，激活接口返回 `HTTP 402` 和 `Payment-Needed`。付款后使用同一请求体和同一订单号重试；服务端验付、签发授权、确认履约，再返回 `license_token` 与 `Payment-Validation`。

相同订单重试返回相同授权令牌。客户端不能通过 `paid=true`、`active=true` 或修改价格绕过验付。

## 配置

```text
ALIPAY_ENV=production
PAYMENT_MODE=alipay_production
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_SERVICE_ID=<正式 serviceId>
LAWYERBUDDY_VERSION=1.9.0
```

未设置 `LICENSE_SIGNING_SECRET_FILE` 时，服务首次启动自动生成 `data/license-signing-secret`。支付宝私钥、授权签名密钥、订单和授权记录不得进入 GitHub 或公共 Skill 包。
