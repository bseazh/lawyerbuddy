# 生产授权激活服务

旧的付费 ZIP 下载模式已经停用。公共 LawyerBuddy Skill 通过 SkillHub、WorkBuddy 或 GitHub 正常安装；独立服务器只处理授权激活。

```text
POST https://snorlaxden.fun/v1/license/activate
POST https://snorlaxden.fun/v1/license/status
POST https://snorlaxden.fun/v1/license/session
POST https://snorlaxden.fun/v1/license/session/status
GET  https://snorlaxden.fun/v1/skill/download → 410
```

激活接口保留完整的支付宝 `402 → Payment-Proof → 验付 → 履约确认 → 授权令牌` 流程。相同订单与请求重试必须返回相同授权，不重复扣费或重复签发。

生产配置除支付宝参数外，应设置当前版本：

```text
LAWYERBUDDY_VERSION=1.9.4
```

为兼容使用 Fake-IP DNS 的终端，生产服务器同时提供 `https://134.175.154.244`。该入口必须使用公开 CA 签发、包含公网 IP SAN 的证书；不得使用自签名证书或关闭 TLS 校验。当前证书由 Certbot 的 `shortlived` 配置自动续期，续期钩子复制证书到 Caddy 可读目录并重新加载 Caddy。域名入口仍是默认入口，客户端仅在检测到受限 DNS 或官方 CLI 明确返回 `PROXY_TARGET_BLOCKED` 时切换。

每次部署必须同时检查域名和公网 IP 的 `/health`，并确认两个入口的 `/v1/license/activate` 均返回真实 `HTTP 402`。证书续期可定期用以下命令演练，不发起付款：

```bash
sudo certbot renew --cert-name 134.175.154.244 --dry-run --run-deploy-hooks
```

未显式配置 `LICENSE_SIGNING_SECRET_FILE` 时，服务会在首次启动时生成 `data/license-signing-secret`。生产密钥、订单和授权记录只能保留在服务器。公共 Skill 包不包含本服务域名、远程付款说明、服务器配置或代码下载逻辑。
