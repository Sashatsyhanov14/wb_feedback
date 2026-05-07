const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const supabase = require('../db/supabase');
const authMiddleware = require('../middleware/authMiddleware');

// Тарифные планы
const PRICING_TIERS = {
  1: { name: 'Тестовый', plan: 'starter', maxShops: 5 }, // Тестовый за 1 рубль
  3000: { name: 'Начинающий', plan: 'starter', maxShops: 5 },
  5000: { name: 'Агентство', plan: 'agency', maxShops: 20 },
  10000: { name: 'Корпорация', plan: 'corporation', maxShops: 999 },
};

// 1. Создание платежа (YooKassa)
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { amount } = req.body;

    // Validate tier
    const tier = PRICING_TIERS[amount];
    if (!tier) {
      return res.status(400).json({ error: 'Неверная сумма тарифа' });
    }

    // PROTECTION: Guest accounts must link a real identity before paying
    const { data: seller } = await supabase
      .from('sellers')
      .select('auth_provider')
      .eq('id', sellerId)
      .single();
    
    if (seller && seller.auth_provider === 'guest') {
      return res.status(403).json({ 
        error: 'Привяжите аккаунт (Google или VK) в разделе «Аккаунт» перед оплатой' 
      });
    }
    
    if (!config.yookassaShopId || !config.yookassaSecretKey) {
        throw new Error('YooKassa configuration is missing');
    }

    const idempotenceKey = crypto.randomUUID();
    const auth = Buffer.from(`${config.yookassaShopId}:${config.yookassaSecretKey}`).toString('base64');

    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: 'https://wbreplyai.ru/app#success'
      },
      description: `WBReply AI — тариф «${tier.name}» (30 дней)`,
      metadata: {
        sellerId: sellerId.toString(),
        plan: tier.plan,
        maxShops: tier.maxShops.toString(),
        amount: amount.toString()
      }
    };

    console.log(`[YooKassa] Creating payment: seller=${sellerId}, tier=${tier.name}, amount=${amount}₽`);

    const response = await axios.post('https://api.yookassa.ru/v3/payments', paymentData, {
      headers: {
        'Idempotence-Key': idempotenceKey,
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({ url: response.data.confirmation.confirmation_url });
  } catch (error) {
    console.error('[YooKassa] Create Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Ошибка при создании платежа' });
  }
});

// 2. Webhook (Обработка уведомлений от ЮKassa)
router.post('/yookassa/webhook', async (req, res) => {
  try {
    const event = req.body;
    
    // Проверяем тип события
    if (event.event !== 'payment.succeeded') {
        return res.sendStatus(200); // Игнорируем другие события
    }

    const payment = event.object;
    const sellerId = payment.metadata?.sellerId;
    const plan = payment.metadata?.plan || 'starter';
    const maxShops = parseInt(payment.metadata?.maxShops || '5', 10);
    const amount = payment.amount?.value;

    if (!sellerId) {
        console.error('[YooKassa Webhook] No sellerId in metadata');
        return res.sendStatus(200);
    }

    console.log(`[YooKassa Webhook] Payment succeeded: seller=${sellerId}, plan=${plan}, amount=${amount}₽`);

    // Продлеваем подписку в БД
    const { data: seller, error: sellerError } = await supabase
      .from('sellers')
      .select('subscription_expires_at')
      .eq('id', sellerId)
      .single();

    if (sellerError) {
        console.error('[YooKassa Webhook] Seller lookup error:', sellerError);
        return res.sendStatus(200);
    }

    const currentExpiry = seller.subscription_expires_at ? new Date(seller.subscription_expires_at) : new Date();
    const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from('sellers')
      .update({ 
        subscription_status: 'active', 
        subscription_plan: plan,
        max_shops: maxShops,
        subscription_expires_at: newExpiry 
      })
      .eq('id', sellerId);

    if (updateError) {
        console.error('[YooKassa Webhook] Update subscription error:', updateError);
        return res.sendStatus(500);
    }

    console.log(`[YooKassa Webhook] Subscription updated: plan=${plan}, maxShops=${maxShops}, expires=${newExpiry}`);
    res.sendStatus(200);
  } catch (error) {
    console.error('[YooKassa Webhook] Error:', error.message);
    res.status(500).send('error');
  }
});

module.exports = router;
