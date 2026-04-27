const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const supabase = require('../db/supabase');

// Helper to verify Telegram login hash
function verifyTelegramHash(data) {
  const { hash, ...userData } = data;
  const secretKey = crypto.createHash('sha256').update(config.telegramBotToken).digest();
  
  const checkString = Object.keys(userData)
    .sort()
    .map(key => `${key}=${userData[key]}`)
    .join('\n');
  
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  return hmac === hash;
}

// 1. Telegram Login Callback
router.post('/tg-callback', async (req, res) => {
  try {
    const userData = req.body;
    
    if (!verifyTelegramHash(userData)) {
      return res.status(401).json({ error: 'Invalid login data' });
    }

    const tgId = String(userData.id);

    // Upsert user in database
    let { data: seller, error } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', 'telegram')
      .eq('auth_provider_id', tgId)
      .maybeSingle();

    if (!seller) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3); // 3 days trial

      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({
          auth_provider: 'telegram',
          auth_provider_id: tgId,
          display_name: userData.first_name + (userData.last_name ? ' ' + userData.last_name : ''),
          avatar_url: userData.photo_url || null,
          subscription_status: 'trial',
          subscription_expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single();
        
      if (insertError) throw insertError;
      seller = newSeller;
    }

    // Login successful, issue JWT with sellerId
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    // Set secure cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Get Me (Check session)
const authMiddleware = require('../middleware/authMiddleware');
router.get('/me', authMiddleware, async (req, res) => {
  res.json({ sellerId: req.user.sellerId });
});

// 3. Logout
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

// 4. Demo Login (for development testing)
router.post('/demo', async (req, res) => {
    const testTgId = '795056847'; // Default test admin ID

    let { data: seller } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', 'telegram')
      .eq('auth_provider_id', testTgId)
      .maybeSingle();

    if (!seller) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      const { data: newSeller } = await supabase
        .from('sellers')
        .insert({
          auth_provider: 'telegram',
          auth_provider_id: testTgId,
          display_name: 'Demo Admin',
          subscription_status: 'premium',
          subscription_expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single();
      seller = newSeller;
    }

    const token = jwt.sign(
        { sellerId: seller.id },
        config.jwtSecret,
        { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true, sellerId: seller.id });
});

module.exports = router;
