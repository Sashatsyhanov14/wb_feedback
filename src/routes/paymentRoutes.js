const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const supabase = require('../db/supabase');
const telegramService = require('../services/telegramService');
const authMiddleware = require('../middleware/authMiddleware');

const SUBSCRIPTION_PRICE = 749; // Фиксированная цена

// 1. Создание платежа (YooKassa)
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    
    if (!config.yookassaShopId || !config.yookassaSecretKey) {
        throw new Error('YooKassa configuration is missing');
    }

    const idempotenceKey = crypto.randomUUID();
    const auth = Buffer.from(`${config.yookassaShopId}:${config.yookassaSecretKey}`).toString('base64');

    const paymentData = {
      amount: {
        value: SUBSCRIPTION_PRICE.toFixed(2),
        currency: 'RUB'
      },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: 'https://wbreplyai.ru/app#success'
      },
      description: `Подписка WBREPLY AI - 30 дней`,
      metadata: {
        sellerId: sellerId.toString()
      }
    };

    console.log(`[YooKassa] Creating payment for seller: ${sellerId}`);

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
    const amount = payment.amount?.value;

    if (!sellerId) {
        console.error('[YooKassa Webhook] No sellerId in metadata');
        return res.sendStatus(200);
    }

    console.log(`[YooKassa Webhook] Payment succeeded for seller ${sellerId}. Amount: ${amount}`);

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
        subscription_status: 'premium', 
        subscription_expires_at: newExpiry 
      })
      .eq('id', sellerId);

    if (updateError) {
        console.error('[YooKassa Webhook] Update subscription error:', updateError);
        return res.sendStatus(500);
    }

    // Уведомляем админа
    if (config.adminId) {
      await telegramService.sendMessage(config.adminId, `💰 <b>Оплата ЮKassa!</b>\nЮзер: <code>${sellerId}</code>\nСумма: ${amount} руб.`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[YooKassa Webhook] Error:', error.message);
    res.status(500).send('error');
  }
});

module.exports = router;
