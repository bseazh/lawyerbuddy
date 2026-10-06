const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { AlipaySdk } = require('alipay-sdk');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.LAWYERBUDDY_DATA_DIR || path.join(ROOT, 'data'));
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');
const SANDBOX_SERVICE_ID = 'api_mock_service_id';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function readSecretFile(file) {
  const location = path.resolve(file);
  const secret = fs.readFileSync(location, 'utf8').trim();
  if (secret.length < 32) throw new Error(`授权签名密钥过短：${location}`);
  return secret;
}

function loadLicenseSigningSecret() {
  const configured = String(process.env.LICENSE_SIGNING_SECRET_FILE || '').trim();
  const location = path.resolve(configured || path.join(DATA_DIR, 'license-signing-secret'));
  if (!fs.existsSync(location)) {
    fs.mkdirSync(path.dirname(location), { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(location, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  try { fs.chmodSync(location, 0o600); } catch {}
  return { secret: readSecretFile(location), file: location };
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
  const licenseSigning = loadLicenseSigningSecret();
  const lawyerbuddyVersion = String(process.env.LAWYERBUDDY_VERSION || '1.9.3').trim();
  if (process.env.ALIPAY_CONFIG_SOURCE === 'sandbox_file') {
    if (environment !== 'sandbox') throw new Error('官方临时沙箱配置不能用于 production');
    const official = readOfficialSandboxConfig();
    return {
      mode,
      environment,
      ...official,
      amount: '0.01',
      serviceId: SANDBOX_SERVICE_ID,
      gateway: process.env.ALIPAY_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
      licenseSigningSecret: licenseSigning.secret,
      licenseSigningSecretFile: licenseSigning.file,
      lawyerbuddyVersion
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
  return {
    mode,
    environment,
    appId,
    sellerId,
    amount,
    serviceId,
    gateway: process.env.ALIPAY_GATEWAY || (environment === 'production' ? 'https://openapi.alipay.com/gateway.do' : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'),
    privateKeyFile: path.resolve(privateKeyFile),
    publicKeyFile: path.resolve(publicKeyFile),
    privateKey: readKeyMaterial(privateKeyFile, 'private'),
    publicKey: readKeyMaterial(publicKeyFile, 'public'),
    signingKey: rawPkcs1PrivateKey(privateKeyFile),
    licenseSigningSecret: licenseSigning.secret,
    licenseSigningSecretFile: licenseSigning.file,
    lawyerbuddyVersion
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

function readLicenses() {
  try {
    return JSON.parse(fs.readFileSync(LICENSES_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function writeLicenses(licenses) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temp = `${LICENSES_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(licenses, null, 2), { mode: 0o600 });
  fs.renameSync(temp, LICENSES_FILE);
  try { fs.chmodSync(LICENSES_FILE, 0o600); } catch {}
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

const licenseRepository = {
  findById(licenseId) {
    return readLicenses()[licenseId] || null;
  },
  findByOrder(outTradeNo) {
    return Object.values(readLicenses()).find((license) => license.outTradeNo === outTradeNo) || null;
  },
  create(license) {
    const licenses = readLicenses();
    if (!licenses[license.licenseId]) {
      licenses[license.licenseId] = license;
      writeLicenses(licenses);
    }
    return licenses[license.licenseId];
  }
};

function b64url(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlBuffer(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRequest(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function activationRequest(req, config) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const clientId = String(body.client_id || req.header('X-Client-Id') || '').trim();
  const skillVersion = String(body.skill_version || config.lawyerbuddyVersion).trim();
  const features = Array.isArray(body.features)
    ? [...new Set(body.features.map((feature) => String(feature).trim()).filter(Boolean))].sort()
    : [];
  if (!clientId || clientId.length > 200) return { error: 'client_id 必须为 1—200 个字符' };
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(skillVersion)) return { error: 'skill_version 格式不正确' };
  if (features.length > 32 || features.some((feature) => feature.length > 80)) return { error: 'features 数量或长度超出限制' };
  return { value: { clientId, skillVersion, features } };
}

function requestedOutTradeNo(req) {
  const value = String(req.header('X-Out-Trade-No') || req.body?.out_trade_no || '').trim();
  if (value && !/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/.test(value)) return { error: 'out_trade_no 格式不正确' };
  return { value };
}

function licenseToken(config, license) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'LB-LICENSE' }));
  const payload = b64url(JSON.stringify({
    iss: 'lawyerbuddy',
    sub: license.licenseId,
    client_id: license.clientId,
    skill_version: license.skillVersion,
    features: license.features,
    activated_at: license.activatedAt,
    expires_at: license.expiresAt
  }));
  const content = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', config.licenseSigningSecret).update(content).digest();
  return `${content}.${b64urlBuffer(signature)}`;
}

function signedToken(config, type, payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: type }));
  const body = b64url(JSON.stringify(payload));
  const content = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', config.licenseSigningSecret).update(content).digest();
  return `${content}.${b64urlBuffer(signature)}`;
}

function parseSignedToken(config, token, expectedType) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const content = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', config.licenseSigningSecret).update(content).digest();
  let actual;
  try {
    const padded = parts[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parts[2].length % 4)) % 4);
    actual = Buffer.from(padded, 'base64');
  } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const paddedHeader = parts[0].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parts[0].length % 4)) % 4);
    const paddedPayload = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const header = JSON.parse(Buffer.from(paddedHeader, 'base64').toString('utf8'));
    if (header.typ !== expectedType) return null;
    return JSON.parse(Buffer.from(paddedPayload, 'base64').toString('utf8'));
  } catch { return null; }
}

function parseLicenseToken(config, token) {
  return parseSignedToken(config, token, 'LB-LICENSE');
}

function createSessionToken(config, license) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  return {
    token: signedToken(config, 'LB-SESSION', {
      iss: 'lawyerbuddy',
      sub: license.licenseId,
      client_id: license.clientId,
      iat: issuedAt,
      exp: expiresAt,
      nonce: crypto.randomUUID()
    }),
    issuedAt,
    expiresAt
  };
}

function authorizedLicense(config, req) {
  const authorization = String(req.header('Authorization') || '');
  const token = String(req.body?.license_token || (authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '')).trim();
  const payload = parseLicenseToken(config, token);
  const license = payload?.sub ? licenseRepository.findById(payload.sub) : null;
  if (!license || license.licenseToken !== token) return null;
  return license;
}

function createLicense(config, order) {
  const existing = licenseRepository.findByOrder(order.outTradeNo);
  if (existing) return existing;
  const activatedAt = new Date().toISOString();
  const license = {
    licenseId: `LB-LICENSE-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    outTradeNo: order.outTradeNo,
    clientId: order.activation.clientId,
    skillVersion: order.activation.skillVersion,
    features: order.activation.features,
    activatedAt,
    expiresAt: null
  };
  license.licenseToken = licenseToken(config, license);
  return licenseRepository.create(license);
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
      seller_name: 'LawyerBuddy 授权服务',
      seller_id: config.sellerId,
      seller_app_id: config.appId,
      goods_name: order.goodsName,
      seller_unique_id_key: 'seller_id',
      service_id: config.serviceId
    }
  };
}

async function verifyProof(config, sdk, proof, expectedOutTradeNo = '') {
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
    active: data.active === true || data.active === 'true',
    tradeNo: data.trade_no || data.tradeNo || protocol.trade_no,
    outTradeNo: data.out_trade_no || data.outTradeNo || expectedOutTradeNo || '',
    amount: data.amount || '',
    resourceId: data.resource_id || data.resourceId || ''
  };
}

async function confirmFulfillment(config, sdk, tradeNo) {
  const response = await sdk.exec('alipay.aipay.agent.fulfillment.confirm', { bizContent: { trade_no: tradeNo } });
  const data = response.alipay_aipay_agent_fulfillment_confirm_response || response;
  return String(data.code) === '10000';
}

function createApp(options = {}) {
  const config = loadConfig();
  const sdk = options.sdk || createSdk(config);
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) => res.json({
    ok: true,
    mode: config.mode,
    environment: config.environment,
    service_id: config.serviceId,
    activation_endpoint: '/v1/license/activate',
    session_endpoint: '/v1/license/session',
    session_status_endpoint: '/v1/license/session/status',
    session_ttl_seconds: SESSION_TTL_SECONDS,
    download_endpoint: 'disabled'
  }));

  function deliverLicense(res, order, fulfillment, verified, alreadyActivated) {
    const license = fulfillment.serviceResult || licenseRepository.findByOrder(order.outTradeNo);
    if (!license?.licenseToken) return res.status(500).json({ code: 'LICENSE_NOT_CREATED', message: '授权结果未生成，请使用同一订单重试' });
    res.set('Payment-Validation', b64url(JSON.stringify({
      trade_no: verified.tradeNo,
      out_trade_no: order.outTradeNo,
      validated: true,
      fulfilled: true,
      resource_id: order.resourceId
    })));
    return res.json({
      license_id: license.licenseId,
      license_token: license.licenseToken,
      skill_version: license.skillVersion,
      features: license.features,
      activated_at: license.activatedAt,
      expires_at: license.expiresAt,
      client_id: license.clientId,
      out_trade_no: order.outTradeNo,
      trade_no: verified.tradeNo,
      fulfillment_confirmed: true,
      already_activated: alreadyActivated
    });
  }

  app.post('/v1/license/activate', async (req, res) => {
    try {
      const activation = activationRequest(req, config);
      if (activation.error) return res.status(400).json({ code: 'INVALID_REQUEST', message: activation.error });
      const requestValue = activation.value;
      const requestHash = hashRequest(requestValue);
      const requestedOrder = requestedOutTradeNo(req);
      if (requestedOrder.error) return res.status(400).json({ code: 'INVALID_ORDER_NO', message: requestedOrder.error });
      const proof = String(req.header('Payment-Proof') || '').trim();
      if (!proof) {
        const requestedOrderNo = requestedOrder.value;
        let order = requestedOrderNo ? orderRepository.findByOutTradeNo(requestedOrderNo) : null;
        if (order && order.requestHash !== requestHash) {
          return res.status(409).json({ code: 'ORDER_REQUEST_MISMATCH', message: '订单已绑定其他授权请求' });
        }
        if (!order) {
          const outTradeNo = requestedOrderNo || `ORDER_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
          order = orderRepository.createPending({
            outTradeNo,
            amount: config.amount,
            currency: 'CNY',
            resourceId: `lawyerbuddy-license-${requestValue.skillVersion}`,
            goodsName: 'LawyerBuddy 本地版授权激活',
            payBefore: formatPayBefore(),
            orderStatus: 'PENDING_PAYMENT',
            fulfillStatus: 'UNFULFILLED',
            requestHash,
            activation: requestValue
          });
        }
        const bill = createPaymentNeeded(config, order);
        res.set('Payment-Needed', b64url(JSON.stringify(bill)));
        return res.status(402).json({
          code: 'Payment-Needed',
          out_trade_no: order.outTradeNo,
          amount: order.amount,
          currency: order.currency,
          goods_name: order.goodsName,
          resource_id: order.resourceId,
          activation: requestValue
        });
      }

      const verified = await verifyProof(config, sdk, proof, requestedOrder.value);
      const order = verified?.outTradeNo ? orderRepository.findByOutTradeNo(verified.outTradeNo) : null;
      if (!order || !verified || !verified.active || verified.outTradeNo !== order.outTradeNo
        || order.requestHash !== requestHash
        || (verified.resourceId && verified.resourceId !== order.resourceId)
        || (verified.amount && amount(verified.amount) !== amount(order.amount))) {
        return res.status(402).json({ code: 'PAYMENT_REQUIRED', message: 'Payment-Proof 验证失败' });
      }
      const fulfillment = orderRepository.prepareFulfillment({ outTradeNo: order.outTradeNo, createResource: () => createLicense(config, order) });
      if (!fulfillment) return res.status(402).json({ code: 'ORDER_NOT_FOUND' });
      if (fulfillment.state === 'FULFILLED') {
        return deliverLicense(res, order, fulfillment, verified, true);
      }
      if (!(await confirmFulfillment(config, sdk, verified.tradeNo))) return res.status(502).json({ code: 'FULFILLMENT_CONFIRM_FAILED', message: '履约确认失败，请用同一 Payment-Proof 重试' });
      orderRepository.markFulfilled(order.outTradeNo, verified.tradeNo);
      return deliverLicense(res, order, fulfillment, verified, false);
    } catch (error) {
      console.error(`支付接口错误：${error.message}`);
      return res.status(500).json({ code: 'INTEGRATION_ERROR', message: '授权接口暂不可用' });
    }
  });

  app.post('/v1/license/status', (req, res) => {
    const license = authorizedLicense(config, req);
    if (!license) return res.status(401).json({ code: 'LICENSE_INVALID', message: '授权令牌无效' });
    return res.json({
      active: true,
      license_id: license.licenseId,
      skill_version: license.skillVersion,
      features: license.features,
      activated_at: license.activatedAt,
      expires_at: license.expiresAt,
      client_id: license.clientId
    });
  });

  app.post('/v1/license/session', (req, res) => {
    const license = authorizedLicense(config, req);
    if (!license) return res.status(401).json({ code: 'LICENSE_INVALID', message: '请先完成永久授权激活' });
    const clientId = String(req.body?.client_id || req.header('X-Client-Id') || '').trim();
    if (!clientId || clientId !== license.clientId) {
      return res.status(403).json({ code: 'CLIENT_MISMATCH', message: '授权与当前客户端不匹配' });
    }
    const session = createSessionToken(config, license);
    return res.json({
      active: true,
      session_token: session.token,
      issued_at: new Date(session.issuedAt * 1000).toISOString(),
      expires_at: new Date(session.expiresAt * 1000).toISOString(),
      ttl_seconds: SESSION_TTL_SECONDS,
      client_id: license.clientId
    });
  });

  app.post('/v1/license/session/status', (req, res) => {
    const authorization = String(req.header('Authorization') || '');
    const token = String(req.body?.session_token || (authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '')).trim();
    const payload = parseSignedToken(config, token, 'LB-SESSION');
    const clientId = String(req.body?.client_id || req.header('X-Client-Id') || '').trim();
    const now = Math.floor(Date.now() / 1000);
    const license = payload?.sub ? licenseRepository.findById(payload.sub) : null;
    if (!payload || !license || payload.client_id !== license.clientId || clientId !== license.clientId) {
      return res.status(401).json({ code: 'SESSION_INVALID', message: '会话授权无效' });
    }
    if (!Number.isInteger(payload.exp) || payload.exp <= now) {
      return res.status(401).json({ code: 'SESSION_EXPIRED', message: '会话授权已过期，请重新启动授权' });
    }
    return res.json({
      active: true,
      license_id: license.licenseId,
      client_id: license.clientId,
      expires_at: new Date(payload.exp * 1000).toISOString()
    });
  });

  app.get(['/demo/a2m/resource', '/v1/skill/download'], (_req, res) => res.status(410).json({
    code: 'DOWNLOAD_DISABLED',
    message: '服务器不再下载 Skill 代码。请使用公开本地包；如需授权，请调用 /v1/license/activate。'
  }));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();
  app.listen(port, '127.0.0.1', () => console.log(`LawyerBuddy license ${process.env.ALIPAY_ENV || 'sandbox'} service: http://127.0.0.1:${port}/v1/license/activate`));
}

module.exports = { createApp, orderRepository, licenseRepository, loadConfig };
