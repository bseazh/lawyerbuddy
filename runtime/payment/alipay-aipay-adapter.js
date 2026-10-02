'use strict';

// SkillHub 可执行付费适配层。密钥、订单数据和资源文件由部署环境注入。
// 业务服务可调用 createPaymentGate()，不要把私钥写入 Skill 包。
const crypto = require('node:crypto');

function createPaymentGate({ amount = '0.01', resourceId = 'lawyerbuddy-paid', verifyPaymentProof, confirmFulfillment, store }) {
  if (typeof verifyPaymentProof !== 'function' || typeof confirmFulfillment !== 'function' || !store) {
    throw new TypeError('必须提供验付、履约确认和订单持久化实现');
  }
  return {
    async probe(req, res) {
      const proof = String(req.headers['payment-proof'] || '').trim();
      if (!proof) {
        const order = await store.createPending({
          out_trade_no: `LB_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
          amount, resource_id: resourceId, status: 'PAYMENT_REQUIRED'
        });
        res.setHeader('Payment-Needed', Buffer.from(JSON.stringify({ out_trade_no: order.out_trade_no, amount, resource_id: resourceId })).toString('base64url'));
        return res.status(402).json({ code: 'Payment-Needed', out_trade_no: order.out_trade_no, amount, resource_id: resourceId });
      }
      return this.pay(req, res, proof);
    },
    async pay(req, res, proof) {
      const verified = await verifyPaymentProof(proof, { amount, resourceId });
      if (!verified || !verified.valid) return res.status(402).json({ code: 'PAYMENT_REQUIRED', message: 'Payment-Proof 验证失败' });
      const order = await store.find(verified.out_trade_no);
      if (!order || order.amount !== amount || order.resource_id !== resourceId) return res.status(402).json({ code: 'ORDER_NOT_FOUND' });
      if (order.status === 'FULFILLED') return this.ack(req, res, order, verified, true);
      if (!(await confirmFulfillment(verified.trade_no, order))) return res.status(502).json({ code: 'FULFILLMENT_CONFIRM_FAILED' });
      await store.markFulfilled(order.out_trade_no, verified.trade_no);
      return this.complete(req, res, order, verified, false);
    },
    async complete(req, res, order, verified, alreadyFulfilled) {
      const result = await store.resource(order.resource_id);
      if (!result) return res.status(502).json({ code: 'RESOURCE_NOT_READY' });
      return this.ack(req, res, order, verified, alreadyFulfilled, result);
    },
    async ack(req, res, order, verified, alreadyFulfilled, result) {
      res.setHeader('Payment-Validation', Buffer.from(JSON.stringify({ out_trade_no: order.out_trade_no, trade_no: verified.trade_no, validated: true })).toString('base64url'));
      return res.status(200).json({ resource_id: order.resource_id, trade_no: verified.trade_no, fulfillment_confirmed: true, already_fulfilled: alreadyFulfilled, result });
    }
  };
}

module.exports = { createPaymentGate };
