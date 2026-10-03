# 支付流程

服务端固定读取 `ALIPAY_UNIT_PRICE_CNY=0.01`，创建订单并返回 402。Payment-Proof 必须在服务端验证，不能接受客户端的 `paid: true`。

状态：`requested` → `payment_required` → `proof_verified` → `fulfilled`。验证失败进入 `rejected`；授权签发或履约失败进入 `fulfillment_failed`。

以支付宝订单号和激活请求摘要建立唯一约束。已履约订单重试返回原授权令牌和履约回执；已付款但未履约的订单恢复同一次履约；不得因网络重试再次扣费或重复签发授权。

日志不得写入私钥、完整 Payment-Proof 或敏感用户数据。生产环境需补充回调验签、重放防护、退款和异常补偿。
