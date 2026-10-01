# LawyerBuddy 支付宝 AI 按量付费下载接口

这是一个独立的 Node.js/Express 支付服务模板，支持沙箱联调和正式付费下载。目标接口为：

```text
GET /v1/skill/download
```

它实现支付宝 AI 按量付费的 402、`Payment-Needed`、`Payment-Proof`、`alipay.aipay.agent.payment.verify`、履约确认和 ZIP 资源下载流程。单价默认为 `0.01` 元。

## 安全配置

复制 `.env.example` 为 `.env`，只填写本机密钥文件路径。不要把 `.env`、私钥、公钥或 `.alipay-sandbox.json` 上传到 Workbuddy 或提交 GitHub。

应用私钥和支付宝公钥可继续放在支付宝开放平台密钥工具生成的目录中；服务端只在运行时读取，不会把密钥内容写入源码。

`ALIPAY_SELLER_ID` 必须填写与当前 AppID 绑定的支付宝沙箱商家 PID（通常为 `2088` 开头），不能用 AppID 代替。可登录[支付宝开放平台](https://open.alipay.com/)，进入当前沙箱应用的“应用信息/商家信息”，复制商户 PID 或商家 UID，写入 `.env`。

沙箱可使用 `ALIPAY_CONFIG_SOURCE=sandbox_file`，生产必须使用正式 AppID、商家 PID、`serviceId`、支付宝公钥和服务器私钥。生产模式通过 `RESOURCE_FILE` 指定付款成功后下载的 ZIP 文件。生产私钥和 `.env` 不能上传到仓库。

## 本地运行

```bash
npm install
cp .env.example .env
npm run preflight
npm start
```

如果只需要复现官方临时沙箱的已通过测试：

```bash
ALIPAY_CONFIG_SOURCE=sandbox_file npm start
```

服务启动后，先访问 `http://127.0.0.1:3000/demo/a2m/resource`，应返回 HTTP 402 和 `Payment-Needed`。

## 官方沙箱联调

先启动服务，再由已安装的支付宝官方 Skill 执行受控联调：

```bash
node "/Users/Apple/.codex/skills/alipay-aipay/references/normal/scripts/runtime.mjs" a2m precheck --url "http://127.0.0.1:3000/demo/a2m/resource" --method GET --agent-platform "Codex" --session-id "<当前会话ID>"
node "/Users/Apple/.codex/skills/alipay-aipay/references/normal/scripts/runtime.mjs" a2m run --url "http://127.0.0.1:3000/demo/a2m/resource" --method GET --buyer-id "<沙箱买家userId>" --auto-complete --require-payment-validation --agent-platform "Codex" --session-id "<当前会话ID>"
```

不要手写 Payment-Proof，也不要把支付凭证、私钥或临时支付链接写入报告。只有官方脚本取得 HTTP 200、非空资源、有效 `Payment-Validation` 和履约确认，才能称为真实沙箱联调通过。
