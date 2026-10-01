const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { AlipaySdk } = require('alipay-sdk');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SANDBOX_SERVICE_ID = 'api_mock_service_id';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function readKeyMaterial(file, kind) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8').trim();
  if (!raw) throw new Error(`密钥文件为空：${file}`);
  if (raw.includes('BEGIN ')) return raw;
  const compact = raw.replace(/\s+/g, '');
  if (kind === 'private') {
    return `-----BEGIN RSA PRIVATE KEY-----\n${compact.match(/.{1,64}/g).join('\n')}\n-----END RSA PRIVATE KEY-----`;
  }
  return `-----BEGIN PUBLIC KEY-----\n${compact.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
}

function rawPkcs1PrivateKey(file) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8').trim();
  return rawPkcs1PrivateKeyMaterial(raw);
}

function rawPkcs1PrivateKeyMaterial(raw) {
  const compact = raw.replace(/-----BEGIN RSA PRIVATE KEY-----|-----END RSA PRIVATE KEY-----|\s+/g, '');
  return crypto.createPrivateKey({ key: Buffer.from(compact, 'base64'), format: 'der', type: 'pkcs1' });
}

function readOfficialSandboxConfig() {
  const file = path.resolve(process.env.ALIPAY_SANDBOX_CONFIG_FILE || path.join(ROOT, '.alipay-sandbox.json'));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const app = data?.appIds?.[0];
  const partnerId = data?.sandboxAccounts?.partner?.userId;
  if (!app?.appId || !app?.appPrivatePkcsKey || !app?.alipayPublicKey || !partnerId) {
    throw new Error('官方沙箱配置缺少应用、私钥、公钥或商家账号字段');
  }
  return {
    appId: app.appId,
    sellerId: partnerId,
    privateKey: readKeyMaterialFromValue(app.appPrivatePkcsKey, 'private'),
    publicKey: readKeyMaterialFromValue(app.alipayPublicKey, 'public'),
    signingKey: rawPkcs1PrivateKeyMaterial(app.appPrivatePkcsKey)
  };
}

function readKeyMaterialFromValue(value, kind) {
  const raw = String(value || '').trim();
  if (raw.includes('BEGIN ')) return raw;
  const compact = raw.replace(/\s+/g, '');
  const header = kind === 'private' ? 'RSA PRIVATE KEY' : 'PUBLIC KEY';
  return `-----BEGIN ${header}-----\n${compact.match(/.{1,64}/g).join('\n')}\n-----END ${header}-----`;
}

function loadConfig() {
  const environment = String(process.env.ALIPAY_ENV || 'sandbox').trim();
  if (!['sandbox', 'production'].includes(environment)) throw new Error('ALIPAY_ENV 必须为 sandbox 或 production');
  const mode = String(process.env.PAYMENT_MODE || (environment === 'production' ? 'alipay_production' : 'alipay_sandbox')).trim();
  const expectedMode = environment === 'production' ? 'alipay_production' : 'alipay_sandbox';
  if (mode !== expectedMode) throw new Error(`当前环境要求 PAYMENT_MODE=${expectedMode}`);
  if (process.env.ALIPAY_CONFIG_SOURCE === 'sandbox_file') {
    if (environment !== 'sandbox') throw new Error('官方临时沙箱配置不能用于 production');
    const official = readOfficialSandboxConfig();
    return {
      mode,
      ...official,
      amount: '0.01',
      serviceId: SANDBOX_SERVICE_ID,
      gateway: process.env.ALIPAY_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
    };
  }
  const privateKeyFile = required('ALIPAY_APP_PRIVATE_KEY_FILE');
  const publicKeyFile = required('ALIPAY_PUBLIC_KEY_FILE');
  const appId = required('ALIPAY_APP_ID');
  const sellerId = required('ALIPAY_SELLER_ID');
  const serviceId = required('ALIPAY_SERVICE_ID');
  if (environment === 'sandbox' && serviceId !== SANDBOX_SERVICE_ID) throw new Error('沙箱 ALIPAY_SERVICE_ID 必须为 api_mock_service_id');
  if (environment === 'production' && serviceId === SANDBOX_SERVICE_ID) throw new Error('production 禁止使用 api_mock_service_id');
  const amount = String(process.env.ALIPAY_UNIT_PRICE_CNY || '0.01');
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error('ALIPAY_UNIT_PRICE_CNY 必须为正数金额');
  const resourceFile = String(process.env.RESOURCE_FILE || '').trim();
  if (resourceFile && (!fs.existsSync(path.resolve(resourceFile)) || !fs.statSync(path.resolve(resourceFile)).isFile())) {
    throw new Error(`RESOURCE_FILE 不存在或不是普通文件：${resourceFile}`);
  }
  return {
    mode,
    environment,
    appId,
    sellerId,
    amount,
    serviceId,
    resourceFile: resourceFile ? path.resolve(resourceFile) : '',
    gateway: process.env.ALIPAY_GATEWAY || (environment === 'production' ? 'https://openapi.alipay.com/gateway.do' : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'),
    privateKeyFile: path.resolve(privateKeyFile),
    publicKeyFile: path.resolve(publicKeyFile),
    privateKey: readKeyMaterial(privateKeyFile, 'private'),
    publicKey: readKeyMaterial(publicKeyFile, 'public'),
    signingKey: rawPkcs1PrivateKey(privateKeyFile)
  };
}

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function writeOrders(orders) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temp = `${ORDERS_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(orders, null, 2), { mode: 0o600 });
  fs.renameSync(temp, ORDERS_FILE);
  try { fs.chmodSync(ORDERS_FILE, 0o600); } catch {}
}

const orderRepository = {
  createPending(order) {
    const orders = readOrders();
    if (!orders[order.outTradeNo]) {
      orders[order.outTradeNo] = order;
      writeOrders(orders);
    }
    return orders[order.outTradeNo];
  },
  findByOutTradeNo(outTradeNo) {
    return readOrders()[outTradeNo] || null;
  },
  prepareFulfillment({ outTradeNo, createResource }) {
    const orders = readOrders();
    const order = orders[outTradeNo];
    if (!order) return null;
    if (order.fulfillStatus === 'FULFILLED' || order.fulfillStatus === 'PENDING_CONFIRM') {
      return { state: order.fulfillStatus, serviceResult: order.serviceResult };
    }
    order.fulfillStatus = 'PENDING_CONFIRM';
    order.serviceResult = createResource();
    orders[outTradeNo] = order;
    writeOrders(orders);
    return { state: 'PENDING_CONFIRM', serviceResult: order.serviceResult };
  },
  markFulfilled(outTradeNo, tradeNo) {
    const orders = readOrders();
    if (!orders[outTradeNo]) return;
    orders[outTradeNo].fulfillStatus = 'FULFILLED';
    orders[outTradeNo].orderStatus = 'PAID';
    orders[outTradeNo].tradeNo = tradeNo;
    orders[outTradeNo].fulfilledAt = new Date().toISOString();
    writeOrders(orders);
  }
};

function b64url(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeB64url(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(value).length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function amount(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value || '').trim());
  if (!match) return null;
  return `${BigInt(match[1]).toString()}.${(match[2] || '').padEnd(2, '0')}`;
}

function formatPayBefore() {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+08:00`;
}

function signBill(config, fields) {
  const content = Object.keys(fields).sort().filter((key) => fields[key] !== '').map((key) => `${key}=${fields[key]}`).join('&');
  return crypto.createSign('RSA-SHA256').update(content, 'utf8').sign(config.signingKey, 'base64');
}

function createSdk(config) {
  return new AlipaySdk({
    appId: config.appId,
    privateKey: config.privateKey,
    alipayPublicKey: config.publicKey,
    gateway: config.gateway,
    timeout: 30000
  });
}

function createPaymentNeeded(config, order) {
  const signature = signBill(config, {
    amount: order.amount,
    currency: order.currency,
    goods_name: order.goodsName,
    out_trade_no: order.outTradeNo,
    pay_before: order.payBefore,
    resource_id: order.resourceId,
    seller_id: config.sellerId,
    service_id: config.serviceId
  });
  return {
    protocol: {
      out_trade_no: order.outTradeNo,
      amount: order.amount,
      currency: order.currency,
      resource_id: order.resourceId,
      pay_before: order.payBefore,
      seller_signature: signature,
      seller_sign_type: 'RSA2',
      seller_unique_id: config.sellerId
    },
    method: {
      seller_name: 'LawyerBuddy 沙箱演示',
      seller_id: config.sellerId,
      seller_app_id: config.appId,
      goods_name: order.goodsName,
      seller_unique_id_key: 'seller_id',
      service_id: config.serviceId
    }
  };
}

function generateResource(order) {
  return JSON.stringify({
    status: 'success',
    service_type: 'AI_CONTENT_GENERATION',
    resource_id: order.resourceId,
    content: 'LawyerBuddy 支付宝 AI 按量付费沙箱资源已交付。',
    generated_at: new Date().toISOString()
  });
}

async function verifyProof(config, sdk, proof) {
  let parsed;
  try { parsed = decodeB64url(proof); } catch { return null; }
  const protocol = parsed && parsed.protocol;
  const method = parsed && parsed.method;
  if (!protocol?.payment_proof || !protocol?.trade_no) return null;
  const verifyRequest = {
    bizContent: { payment_proof: protocol.payment_proof, trade_no: protocol.trade_no, ...(method?.client_session ? { client_session: method.client_session } : {}) }
  };
  let response;
  try {
    response = await sdk.exec('alipay.aipay.agent.payment.verify', verifyRequest);
  } catch (error) {
    if (!/status:\s*404/iu.test(String(error?.message || error))) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    response = await sdk.exec('alipay.aipay.agent.payment.verify', verifyRequest);
  }
  const data = response.alipay_aipay_agent_payment_verify_response || response;
  if (String(data.code) !== '10000') {
    console.error(`支付宝验付未通过：code=${data.code || ''}; sub_code=${data.sub_code || ''}; msg=${data.sub_msg || data.msg || ''}`);
    return null;
  }
  return {
    active: data.active === true,
    tradeNo: data.trade_no || data.tradeNo || protocol.trade_no,
    outTradeNo: data.out_trade_no || data.outTradeNo || '',
    amount: data.amount || '',
    resourceId: data.resource_id || data.resourceId || ''
  };
}

async function confirmFulfillment(config, sdk, tradeNo) {
  const response = await sdk.exec('alipay.aipay.agent.fulfillment.confirm', { bizContent: { trade_no: tradeNo } });
  const data = response.alipay_aipay_agent_fulfillment_confirm_response || response;
  return String(data.code) === '10000';
}

function createApp() {
  const config = loadConfig();
  const sdk = createSdk(config);
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true, mode: config.mode, environment: config.environment, service_id: config.serviceId }));
  function deliverResource(res, order, fulfillment, verified, alreadyFulfilled) {
    if (config.resourceFile) {
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="lawyerbuddy-paid.zip"');
      res.set('Payment-Validation', b64url(JSON.stringify({ trade_no: verified.tradeNo, out_trade_no: order.outTradeNo, validated: true, resource_id: order.resourceId })));
      return res.sendFile(config.resourceFile);
    }
    res.set('Payment-Validation', b64url(JSON.stringify({ trade_no: verified.tradeNo, out_trade_no: order.outTradeNo, validated: true, resource_id: order.resourceId })));
    return res.json({ resource_id: order.resourceId, content: fulfillment.serviceResult, trade_no: verified.tradeNo, out_trade_no: order.outTradeNo, fulfillment_confirmed: true, already_fulfilled: alreadyFulfilled });
  }
  app.get(['/demo/a2m/resource', '/v1/skill/download'], async (req, res) => {
    try {
      const proof = String(req.header('Payment-Proof') || '').trim();
      if (!proof) {
        const outTradeNo = `ORDER_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const order = {
          outTradeNo,
          amount: config.amount,
          currency: 'CNY',
          resourceId: req.path,
          goodsName: 'LawyerBuddy AI 案件资源演示',
          payBefore: formatPayBefore(),
          orderStatus: 'PENDING_PAYMENT',
          fulfillStatus: 'UNFULFILLED'
        };
        orderRepository.createPending(order);
        const bill = createPaymentNeeded(config, order);
        res.set('Payment-Needed', b64url(JSON.stringify(bill)));
        return res.status(402).json({ code: 'Payment-Needed', out_trade_no: order.outTradeNo, amount: order.amount, currency: order.currency, goods_name: order.goodsName });
      }

      const verified = await verifyProof(config, sdk, proof);
      const order = verified?.outTradeNo ? orderRepository.findByOutTradeNo(verified.outTradeNo) : null;
      if (!order || !verified || !verified.active || verified.outTradeNo !== order.outTradeNo
        || (verified.resourceId && verified.resourceId !== order.resourceId)
        || (verified.amount && amount(verified.amount) !== amount(order.amount))) {
        return res.status(402).json({ code: 'PAYMENT_REQUIRED', message: 'Payment-Proof 验证失败' });
      }
      const fulfillment = orderRepository.prepareFulfillment({ outTradeNo: order.outTradeNo, createResource: () => generateResource(order) });
      if (!fulfillment) return res.status(402).json({ code: 'ORDER_NOT_FOUND' });
      if (fulfillment.state === 'FULFILLED') {
        return deliverResource(res, order, fulfillment, verified, true);
      }
      if (!(await confirmFulfillment(config, sdk, verified.tradeNo))) return res.status(502).json({ code: 'FULFILLMENT_CONFIRM_FAILED', message: '履约确认失败，请用同一 Payment-Proof 重试' });
      orderRepository.markFulfilled(order.outTradeNo, verified.tradeNo);
      return deliverResource(res, order, fulfillment, verified, false);
    } catch (error) {
      console.error(`支付接口错误：${error.message}`);
      return res.status(500).json({ code: 'INTEGRATION_ERROR', message: '沙箱支付接口暂不可用' });
    }
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();
  app.listen(port, '127.0.0.1', () => console.log(`LawyerBuddy A2M ${process.env.ALIPAY_ENV || 'sandbox'} service: http://127.0.0.1:${port}/demo/a2m/resource`));
}

module.exports = { createApp, orderRepository, loadConfig };
