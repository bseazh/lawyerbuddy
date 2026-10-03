# 环境变量模板

```text
ALIPAY_ENV=production
PAYMENT_MODE=alipay_production
ALIPAY_APP_ID=
ALIPAY_APP_PRIVATE_KEY_FILE=/absolute/path/app_private_key.pem
ALIPAY_PUBLIC_KEY_FILE=/absolute/path/alipay_public_key.pem
ALIPAY_SELLER_ID=
ALIPAY_SERVICE_ID=
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_UNIT_PRICE_CNY=0.01
# 可选；未设置时首次启动自动生成 data/license-signing-secret
# LICENSE_SIGNING_SECRET_FILE=/etc/lawyerbuddy/secrets/license-signing-secret
LAWYERBUDDY_VERSION=1.9.1
PAYMENT_PROOF_HEADER=Payment-Proof
```

复制变量到项目 `.env`；`.env` 不得提交 GitHub。
