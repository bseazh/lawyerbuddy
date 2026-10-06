# LawyerBuddy Pay Skill

这是用于 SkillHub“发布付费 Skill”的上传包。首次使用通过支付宝 AI 按量付费完成 `0.01 元`永久授权；激活后案件材料处理与法律工作均在本地执行，不重复收费。

GitHub 安装后还需安装支付宝官方支付能力：

```bash
npx -y @alipay/alipay-aipay@latest install
```

买家侧需要支付宝官方支付能力：

```bash
npx -y --registry=https://registry.npmjs.org @alipay/agent-payment@1.0.23 install
```

上传包不包含支付宝私钥、服务端环境变量、订单数据、授权数据或 `node_modules`。支付流程和业务路由以根目录 `SKILL.md` 为准。
