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
      LAWYERBUDDY_VERSION: '1.9.1'
    });

    const payment = { outTradeNo: '', resourceId: '' };
    const sdk = {
      async exec(method) {
        if (method === 'alipay.aipay.agent.payment.verify') {
          return {
            code: '10000', active: true, trade_no: 'ALIPAY_TEST_TRADE',
            out_trade_no: payment.outTradeNo, amount: '0.01', resource_id: payment.resourceId
          };
        }
        if (method === 'alipay.aipay.agent.fulfillment.confirm') return { code: '10000' };
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
    const body = { client_id: 'local-test', skill_version: '1.9.1', features: ['sorting', 'timeline'] };

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

    const validLicense = await request(base, '/v1/license/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license_token: activated.body.license_token })
    });
    assert.equal(validLicense.status, 200);
    assert.equal(validLicense.body.active, true);

    const download = await request(base, '/v1/skill/download');
    assert.equal(download.status, 410);
    assert.equal(download.body.code, 'DOWNLOAD_DISABLED');

    const invalidLicense = await request(base, '/v1/license/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license_token: 'invalid' })
    });
    assert.equal(invalidLicense.status, 401);
    assert.ok(fs.statSync(path.join(temporary, 'data', 'orders.json')).size > 0);
    console.log('license API checks passed: 402, proof verification, fulfillment, stable retry token, status validation, mismatch=409, download=410');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
