# LawyerBuddy Pay Skill

这是用于 SkillHub“发布付费 Skill”的上传包。首次使用通过支付宝 AI 按量付费完成 `0.01 元`永久授权；激活后案件材料处理与法律工作均在本地执行，不重复收费。

GitHub 安装后还需安装支付宝官方支付能力：

```bash
npx -y @alipay/alipay-aipay@latest install
```

买家侧需要支付宝官方支付能力：

```bash
npx -y --registry=https://registry.npmjs.org @alipay/agent-payment@1.0.23 install-cli
```

支付脚本会自动兼容 Clash 等代理软件的 Fake-IP 模式。用户不需要修改 DNS、`hosts`、代理配置或关闭安全校验。

首次付款前，Agent 必须先用支付宝官方组件确认“买家钱包”已经开启。LawyerBuddy 商家账号是卖家/收款方；扫码开通和支付 0.01 元的账号是买家/付款方，两者不能相同。支付链接过期时先查原订单，只有订单明确不存在或已关闭并取得用户同意后才重新下单。

钱包绑定异常时不得让普通用户手工删除本地凭证、修改设备标识或反复调整代理设置；应保留订单号并走支付宝官方钱包管理或问题反馈流程。

上传包不包含支付宝私钥、服务端环境变量、订单数据、授权数据或 `node_modules`。支付流程和业务路由以根目录 `SKILL.md` 为准。
