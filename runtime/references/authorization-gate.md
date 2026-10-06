# LawyerBuddy 授权门禁

每次调用总路由或任一产品 Skill，必须在读取用户材料、读取业务 reference、检索或生成成果之前执行授权检查。

1. 找到已安装的 `lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs`。GitHub Skills CLI 双入口安装默认位置是 `.agents/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs`；仅安装总路由时可能位于 `.agents/skills/lawyerbuddy/skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs`；WorkBuddy 整包通常位于 `skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs`；SkillHub 付费包位于根目录 `scripts/lawyerbuddy-paid.mjs`。
2. 在当前律师项目目录运行：

```bash
node <支付脚本绝对路径> gate --state-dir .lawyerbuddy-license
```

3. 只有真实命令输出 `status: AUTHORIZED` 才能继续本次业务调用。不得用固定字符串、用户口述、旧日志、历史截图或自行创建的文件代替检查。
4. 输出 `AUTHORIZATION_REQUIRED`、网络失败、脚本缺失或任何非零状态时，立即停止，不读取案件材料，不生成结果。提示用户先安装并调用 `@lawyerbuddy-paid`。
5. 会话凭证有效 12 小时，但每次调用仍在线验签。到期后用已保存的永久授权自动续签，不重复收费；永久授权不存在或无效时才进入首次支付流程。

授权文件包含敏感令牌，目录权限为 `0700`、文件权限为 `0600`；不得展示、复制到报告、提交 GitHub 或发送给其他用户。
