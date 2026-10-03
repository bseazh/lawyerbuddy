const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const source = String(process.env.ALIPAY_CONFIG_SOURCE || 'files').trim();
const required = ['ALIPAY_ENV'];
if (source !== 'sandbox_file') {
  required.push('ALIPAY_APP_ID', 'ALIPAY_APP_PRIVATE_KEY_FILE', 'ALIPAY_PUBLIC_KEY_FILE', 'ALIPAY_SELLER_ID');
}
const missing = required.filter((name) => !String(process.env[name] || '').trim());
if (missing.length) {
  console.error(`缺少配置：${missing.join('、')}`);
  if (missing.includes('ALIPAY_SELLER_ID')) {
    console.error('请在支付宝开放平台的沙箱应用/商家信息中复制与当前 AppID 对应的商家 PID（通常为 2088 开头），写入 .env 的 ALIPAY_SELLER_ID。');
    console.error('注意：不能把 AppID（2021 开头）当作商家 PID。');
    console.error('帮助链接：https://open.alipay.com/');
  }
  process.exit(1);
}
const environment = String(process.env.ALIPAY_ENV || '').trim();
if (!['sandbox', 'production'].includes(environment)) {
  console.error('ALIPAY_ENV 必须为 sandbox 或 production');
  process.exit(1);
}
if (source !== 'sandbox_file') required.push('ALIPAY_SERVICE_ID');
const serviceId = String(process.env.ALIPAY_SERVICE_ID || '').trim();
if (environment === 'sandbox' && serviceId && serviceId !== 'api_mock_service_id') {
  console.error('沙箱 ALIPAY_SERVICE_ID 必须为 api_mock_service_id');
  process.exit(1);
}
if (environment === 'production' && (!serviceId || serviceId === 'api_mock_service_id')) {
  console.error('production 必须配置正式 ALIPAY_SERVICE_ID，不能使用 api_mock_service_id');
  process.exit(1);
}
if (source !== 'sandbox_file' && !/^2088\d+$/.test(String(process.env.ALIPAY_SELLER_ID || '').trim())) {
  console.error('ALIPAY_SELLER_ID 格式不正确：请填写与当前 AppID 对应的 2088 开头商家 PID，不要填写 AppID。');
  process.exit(1);
}
if (source === 'sandbox_file') {
  const sandboxConfig = path.join(__dirname, '.alipay-sandbox.json');
  try {
    const data = JSON.parse(fs.readFileSync(sandboxConfig, 'utf8'));
    if (!data?.appIds?.[0]?.appId || !data?.sandboxAccounts?.partner?.userId) throw new Error('sandbox config incomplete');
  } catch {
    console.error('官方沙箱配置不存在或不完整：请先运行支付宝官方沙箱准备流程');
    process.exit(1);
  }
} else {
  for (const name of ['ALIPAY_APP_PRIVATE_KEY_FILE', 'ALIPAY_PUBLIC_KEY_FILE']) {
    const file = path.resolve(process.env[name]);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      console.error(`${name} 文件不存在或不是普通文件`);
      process.exit(1);
    }
  }
}
const licenseSecretFile = String(process.env.LICENSE_SIGNING_SECRET_FILE || '').trim();
if (licenseSecretFile) {
  const resolvedSecret = path.resolve(licenseSecretFile);
  if (!fs.existsSync(resolvedSecret) || !fs.statSync(resolvedSecret).isFile()) {
    console.error('LICENSE_SIGNING_SECRET_FILE 文件不存在或不是普通文件');
    process.exit(1);
  }
  if (fs.readFileSync(resolvedSecret, 'utf8').trim().length < 32) {
    console.error('LICENSE_SIGNING_SECRET_FILE 至少需要 32 个字符');
    process.exit(1);
  }
}
console.log(JSON.stringify({
  ready: true,
  environment,
  appId: source === 'sandbox_file' ? 'official sandbox config' : process.env.ALIPAY_APP_ID,
  gateway: process.env.ALIPAY_GATEWAY || (environment === 'production' ? 'https://openapi.alipay.com/gateway.do' : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'),
  serviceId: source === 'sandbox_file' ? 'api_mock_service_id' : serviceId,
  unitPriceCny: process.env.ALIPAY_UNIT_PRICE_CNY || '0.01',
  configSource: source,
  activationEndpoint: '/v1/license/activate',
  licenseSigningSecretPath: licenseSecretFile ? path.resolve(licenseSecretFile) : 'data/license-signing-secret（首次启动自动生成）',
  privateKeyPath: source === 'sandbox_file' ? 'official sandbox config' : path.resolve(process.env.ALIPAY_APP_PRIVATE_KEY_FILE),
  publicKeyPath: source === 'sandbox_file' ? 'official sandbox config' : path.resolve(process.env.ALIPAY_PUBLIC_KEY_FILE),
  sellerIdSource: source === 'sandbox_file' ? 'official sandbox config' : 'environment'
}, null, 2));
