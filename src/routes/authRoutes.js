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
        
      if (insertError) {
        console.error('DB Insert Error:', insertError);
        throw insertError;
      }
      if (!newSeller) {
        throw new Error('User creation failed: No data returned');
      }
      seller = newSeller;
    }

    if (!seller || !seller.id) {
        throw new Error('User session creation failed: Seller ID missing');
    }

    console.log('Issuing token for sellerId:', seller.id);
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: false, 
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'Lax'
    });
    console.log('Cookie auth_token set. Redirecting to /app with token');

    res.redirect(`/app?token=${token}`);
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

// 5. Google Login (Manual Flow)
router.get('/google', (req, res) => {
  const host = req.headers.host;
  // Force https for production domain
  const protocol = host.includes('wbreplyai.ru') ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
  const redirectUri = `${protocol}://${host}/api/auth/google/callback`;

  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: redirectUri,
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

// Google OAuth Callback (Manual)
router.get('/google/callback', async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.redirect('/login?error=google_no_code');
  }

  try {
    const host = req.headers.host;
    const protocol = host.includes('wbreplyai.ru') ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
    const redirectUri = `${protocol}://${host}/api/auth/google/callback`;
    
    // Exchange code for tokens
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
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
      
      if (insertError) {
        console.error('Google DB Insert Error:', insertError);
        throw insertError;
      }
      if (!newSeller) {
        throw new Error('Google User creation failed: No data returned');
      }
      seller = newSeller;
    }

    if (!seller || !seller.id) {
        throw new Error('Google User session creation failed: Seller ID missing');
    }

    // Issue our custom JWT
    console.log('Issuing token for sellerId:', seller.id);
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: false, 
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'Lax'
    });
    console.log('Cookie auth_token set. Redirecting to /app with token');

    res.redirect(`/app?token=${token}`);
  } catch (error) {
    console.error('Google Auth Error:', error.response?.data || error.message);
    res.redirect('/login?error=google_auth_failed');
  }
});

// Old Google Callback (Replaced by universal /callback)
/*
router.get('/google/callback', async (req, res) => {
  // ... existing code ...
});
*/

// 6. VK Login (Manual Flow)
router.get('/vk', (req, res) => {
  const host = req.headers.host;
  // Use hardcoded URI for production, dynamic for local
  const redirectUri = host.includes('wbreplyai.ru') 
    ? 'https://wbreplyai.ru/api/auth/vk/callback' 
    : `http://${host}/api/auth/vk/callback`;

  const rootUrl = 'https://oauth.vk.com/authorize';
  const options = {
    client_id: config.vkClientId,
    redirect_uri: redirectUri,
    display: 'page',
    scope: 'email',
    response_type: 'code',
    v: '5.131',
  };

  const qs = new URLSearchParams(options);
  res.redirect(`${rootUrl}?${qs.toString()}`);
});

// VK OAuth Callback (supports both VK ID SDK and legacy redirect flow)
router.get('/vk/callback', async (req, res) => {
  const code = req.query.code;
  const isFromSdk = req.query.source === 'sdk';
  const deviceId = req.query.device_id || '';
  const state = req.query.state || '';
  const codeVerifier = req.query.code_verifier || '';
  console.log('VK Callback received. Code exists:', !!code, '| Source:', isFromSdk ? 'VK ID SDK' : 'Legacy redirect', '| Has verifier:', !!codeVerifier);

  if (!code) {
    return res.redirect('/login?error=vk_no_code');
  }

  try {
    const host = req.headers.host;
    const redirectUri = host.includes('wbreplyai.ru') 
      ? 'https://wbreplyai.ru/api/auth/vk/callback' 
      : `http://${host}/api/auth/vk/callback`;

    let vkUserId, vkEmail, vkFirstName, vkLastName, vkAvatar;

    if (isFromSdk) {
      // ========= VK ID SDK Flow (id.vk.com endpoints) =========
      console.log('VK ID Token Exchange at id.vk.com/oauth2/auth');

      // Build token exchange params (code_verifier is required for PKCE)
      const tokenParams = {
        grant_type: 'authorization_code',
        code: code,
        client_id: config.vkClientId,
        device_id: deviceId,
        state: state,
        redirect_uri: redirectUri,
      };
      if (codeVerifier) {
        tokenParams.code_verifier = codeVerifier;
      }

      // Step 1: Exchange code for tokens via VK ID endpoint
      const tokenRes = await axios.post('https://id.vk.com/oauth2/auth', 
        new URLSearchParams(tokenParams).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );

      console.log('VK ID Token Response status:', tokenRes.status);

      if (tokenRes.data.error) {
        console.error('VK ID Token Error:', tokenRes.data);
        throw new Error(tokenRes.data.error_description || tokenRes.data.error);
      }

      const { access_token, user_id, id_token } = tokenRes.data;
      vkUserId = user_id;

      // Step 2: Get user profile via VK ID user_info endpoint
      const profileRes = await axios.post('https://id.vk.com/oauth2/user_info',
        new URLSearchParams({
          client_id: config.vkClientId,
          access_token: access_token,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );

      console.log('VK ID Profile Response:', JSON.stringify(profileRes.data, null, 2));

      const user = profileRes.data.user;
      if (user) {
        vkFirstName = user.first_name || '';
        vkLastName = user.last_name || '';
        vkEmail = user.email || null;
        vkAvatar = user.avatar || null;
        if (!vkUserId) vkUserId = user.user_id;
      }
    } else {
      // ========= Legacy VK OAuth Flow (oauth.vk.com endpoints) =========
      console.log('Legacy VK Token Exchange at oauth.vk.com/access_token');

      const tokenRes = await axios.get('https://oauth.vk.com/access_token', {
        params: {
          client_id: config.vkClientId,
          client_secret: config.vkClientSecret,
          redirect_uri: redirectUri,
          code: code,
        },
      });

      if (tokenRes.data.error) {
        throw new Error(tokenRes.data.error_description || tokenRes.data.error);
      }

      const { access_token, user_id, email } = tokenRes.data;
      vkUserId = user_id;
      vkEmail = email || null;

      const profileRes = await axios.get('https://api.vk.com/method/users.get', {
        params: {
          user_ids: user_id,
          fields: 'photo_max,screen_name',
          access_token,
          v: '5.131',
        },
      });

      const profile = profileRes.data.response[0];
      vkFirstName = profile.first_name;
      vkLastName = profile.last_name;
      vkAvatar = profile.photo_max;
    }

    // ========= Common: Upsert user in sellers table =========
    const vkIdStr = vkUserId.toString();
    console.log('VK Auth Success. User ID:', vkIdStr, '| Name:', vkFirstName, vkLastName);

    let { data: seller, error: findError } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', 'vk')
      .eq('auth_provider_id', vkIdStr)
      .maybeSingle();

    if (!seller) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);

      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({
          auth_provider: 'vk',
          auth_provider_id: vkIdStr,
          email: vkEmail,
          display_name: `${vkFirstName} ${vkLastName}`.trim() || 'VK User',
          avatar_url: vkAvatar,
          subscription_status: 'trial',
          subscription_expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single();
      
      if (insertError) {
        console.error('VK DB Insert Error:', insertError);
        throw insertError;
      }
      if (!newSeller) {
        throw new Error('VK User creation failed: No data returned');
      }
      seller = newSeller;
    }

    if (!seller || !seller.id) {
        throw new Error('VK User session creation failed: Seller ID missing');
    }

    // Issue our custom JWT
    console.log('Issuing token for sellerId:', seller.id);
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: false, 
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'Lax'
    });
    console.log('Cookie auth_token set. Redirecting to /app with token');

    res.redirect(`/app?token=${token}`);
  } catch (error) {
    const vkErr = error.response?.data;
    console.error('VK Auth Error Details:', JSON.stringify(vkErr, null, 2));
    console.error('VK Auth Error Message:', error.message);
    res.redirect(`/login?error=vk_auth_failed&details=${encodeURIComponent(error.message)}`);
  }
});



// 7. Magic Link (Supabase Auth)
router.post('/magic', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const redirectUrl = `${protocol}://${host}/api/auth/callback`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Magic Link Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 8. Supabase Auth Callback (Universal)
router.get('/callback', async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.redirect('/login?error=no_code');
  }

  try {
    // Exchange the code for a session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;

    const { user } = data;
    const email = user.email;
    const authProvider = user.app_metadata.provider || 'email';
    const authProviderId = user.id;

    // Upsert user in our sellers table
    let { data: seller, error: findError } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', authProvider)
      .eq('auth_provider_id', authProviderId)
      .maybeSingle();

    if (!seller) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);

      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({
          auth_provider: authProvider,
          auth_provider_id: authProviderId,
          email: email,
          display_name: user.user_metadata.full_name || email.split('@')[0],
          avatar_url: user.user_metadata.avatar_url || null,
          subscription_status: 'trial',
          subscription_expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single();
      
      if (insertError) throw insertError;
      seller = newSeller;
    }

    // Issue our custom JWT
    console.log('Issuing token for sellerId:', seller.id);
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: false, 
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'Lax'
    });
    console.log('Cookie auth_token set. Redirecting to /app with token');

    res.redirect(`/app?token=${token}`);
  } catch (error) {
    console.error('Supabase Callback Error:', error.message);
    res.redirect(`/login?error=auth_failed&details=${encodeURIComponent(error.message)}`);
  }
});

module.exports = router;

