# 生产授权服务

旧的付费 ZIP 下载模式已经停用。公共 LawyerBuddy Skill 通过 SkillHub、WorkBuddy 或 GitHub 正常安装；独立服务器只处理授权激活。

```text
POST https://snorlaxden.fun/v1/license/activate
POST https://snorlaxden.fun/v1/license/status
GET  https://snorlaxden.fun/v1/skill/download → 410
```

激活接口保留完整的支付宝 `402 → Payment-Proof → 验付 → 履约确认 → 授权令牌` 流程。相同订单与请求重试必须返回相同授权，不重复扣费或重复签发。

生产配置除支付宝参数外，应设置当前版本：

```text
LAWYERBUDDY_VERSION=1.9.0
```

未显式配置 `LICENSE_SIGNING_SECRET_FILE` 时，服务会在首次启动时生成 `data/license-signing-secret`。生产密钥、订单和授权记录只能保留在服务器。公共 Skill 包不包含本服务域名、远程付款说明、服务器配置或代码下载逻辑。
