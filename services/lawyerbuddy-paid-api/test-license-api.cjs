const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function b64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lawyerbuddy-license-test-'));
  let server;
  try {
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateFile = path.join(temporary, 'app-private.pem');
    const publicFile = path.join(temporary, 'alipay-public.pem');
    const secretFile = path.join(temporary, 'license-secret');
    fs.writeFileSync(privateFile, keys.privateKey.export({ format: 'pem', type: 'pkcs1' }), { mode: 0o600 });
    fs.writeFileSync(publicFile, keys.publicKey.export({ format: 'pem', type: 'spki' }), { mode: 0o600 });
    fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });

    Object.assign(process.env, {
      ALIPAY_ENV: 'sandbox',
      PAYMENT_MODE: 'alipay_sandbox',
      ALIPAY_APP_ID: '2021000000000000',
      ALIPAY_APP_PRIVATE_KEY_FILE: privateFile,
      ALIPAY_PUBLIC_KEY_FILE: publicFile,
      ALIPAY_SELLER_ID: '2088000000000000',
      ALIPAY_SERVICE_ID: 'api_mock_service_id',
      LICENSE_SIGNING_SECRET_FILE: secretFile,
      LAWYERBUDDY_DATA_DIR: path.join(temporary, 'data'),
      LAWYERBUDDY_VERSION: '1.10.0'
    });

    const payment = { outTradeNo: '', resourceId: '' };
    const trade = { status: 'TRADE_SUCCESS', amount: '0.01', sellerId: '2088000000000000', tradeNo: '20261023008283124939440000244949', queryAllowed: true, confirmFound: true, confirmAlreadyFulfilled: false };
    const sdk = {
      async exec(method, request) {
        if (method === 'alipay.aipay.agent.payment.verify') {
          return {
            code: '10000', active: true, trade_no: 'ALIPAY_TEST_TRADE',
            out_trade_no: payment.outTradeNo, amount: '0.01', resource_id: payment.resourceId
          };
        }
        if (method === 'alipay.trade.query') {
          if (!trade.queryAllowed) {
            return { code: '40006', msg: 'Insufficient Permissions', sub_code: 'isv.insufficient-isv-permissions' };
          }
          return {
            code: '10000', trade_no: trade.tradeNo,
            out_trade_no: request?.bizContent?.out_trade_no || payment.outTradeNo,
            trade_status: trade.status, total_amount: trade.amount, seller_id: trade.sellerId
          };
        }
        if (method === 'alipay.aipay.agent.fulfillment.confirm') {
          if (!trade.confirmFound) {
            return { code: '40004', subCode: 'TRADE_NOT_FOUND', subMsg: '交易不存在' };
          }
          if (trade.confirmAlreadyFulfilled) {
            return { code: '40004', subCode: 'TRADE_STATUS_INVALID', subMsg: '交易状态不允许履约' };
          }
          return { code: '10000', tradeNo: request?.bizContent?.trade_no || 'ALIPAY_TEST_TRADE' };
        }
        throw new Error(`unexpected Alipay method: ${method}`);
      }
    };
    const { createApp } = require('./server.cjs');
    server = createApp({ sdk }).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const body = { client_id: 'local-test', skill_version: '1.10.0', features: ['sorting', 'timeline'] };

    const health = await request(base, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.download_endpoint, 'disabled');

    const first = await request(base, '/v1/license/activate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal(first.status, 402);
    assert.ok(first.headers.get('payment-needed'));
    assert.ok(first.body.out_trade_no);
    payment.outTradeNo = first.body.out_trade_no;
    payment.resourceId = first.body.resource_id;

    const retry = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': first.body.out_trade_no },
      body: JSON.stringify({ ...body, features: ['timeline', 'sorting'] })
    });
    assert.equal(retry.status, 402, JSON.stringify(retry.body));
    assert.equal(retry.body.out_trade_no, first.body.out_trade_no);

    const mismatch = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': first.body.out_trade_no },
      body: JSON.stringify({ ...body, client_id: 'another-client' })
    });
    assert.equal(mismatch.status, 409);

    const invalidOrder = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': '__proto__' },
      body: JSON.stringify(body)
    });
    assert.equal(invalidOrder.status, 400);

    const lowercaseOrder = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': 'LBORDER_1234567890_abcdef1234567890' },
      body: JSON.stringify({ ...body, client_id: 'lowercase-order-test' })
    });
    assert.equal(lowercaseOrder.status, 402, JSON.stringify(lowercaseOrder.body));
    assert.equal(lowercaseOrder.body.out_trade_no, 'LBORDER_1234567890_abcdef1234567890');

    const proof = b64url(JSON.stringify({
      protocol: { payment_proof: 'mock-proof', trade_no: 'ALIPAY_TEST_TRADE' }, method: {}
    }));
    const activated = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': first.body.out_trade_no, 'Payment-Proof': proof },
      body: JSON.stringify(body)
    });
    assert.equal(activated.status, 200);
    assert.ok(activated.body.license_token);
    assert.equal(activated.body.fulfillment_confirmed, true);
    assert.equal(activated.body.already_activated, false);

    const activatedAgain = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': first.body.out_trade_no, 'Payment-Proof': proof },
      body: JSON.stringify(body)
    });
    assert.equal(activatedAgain.status, 200);
    assert.equal(activatedAgain.body.license_token, activated.body.license_token);
    assert.equal(activatedAgain.body.already_activated, true);

    const reconcileBody = { client_id: 'reconcile-client', skill_version: '1.10.0', features: ['sorting'] };
    const reconcileOrder = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': 'LBORDER_1792730990662_reconcile01' },
      body: JSON.stringify(reconcileBody)
    });
    assert.equal(reconcileOrder.status, 402, JSON.stringify(reconcileOrder.body));
    const reconciled = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Out-Trade-No': reconcileOrder.body.out_trade_no,
        'X-Trade-No': trade.tradeNo
      },
      body: JSON.stringify({ ...reconcileBody, out_trade_no: reconcileOrder.body.out_trade_no, trade_no: trade.tradeNo })
    });
    assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body));
    assert.ok(reconciled.body.license_token);
    assert.equal(reconciled.body.fulfillment_confirmed, true);
    assert.equal(reconciled.body.already_activated, false);
    assert.equal(reconciled.body.trade_no, trade.tradeNo);

    const reconciledAgain = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': reconcileOrder.body.out_trade_no },
      body: JSON.stringify({ ...reconcileBody, out_trade_no: reconcileOrder.body.out_trade_no, trade_no: trade.tradeNo })
    });
    assert.equal(reconciledAgain.status, 200);
    assert.equal(reconciledAgain.body.license_token, reconciled.body.license_token);
    assert.equal(reconciledAgain.body.already_activated, true);

    const reconcileMismatch = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': reconcileOrder.body.out_trade_no },
      body: JSON.stringify({ ...reconcileBody, client_id: 'another-client', out_trade_no: reconcileOrder.body.out_trade_no })
    });
    assert.equal(reconcileMismatch.status, 409);

    const reconcileInvalidTradeNo = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': reconcileOrder.body.out_trade_no },
      body: JSON.stringify({ ...reconcileBody, out_trade_no: reconcileOrder.body.out_trade_no, trade_no: reconcileOrder.body.out_trade_no })
    });
    assert.equal(reconcileInvalidTradeNo.status, 400);

    trade.status = 'WAIT_BUYER_PAY';
    const unpaidBody = { client_id: 'unpaid-client', skill_version: '1.10.0', features: ['timeline'] };
    const unpaidOrder = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': 'LBORDER_1792730990662_unpaid001' },
      body: JSON.stringify(unpaidBody)
    });
    assert.equal(unpaidOrder.status, 402);
    const unpaid = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': unpaidOrder.body.out_trade_no },
      body: JSON.stringify({ ...unpaidBody, out_trade_no: unpaidOrder.body.out_trade_no })
    });
    assert.equal(unpaid.status, 402);
    assert.equal(unpaid.body.code, 'TRADE_NOT_PAID');
    trade.status = 'TRADE_SUCCESS';

    trade.amount = '0.02';
    const amountBody = { client_id: 'amount-client', skill_version: '1.10.0', features: ['sorting', 'timeline'] };
    const amountOrder = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': 'LBORDER_1792730990662_amount01' },
      body: JSON.stringify(amountBody)
    });
    assert.equal(amountOrder.status, 402);
    const amountMismatch = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': amountOrder.body.out_trade_no },
      body: JSON.stringify({ ...amountBody, out_trade_no: amountOrder.body.out_trade_no })
    });
    assert.equal(amountMismatch.status, 409);
    assert.equal(amountMismatch.body.code, 'TRADE_AMOUNT_MISMATCH');
    trade.amount = '0.01';

    trade.queryAllowed = false;
    trade.confirmFound = true;
    const fallbackBody = { client_id: 'fallback-client', skill_version: '1.10.0', features: ['sorting'] };
    const fallbackOrder = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': 'LBORDER_1792730990662_fallback1' },
      body: JSON.stringify(fallbackBody)
    });
    assert.equal(fallbackOrder.status, 402);
    const fallback = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': fallbackOrder.body.out_trade_no },
      body: JSON.stringify({ ...fallbackBody, out_trade_no: fallbackOrder.body.out_trade_no, trade_no: trade.tradeNo })
    });
    assert.equal(fallback.status, 200, JSON.stringify(fallback.body));
    assert.equal(fallback.body.verified_by, 'fulfillment_confirm');
    assert.equal(fallback.body.fulfillment_confirmed, true);
    assert.ok(fallback.body.license_token);

    trade.queryAllowed = false;
    trade.confirmAlreadyFulfilled = true;
    const alreadyFulfilledBody = { client_id: 'already-fulfilled-client', skill_version: '1.10.0', features: ['sorting'] };
    const alreadyFulfilledOrder = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': 'LBORDER_1792730990662_fallback3' },
      body: JSON.stringify(alreadyFulfilledBody)
    });
    assert.equal(alreadyFulfilledOrder.status, 402);
    const alreadyFulfilled = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': alreadyFulfilledOrder.body.out_trade_no },
      body: JSON.stringify({ ...alreadyFulfilledBody, out_trade_no: alreadyFulfilledOrder.body.out_trade_no, trade_no: trade.tradeNo })
    });
    assert.equal(alreadyFulfilled.status, 200, JSON.stringify(alreadyFulfilled.body));
    assert.equal(alreadyFulfilled.body.verified_by, 'fulfillment_confirm');
    trade.confirmAlreadyFulfilled = false;

    trade.confirmFound = false;
    const unpaidFallbackBody = { client_id: 'fallback-unpaid-client', skill_version: '1.10.0', features: ['timeline'] };
    const unpaidFallbackOrder = await request(base, '/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': 'LBORDER_1792730990662_fallback2' },
      body: JSON.stringify(unpaidFallbackBody)
    });
    assert.equal(unpaidFallbackOrder.status, 402);
    const unpaidFallback = await request(base, '/v1/license/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Out-Trade-No': unpaidFallbackOrder.body.out_trade_no },
      body: JSON.stringify({ ...unpaidFallbackBody, out_trade_no: unpaidFallbackOrder.body.out_trade_no, trade_no: trade.tradeNo })
    });
    assert.equal(unpaidFallback.status, 402);
    assert.equal(unpaidFallback.body.code, 'TRADE_NOT_PAID');
    trade.queryAllowed = true;
    trade.confirmFound = true;

    const validLicense = await request(base, '/v1/license/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license_token: activated.body.license_token })
    });
    assert.equal(validLicense.status, 200);
    assert.equal(validLicense.body.active, true);

    const session = await request(base, '/v1/license/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activated.body.license_token}`, 'X-Client-Id': body.client_id },
      body: JSON.stringify({ client_id: body.client_id })
    });
    assert.equal(session.status, 200, JSON.stringify(session.body));
    assert.ok(session.body.session_token);
    assert.equal(session.body.ttl_seconds, 43200);

    const sessionStatus = await request(base, '/v1/license/session/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.body.session_token}`, 'X-Client-Id': body.client_id },
      body: JSON.stringify({ client_id: body.client_id })
    });
    assert.equal(sessionStatus.status, 200, JSON.stringify(sessionStatus.body));
    assert.equal(sessionStatus.body.active, true);

    const copiedSession = await request(base, '/v1/license/session/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.body.session_token}`, 'X-Client-Id': 'another-client' },
      body: JSON.stringify({ client_id: 'another-client' })
    });
    assert.equal(copiedSession.status, 401);

    const sessionWithoutLicense = await request(base, '/v1/license/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid' }, body: JSON.stringify({ client_id: body.client_id })
    });
    assert.equal(sessionWithoutLicense.status, 401);

    const download = await request(base, '/v1/skill/download');
    assert.equal(download.status, 410);
    assert.equal(download.body.code, 'DOWNLOAD_DISABLED');

    const invalidLicense = await request(base, '/v1/license/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license_token: 'invalid' })
    });
    assert.equal(invalidLicense.status, 401);
    assert.ok(fs.statSync(path.join(temporary, 'data', 'orders.json')).size > 0);
    console.log('license API checks passed: 402, proof verification, fulfillment, stable retry token, 12h session gate, mismatch=409, download=410');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
