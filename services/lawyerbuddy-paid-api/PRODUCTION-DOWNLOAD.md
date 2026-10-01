# 正式付费下载

## 服务端接口

```text
GET https://snorlaxden.fun/v1/skill/download
```

未携带有效 `Payment-Proof` 时，服务端返回 `HTTP 402` 和 `Payment-Needed`。

付款完成后，使用同一个请求重试。服务端会依次完成：

1. 验证 `Payment-Proof`；
2. 校验订单、金额、资源路径和商家身份；
3. 调用履约确认；
4. 返回 `lawyerbuddy-paid.zip` 下载文件；
5. 返回 `Payment-Validation`，并对同一订单保持幂等。

## 生产配置

生产环境必须使用正式 `serviceId` 和正式支付宝网关：

```text
ALIPAY_ENV=production
PAYMENT_MODE=alipay_production
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_SERVICE_ID=<正式 serviceId>
RESOURCE_FILE=<服务器上的 ZIP 绝对路径>
```

生产应用私钥只放在服务器密钥目录或密钥管理服务，不进入仓库、Skill ZIP、日志或客户端。

## 验收边界

- `HTTP 402` 和 `Payment-Needed` 可公开预检；
- 真实付款、验付和履约需要支付宝账户侧实际操作；
- 未实际付款时，不得把 402 预检称为正式支付成功；
- ZIP 内容更新后，必须重新生成并替换服务端 `RESOURCE_FILE`。
