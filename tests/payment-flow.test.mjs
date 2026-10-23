import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyPaymentOutput,
  classifyWalletOutput,
  extractTradeNo,
  isReusablePendingOrder,
  parsePaymentQuery,
  resolvePaymentQuery,
  resolveSessionId
} from '../skills/lawyerbuddy-paid/scripts/lawyerbuddy-paid.mjs';

test('same buyer and seller account blocks the pending order', () => {
  const failure = classifyPaymentOutput(JSON.stringify({
    errorCode: 'TRADE_PROGRESS_FAILED',
    errorMsg: '买家和卖家不能相同',
    success: false
  }));
  assert.equal(failure.code, 'BUYER_SELLER_SAME');
  assert.equal(failure.buyerAction, true);
  assert.equal(failure.blockOrder, true);
});

test('already paid orders ask for query instead of another payment', () => {
  for (const code of ['TRADE_ALREADY_PAID', 'TRADE_HAS_PAID', 'PAYMENT_PROCESSING']) {
    const failure = classifyPaymentOutput(JSON.stringify({ code }));
    assert.equal(failure.code, 'TRADE_ALREADY_PAID', code);
    assert.equal(failure.buyerAction, false, code);
    assert.match(failure.next, /complete/);
  }
});

test('expired or missing trades query the original order first', () => {
  for (const code of ['TRADE_STATUS_NOT_ALLOW_GENERATE_PROOF', 'TRADE_NOT_FOUND', 'REQUEST_EXPIRED']) {
    const failure = classifyPaymentOutput(JSON.stringify({ code }));
    assert.equal(failure.code, 'TRADE_QUERY_FIRST', code);
    assert.match(failure.next, /probe --new-order true/);
  }
});

test('unknown payment outcomes never ask for a second payment', () => {
  const failure = classifyPaymentOutput(JSON.stringify({ code: 'RESOURCE_OUTCOME_UNKNOWN' }));
  assert.equal(failure.code, 'PAYMENT_OUTCOME_UNKNOWN');
  assert.match(failure.next, /不要再次付款/);
});

test('server-side fulfillment failures retry the same order', () => {
  const fulfillment = classifyPaymentOutput(JSON.stringify({ code: 'FULFILLMENT_CONFIRM_FAILED' }));
  assert.equal(fulfillment.code, 'FULFILLMENT_RETRY');
  assert.match(fulfillment.next, /不能再次付款|不要再次付款/);
  const missing = classifyPaymentOutput(JSON.stringify({ code: 'ORDER_NOT_FOUND' }));
  assert.equal(missing.code, 'SERVER_ORDER_MISSING');
  assert.match(missing.next, /确认支付宝是否已经扣款/);
});

test('configuration mismatches stop the buyer flow', () => {
  const failure = classifyPaymentOutput(JSON.stringify({ code: 'SERVICE_PRICE_MISMATCH' }));
  assert.equal(failure.code, 'PAYMENT_CONFIG_MISMATCH');
  assert.equal(failure.buyerAction, false);
  assert.match(failure.next, /服务端/);
});

test('wallet states are classified without trusting user claims', () => {
  assert.equal(classifyWalletOutput(1, JSON.stringify({
    code: 500, message: '未开通', neverCreated: true, status: 'unbound'
  })).state, 'UNBOUND');
  assert.equal(classifyWalletOutput(0, JSON.stringify({
    code: 200, message: '已开启支付宝支付功能', status: 'active'
  })).state, 'READY');
  assert.equal(classifyWalletOutput(1, JSON.stringify({
    code: 500, message: '买家和卖家不能相同'
  })).state, 'SELLER_ACCOUNT');
  assert.equal(classifyWalletOutput(1, JSON.stringify({
    code: 500, message: '钱包已申请，等待绑定授权码', status: 'applied_unbound'
  })).state, 'APPLIED_UNBOUND');
});

test('pending orders are reused only while still valid', () => {
  const now = Date.parse('2026-10-23T08:00:00.000Z');
  const base = {
    out_trade_no: 'LBORDER_1',
    resource_url: 'https://example.test/v1/license/activate',
    created_at: '2026-10-23T07:50:00.000Z',
    pay_before: '2026-10-23T08:20:00.000Z'
  };
  assert.equal(isReusablePendingOrder(base, now), true);
  assert.equal(isReusablePendingOrder({ ...base, reusable: false }, now), false);
  assert.equal(isReusablePendingOrder({ ...base, blocked_reason: 'BUYER_SELLER_SAME' }, now), false);
  assert.equal(isReusablePendingOrder({ ...base, pay_before: '2026-10-23T08:00:30.000Z' }, now), false);
  assert.equal(isReusablePendingOrder({ ...base, created_at: '2026-10-23T07:00:00.000Z' }, now), false);
});

test('complete reads the Alipay query number or trade number from pay output', () => {
  assert.deepEqual(
    resolvePaymentQuery({}, '查询单号：20261006008282201800720000217548'),
    ['--out-shake-no', '20261006008282201800720000217548']
  );
  assert.deepEqual(
    resolvePaymentQuery({}, '交易号：20261006008282201800720000217548'),
    ['--trade-no', '20261006008282201800720000217548']
  );
  assert.deepEqual(
    resolvePaymentQuery({ 'trade-no': '20261006008282201800720000217548' }, ''),
    ['--trade-no', '20261006008282201800720000217548']
  );
});

test('paid orders with an unavailable buyer query fall back to server reconciliation', () => {
  const paymentOutput = [
    '**✓ 支付待确认**',
    '**商品名称**：LawyerBuddy 本地版授权激活',
    '**支付金额**：0.01 CNY',
    '**商户名称**：何海钊',
    '**交易号**：20261023008283124939440000244949',
    '**支付方式**：请点击支付链接'
  ].join('\n');
  assert.equal(extractTradeNo(paymentOutput), '20261023008283124939440000244949');
  assert.deepEqual(parsePaymentQuery({}, paymentOutput), ['--trade-no', '20261023008283124939440000244949']);
  assert.deepEqual(parsePaymentQuery({ 'trade-no': 'LBORDER_1792730990662_9d7859ee11da445d' }, paymentOutput), ['--trade-no', '20261023008283124939440000244949']);
  assert.equal(parsePaymentQuery({ 'trade-no': 'LBORDER_1792730990662_9d7859ee11da445d' }, ''), null);
  assert.equal(classifyPaymentOutput(JSON.stringify({
    errorCode: 'SYSTEM_ERROR', errorMsg: '查询支付凭证失败', success: false
  })).recoverable, true);
  assert.equal(classifyPaymentOutput(JSON.stringify({
    errorCode: 'PAYMENT_QUERY_CREDENTIAL_UNAVAILABLE', success: false
  })).recoverable, true);
  assert.match(classifyPaymentOutput(JSON.stringify({
    errorCode: 'SYSTEM_ERROR', errorMsg: '查询支付凭证失败'
  })).next, /recover/);
});

test('session id is supplied, discovered, or persisted once', () => {
  const names = [
    'OPENCLAW_SESSION_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID',
    'OPENCODE_SESSION_ID', 'AGENT_SESSION_ID', 'SESSION_ID'
  ];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lawyerbuddy-session-'));
  try {
    assert.equal(resolveSessionId(directory, { 'session-id': 'runtime-session' }), 'runtime-session');
    const first = resolveSessionId(directory, {});
    const second = resolveSessionId(directory, {});
    assert.match(first, /^LBSESSION-/);
    assert.equal(first, second);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
