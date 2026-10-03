# LawyerBuddy 授权激活服务

这是与公共本地 Skill 分离部署的 Node.js/Express 服务。它保留支付宝 AI 付费链路，但付款成功后只签发授权令牌，不下载或返回 LawyerBuddy 代码。

## 接口

### `POST /v1/license/activate`

请求体：

```json
{
  "client_id": "设备或用户标识",
  "skill_version": "1.9.0",
  "features": ["sorting", "summarizing", "timeline"]
}
```

首次请求没有 `Payment-Proof`，返回 `HTTP 402`、`Payment-Needed` 和 `out_trade_no`。付款后使用相同请求体和订单号重试，并携带官方产生的 `Payment-Proof`。验付和履约成功后返回 `license_id`、签名 `license_token`、版本、功能、激活时间和 `Payment-Validation`。

### `POST /v1/license/status`

通过请求体 `license_token` 或 `Authorization: Bearer <token>` 验证授权。只有签名有效且授权记录仍存在时返回 `active: true`。

### `GET /v1/skill/download`

固定返回 `410 DOWNLOAD_DISABLED`。服务端不再交付 ZIP 或任何代码。

## 配置

复制 `.env.example` 为 `.env`，填写支付宝环境变量和：

```text
LICENSE_SIGNING_SECRET_FILE=/etc/lawyerbuddy/secrets/license-signing-secret
LAWYERBUDDY_VERSION=1.9.0
```

签名密钥可在服务器上生成：

```bash
umask 077
openssl rand -hex 32 > /etc/lawyerbuddy/secrets/license-signing-secret
```

该密钥不得放入 GitHub、Skill ZIP、日志或客户端，也不能复用支付宝应用私钥。

## 本地检查

```bash
npm ci
npm run preflight
npm start
```

未付款预检：

```bash
curl -i -X POST http://127.0.0.1:3000/v1/license/activate \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"local-test","skill_version":"1.9.0","features":["sorting"]}'
```

预期返回 `HTTP 402` 和 `Payment-Needed`。旧下载接口应返回 `410`。真实付款、验付和履约只能通过支付宝官方买家流程完成；未实际付款时不能称为正式支付测试通过。

订单存放于 `data/orders.json`，授权存放于 `data/licenses.json`，文件权限为 `0600`。同一 `out_trade_no` 绑定同一激活请求并返回同一授权结果。

## 生产部署

确保服务器环境文件已配置 `LICENSE_SIGNING_SECRET_FILE` 后运行：

```bash
export LB_DEPLOY_HOST=ubuntu@snorlaxden.fun
export LB_SERVER_DIR=/home/ubuntu/Project/lawyerbuddy-api
export LB_RELEASE_VERSION=1.9.0
export LB_SSH_KEY=/绝对路径/lawyerbuddy_paid_deploy_ed25519
./services/lawyerbuddy-paid-api/deploy-production.sh
```

脚本只同步 API 源码，不上传 ZIP。它会重启服务并检查健康接口、旧下载接口 `410` 和激活接口未付款 `402`；失败时恢复旧服务文件。
