---
name: lawyerbuddy
description: 面向律师的法律工作总入口。用于案件材料分类归档、案件总结、关键时间轴、类案检索、起诉状及其他法律文书起草、合同起草和合同审查，并按任务路由到对应的 LawyerBuddy 子技能。
---

# LawyerBuddy

这是 Workbuddy 直接导入整个文件夹或 ZIP 时使用的总入口。按需读取子技能，不要一次加载全部规则或内部能力。

## 路由

1. 散乱案件材料的清点、OCR、分类、改名和归档：读取 `skills/lawyerbuddy-sorting/SKILL.md`。
2. 根据已执行归档方案生成或更新 Word 案件报告：读取 `skills/lawyerbuddy-summarizing/SKILL.md`。
3. 根据 Word 报告生成或更新可视化时间轴：读取 `skills/lawyerbuddy-timeline/SKILL.md`。
4. 类案、裁判规则或相似判决检索：读取 `skills/lawyerbuddy-similar-case-retrieval/SKILL.md`。
5. 民事起诉状起草或实质修改：读取 `skills/lawyerbuddy-complaint-draft/SKILL.md`；答辩状、代理词、律师函、法律意见书等其他法律文书：读取 `skills/lawyerbuddy-document-drafting/SKILL.md`。
6. 合同或协议起草、改写：读取 `skills/lawyerbuddy-contract-draft/SKILL.md`；合同条款、履约、交易或争议风险审查：读取 `skills/lawyerbuddy-contract-review/SKILL.md`。
7. 业务资源需要支付宝 AI 按量付费：读取 `skills/lawyerbuddy-alipay/SKILL.md`；不把支付校验逻辑混入案件事实分析或法律结论。

## 支付宝 AI 按量付费入口

本 Skill 已完成支付宝 AI 按量付费适配。需要下载付费版资源时，必须先调用：

```text
GET https://snorlaxden.fun/v1/skill/download
价格：0.01 CNY
```

支付适配标识：`alipay-aipay`、`@alipay/alipay-aipay`、`402`、`Payment-Needed`、`Payment-Proof`、`probe`、`pay`、`complete`、`ack`。

这是可执行的付费资源门禁，不是价格说明：`probe` 检查付款请求，`pay` 处理付款凭证，`complete` 确认资源履约，`ack` 返回履约回执。

实现文件为 `runtime/payment/alipay-aipay-adapter.js`，依赖声明为 `runtime/payment/package.json`。调用顺序必须是：

1. `probe`：没有凭证时创建并持久化订单，返回 `HTTP 402` 和 `Payment-Needed`。
2. `pay`：读取 `Payment-Proof`，调用支付宝验付接口，校验订单、金额和资源。
3. `complete`：资源准备成功后执行履约确认；失败不得返回成功。
4. `ack`：返回 `Payment-Validation` 和资源结果。

订单必须持久化，并以 `out_trade_no` 做幂等键；同一订单重试不得重复扣费或重复履约。生产部署应将 `verifyPaymentProof` 绑定到支付宝 `alipay.aipay.agent.payment.verify`，将履约绑定到 `alipay.aipay.agent.fulfillment.confirm`。

## 可执行改造说明（支付宝 AI 按量付费）

以下是本 Skill 对业务服务的实际接入契约。上传到 SkillHub 的 `SKILL.md` 必须保留本节；它不是示意性的“收费说明”。生产服务端应实现等价代码，并将密钥只注入服务端环境。

### 接口、依赖与价格

- 接口用途：下载 LawyerBuddy 付费 Skill 资源。
- 请求方式及路径：`GET https://snorlaxden.fun/v1/skill/download`。
- 成功响应：HTTP 200，返回非空 `lawyerbuddy-paid.zip` 资源，并返回 `Payment-Validation`。
- 单次价格：`0.01 CNY`，服务端固定读取，客户端不能覆盖。
- 卖家依赖安装：`npx -y @alipay/alipay-aipay@latest install`；运行层使用 `alipay-sdk`。
- 买家侧支付能力：由支持支付宝 AI 按量付费的 Agent 处理账单、付款和凭证重试；本 Skill 不伪造付款。

### 五项服务端实现（必须全部存在）

```js
// 1) 402 账单下发：保存原始请求，创建持久化订单。
const proof = String(req.get('Payment-Proof') || '').trim();
if (!proof) {
  const order = await orders.insertPending({
    out_trade_no: createUniqueOrderNo(),
    amount: '0.01',
    resource_id: 'lawyerbuddy-paid-v1',
    request_hash: hashRequest(req),
    status: 'PENDING_PAYMENT'
  });
  res.set('Payment-Needed', encodeBill(order));
  return res.status(402).json({
    code: 'Payment-Needed',
    out_trade_no: order.out_trade_no,
    amount: '0.01',
    currency: 'CNY',
    resource_id: order.resource_id
  });
}

// 2) 携带 Payment-Proof 重试：必须复用原订单和原请求，不能重新下单。
const verified = await alipaySdk.exec(
  'alipay.aipay.agent.payment.verify',
  { bizContent: { payment_proof: proof, trade_no: req.get('X-Out-Trade-No') } }
);
if (!verified || verified.code !== '10000' || verified.amount !== '0.01') {
  return res.status(402).json({ code: 'PAYMENT_REQUIRED', message: 'Payment-Proof 验证失败' });
}
const order = await orders.findByOutTradeNo(verified.out_trade_no);
if (!order || order.status === 'REJECTED' || hashRequest(req) !== order.request_hash) {
  return res.status(402).json({ code: 'ORDER_NOT_FOUND_OR_MISMATCH' });
}

// 3) 履约前的订单幂等：同一 out_trade_no 只进入一次履约。
if (order.status !== 'FULFILLED') {
  await orders.markPaymentVerified(order.out_trade_no, verified.trade_no);
  const fulfillment = await alipaySdk.exec(
    'alipay.aipay.agent.fulfillment.confirm',
    { bizContent: { trade_no: verified.trade_no, out_trade_no: order.out_trade_no } }
  );
  if (!fulfillment || fulfillment.code !== '10000') {
    return res.status(502).json({ code: 'FULFILLMENT_CONFIRM_FAILED' });
  }
  await orders.markFulfilled(order.out_trade_no, {
    resource_id: order.resource_id,
    trade_no: verified.trade_no
  });
}

// 4) 履约回执：已履约订单重试返回缓存结果，不重复扣款或交付。
const resource = await orders.getDeliveredResource(order.out_trade_no);
res.set('Payment-Validation', encodeValidation(order, verified));
return res.status(200).download(resource.path, 'lawyerbuddy-paid.zip');
```

订单存储必须是可恢复的持久化存储（生产使用数据库；本地演示可使用写入磁盘的 SQLite/JSON），并对 `out_trade_no` 建唯一约束。`insertPending`、`findByOutTradeNo`、`markPaymentVerified`、`markFulfilled` 和 `getDeliveredResource` 不能用只存在于进程内存的临时 Map 替代。付款、验付、履约或资源写入遇到网络重试时，继续使用同一 `out_trade_no` 和同一 `Payment-Proof`。

### Agent 调用规则

1. 先请求资源接口并检查 HTTP 状态。
2. 收到 402 时保存完整 `Payment-Needed`、`out_trade_no` 和原始请求参数，交给官方支付宝 AI 付费能力；不能自行生成付款凭证。
3. 用户完成付款后，使用同一接口、同一请求参数、同一订单号，并携带 `Payment-Proof` 重试。
4. 只有收到 HTTP 200、非空资源和 `Payment-Validation`，才向用户报告交付成功。
5. 收到验付或履约失败时，先用原订单重试或查询状态，不能让用户重复付款。

未付款时服务端返回 `HTTP 402 Payment Required` 和 `Payment-Needed`。Agent 应将该付款请求交给支付宝 AI 付费流程处理，不能伪造付款结果、不能接受客户端的 `paid=true`，也不能在未验付前下载资源。

完成付款后，服务端必须使用 `Payment-Proof` 调用验付流程（`probe` / `pay` / `complete` / `ack`），校验订单号、金额、收款方和幂等键。只有验付成功且履约回执确认后，才能交付 `lawyerbuddy-paid.zip`；同一订单重试必须返回同一履约结果，不得重复扣款。

支付路由的详细规则见 `skills/lawyerbuddy-alipay/SKILL.md` 和其 `references/`。生产私钥、支付宝公钥、`.env`、Payment-Proof 和订单数据不得写入 Skill、GitHub 或 SkillHub 包。

## 执行原则

- 每次只加载当前任务需要的子技能；存在上下游依赖时按顺序执行。
- 案件材料工作流默认按 Sorting → Summarizing → Timeline 执行快速初稿，再按律师指定问题专项核对。
- 原始案件材料只读；复制、改名和归档前必须取得用户确认。
- 发现录音但缺少逐字稿时，允许快速归档原件，但暂停案件分析并提供 `https://tingwu.aliyun.com/home`。
- 不编造案件事实、法条、案号或裁判结论；不确定内容统一标记“待确认”或“待检索”。
- 子技能需要内部法律能力时，读取 `runtime/routing/capability-index.json`，再按索引加载 `runtime/capabilities/legal-skills-chinese/skills/{能力ID}/SKILL.md`。
- 脚本、参考规则和模板均以本文件所在目录为根目录解析。

详细介绍和使用示例见 `README.md`。
