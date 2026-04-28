const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const supabase = require('../db/supabase');
const axios = require('axios');

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
      httpOnly: false,
      secure: config.nodeEnv === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1.b. Telegram Login Callback (GET - for bot login_url)
router.get('/tg-callback', async (req, res) => {
  try {
    const userData = req.query;
    
    if (!verifyTelegramHash(userData)) {
      return res.redirect('/login?error=invalid_tg_hash');
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
      expiresAt.setDate(expiresAt.getDate() + 3);

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

    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: config.nodeEnv === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.redirect('/');
  } catch (error) {
    console.error('TG Auth Error:', error.message);
    res.redirect('/login?error=tg_auth_failed');
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
        httpOnly: false,
        secure: config.nodeEnv === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true, sellerId: seller.id });
});

// 5. Google Login
// Redirect to Google OAuth
router.get('/google', (req, res) => {
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: config.googleRedirectUri,
    client_id: config.googleClientId,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
  };

  const qs = new URLSearchParams(options);
  res.redirect(`${rootUrl}?${qs.toString()}`);
});

// Google OAuth Callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code;

  try {
    // Exchange code for tokens
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: 'authorization_code',
    });

    const { id_token, access_token } = data;

    // Get user profile
    const { data: profile } = await axios.get(
      `https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token=${access_token}`,
      {
        headers: { Authorization: `Bearer ${id_token}` },
      }
    );

    // Upsert user in sellers table
    let { data: seller, error: findError } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', 'google')
      .eq('auth_provider_id', profile.id)
      .maybeSingle();

    if (!seller) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);

      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({
          auth_provider: 'google',
          auth_provider_id: profile.id,
          email: profile.email,
          display_name: profile.name,
          avatar_url: profile.picture,
          subscription_status: 'trial',
          subscription_expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single();
      
      if (insertError) throw insertError;
      seller = newSeller;
    }

    // Issue JWT
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: config.nodeEnv === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    // Redirect to dashboard
    res.redirect('/');
  } catch (error) {
    console.error('Google Auth Error:', error.response?.data || error.message);
    res.redirect('/login?error=google_auth_failed');
  }
});

// 6. VK Login
router.get('/vk', (req, res) => {
  const rootUrl = 'https://oauth.vk.com/authorize';
  const options = {
    client_id: config.vkClientId,
    redirect_uri: config.vkRedirectUri,
    display: 'page',
    scope: 'email',
    response_type: 'code',
    v: '5.131',
  };

  const qs = new URLSearchParams(options);
  res.redirect(`${rootUrl}?${qs.toString()}`);
});

// VK OAuth Callback
router.get('/vk/callback', async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.redirect('/login?error=vk_no_code');
  }

  try {
    // Exchange code for access token
    const tokenRes = await axios.get('https://oauth.vk.com/access_token', {
      params: {
        client_id: config.vkClientId,
        client_secret: config.vkClientSecret,
        redirect_uri: config.vkRedirectUri,
        code,
      },
    });

    const { access_token, user_id, email } = tokenRes.data;

    // Get user profile
    const profileRes = await axios.get('https://api.vk.com/method/users.get', {
      params: {
        user_ids: user_id,
        fields: 'photo_max,screen_name',
        access_token,
        v: '5.131',
      },
    });

    if (!profileRes.data.response || !profileRes.data.response[0]) {
      throw new Error('Failed to get VK profile');
    }

    const profile = profileRes.data.response[0];

    // Upsert user in sellers table
    let { data: seller, error: findError } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', 'vk')
      .eq('auth_provider_id', String(user_id))
      .maybeSingle();

    if (!seller) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);

      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({
          auth_provider: 'vk',
          auth_provider_id: String(user_id),
          email: email || null,
          display_name: `${profile.first_name} ${profile.last_name}`,
          avatar_url: profile.photo_max,
          subscription_status: 'trial',
          subscription_expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single();
      
      if (insertError) throw insertError;
      seller = newSeller;
    }

    // Issue JWT
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: config.nodeEnv === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.redirect('/');
  } catch (error) {
    console.error('VK Auth Error:', error.response?.data || error.message);
    res.redirect('/login?error=vk_auth_failed');
  }
});

module.exports = router;

