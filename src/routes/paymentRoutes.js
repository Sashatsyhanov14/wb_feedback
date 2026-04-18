const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const config = require('../config');
const supabase = require('../db/supabase');
const telegramService = require('../services/telegramService');

// 1. Create Payment URL
router.post('/create', async (req, res) => {
  try {
    const { telegramChatId, amount = 749 } = req.body;
    
    if (!telegramChatId) return res.status(400).json({ error: 'Missing telegramChatId' });

    const invId = Date.now(); // Unique ID for this transaction
    const mLogin = config.robokassaMerchantLogin;
    const p1 = config.robokassaPassword1;
    const isTest = config.robokassaIsTest ? 1 : 0;
    
    // shp_userId is a custom parameter defined by Robokassa to track the user
    const signature = crypto.createHash('md5')
      .update(`${mLogin}:${amount}:${invId}:${p1}:shp_userId=${telegramChatId}`)
      .digest('hex');

    const url = `https://auth.robokassa.ru/Merchant/Index.aspx?` + 
      `MerchantLogin=${mLogin}` +
      `&OutSum=${amount}` +
      `&InvId=${invId}` +
      `&Description=${encodeURIComponent('Подписка WBReply AI - 30 дней')}` +
      `&SignatureValue=${signature}` +
      `&shp_userId=${telegramChatId}` +
      (isTest ? `&IsTest=1` : '');

    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Result URL (Callback from Robokassa)
// Robokassa calls this URL when payment is successful
router.post('/robokassa/result', async (req, res) => {
  try {
    const { OutSum, InvId, SignatureValue, shp_userId } = req.body;
    const p2 = config.robokassaPassword2;

    // Verify Signature
    const mySignature = crypto.createHash('md5')
      .update(`${OutSum}:${InvId}:${p2}:shp_userId=${shp_userId}`)
      .digest('hex')
      .toUpperCase();

    if (SignatureValue.toUpperCase() !== mySignature) {
      console.error('[Robokassa] Invalid signature received');
      return res.send('error:bad signature');
    }

    console.log(`[Robokassa] Payment success for user ${shp_userId}. Amount: ${OutSum}`);

    // Update Subscription in Supabase
    const { data: seller, error: sellerError } = await supabase
      .from('sellers')
      .select('subscription_expires_at')
      .eq('telegram_chat_id', shp_userId)
      .single();

    if (!sellerError) {
      const currentExpiry = seller.subscription_expires_at ? new Date(seller.subscription_expires_at) : new Date();
      const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
      const newExpiry = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await supabase
        .from('sellers')
        .update({ 
          subscription_status: 'premium', 
          subscription_expires_at: newExpiry 
        })
        .eq('telegram_chat_id', shp_userId);

      // Notify User
      await telegramService.sendMessage(shp_userId, `🎉 <b>Оплата прошла успешно!</b>\nВаша подписка продлена до <b>${new Date(newExpiry).toLocaleDateString()}</b>. Спасибо, что вы с нами! 🚀`);
      
      // Notify Admin
      await telegramService.sendMessage(config.adminId, `💰 <b>Поступление оплаты!</b>\nЮзер: <code>${shp_userId}</code>\nСумма: ${OutSum} руб.`);
    }

    res.send(`OK${InvId}`); // Robokassa requirement
  } catch (error) {
    console.error('[Robokassa] Error:', error);
    res.status(500).send('error');
  }
});

module.exports = router;
