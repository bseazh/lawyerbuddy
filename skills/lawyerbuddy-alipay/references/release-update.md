# 付费版发布与服务器同步

本规则适用于每一次 LawyerBuddy 付费版更新。GitHub、SkillHub 和付费下载服务器必须使用同一个版本号；只更新其中一处视为发布未完成。

## 发布前

1. 在仓库根目录递增 `package.json` 的 `version`，遵循 `MAJOR.MINOR.PATCH`。
2. 更新变更说明，并运行 `npm run pack:workbuddy`、`npm run pack:skillhub`。SkillHub 付费预检会按上传文件顺序选第一个 basename 为 `SKILL.md` 的文件，因此打包器强制 ZIP 顶层根 `SKILL.md` 为第一项；上传必须使用生成的 ZIP，不要上传文件夹或手工重新压缩。
3. 生成与版本号一致的付费 ZIP，例如 `lawyerbuddy-paid-v1.8.4-paid.1.zip`。不得包含 `.env`、私钥、公钥、订单数据、`node_modules`、`.pyc` 或本地缓存。
4. 本地执行 `npm ci`、`npm run preflight`；未配置生产密钥时只做结构检查，不伪称已完成支付宝验付。
5. 检查 `git diff` 和 `git status`，确认没有密钥或本地配置文件。

## 同步服务器

使用 SSH 密钥执行下方脚本。不要把密码、私钥或生产 `.env` 写进脚本、Skill、GitHub 或 SkillHub：

```bash
export LB_DEPLOY_HOST=ubuntu@snorlaxden.fun
export LB_SERVER_DIR=/home/ubuntu/Project/lawyerbuddy-api
export LB_RELEASE_VERSION=1.8.4
export LB_PAID_ZIP=/绝对路径/lawyerbuddy-paid-v1.8.4-paid.1.zip
./services/lawyerbuddy-paid-api/deploy-production.sh
```

脚本会上传 API 源码和付费 ZIP，保留服务器 `/etc/lawyerbuddy/lawyerbuddy-api.env` 和密钥目录，重启服务并检查 `/health`。

## 推送与验收

服务器健康检查通过后，再提交并推送：

```bash
git add package.json package-lock.json skills services README.md CHANGELOG.md
git commit -m "release: v1.8.4"
git tag v1.8.4
git push origin main --follow-tags
```

随后确认 `/health` 返回 `ok: true`；未付款访问 `/v1/skill/download` 必须返回 `402` 和 `Payment-Needed`。真实支付宝付款、验付、履约和 ZIP 下载只有在官方账户实际联调后才能标记为通过。

## 版本回滚

若健康检查失败，恢复服务器上一版 ZIP/源码；不要删除订单或支付记录。修复后递增 PATCH 版本重新发布，不覆盖已发布版本号。
