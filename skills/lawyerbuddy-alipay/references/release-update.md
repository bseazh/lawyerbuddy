# 发布与服务器同步

公共本地 Skill 和独立授权服务使用同一个版本号，但发布内容彼此隔离。

## 公共包

1. 更新 `package.json` 版本和变更说明。
2. 运行测试及 `npm run pack:workbuddy`、`npm run pack:skillhub`。
3. 检查公共包不含服务器域名、支付依赖、密钥、订单、授权记录或远程下载逻辑。
4. 推送 GitHub，并在 SkillHub 上传 `lawyerbuddy-skillhub-public-v版本.zip`。

## 授权服务

服务器只同步 `server.cjs`、`package.json`、`package-lock.json` 和 `preflight.cjs`，不上传 Skill ZIP。

```bash
export LB_DEPLOY_HOST=ubuntu@snorlaxden.fun
export LB_SERVER_DIR=/home/ubuntu/Project/lawyerbuddy-api
export LB_RELEASE_VERSION=1.9.0
export LB_SSH_KEY=/绝对路径/lawyerbuddy_paid_deploy_ed25519
./services/lawyerbuddy-paid-api/deploy-production.sh
```

部署前保留服务器现有支付宝环境配置。未设置 `LICENSE_SIGNING_SECRET_FILE` 时，服务首次启动会自动生成权限为 `0600` 的持久化密钥。脚本会重启服务并验证：

- `/health` 返回成功；
- `/v1/skill/download` 返回 `410`；
- 未付款调用 `/v1/license/activate` 返回 `402`。

真实支付宝付款、验付、履约和同订单重试仍需通过官方账户实际联调，不能用未付款预检代替。
