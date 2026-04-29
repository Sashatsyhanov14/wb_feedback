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

    const host = req.headers.host;
    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: host.includes('wbreplyai.ru'), 
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
  res.clearCookie('auth_token', { path: '/' });
  res.json({ success: true });
});

// 4. Demo Login (for development testing)
router.post('/demo', async (req, res) => {
    // SECURITY: Disable demo login in production
    if (config.nodeEnv === 'production') {
        return res.status(403).json({ error: 'Demo login is disabled in production environments for security reasons.' });
    }

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
      secure: host.includes('wbreplyai.ru'), 
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

// 6. VK Login (Server-side PKCE with VK ID)
router.get('/vk', (req, res) => {
  const host = req.headers.host;
  const redirectUri = host.includes('wbreplyai.ru') 
    ? 'https://wbreplyai.ru/api/auth/vk/callback' 
    : `http://${host}/api/auth/vk/callback`;

  // Generate PKCE pair
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');

  // Store code_verifier in httpOnly cookie (5 min TTL)
  res.cookie('vk_pkce_verifier', codeVerifier, {
    httpOnly: true,
    secure: host.includes('wbreplyai.ru'),
    maxAge: 5 * 60 * 1000,
    path: '/',
    sameSite: 'Lax'
  });

  const rootUrl = 'https://id.vk.com/authorize';
  const options = {
    response_type: 'code',
    client_id: config.vkClientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
    state: state,
  };

  const qs = new URLSearchParams(options);
  console.log('VK Auth: Redirecting to VK ID with PKCE. State:', state);
  res.redirect(`${rootUrl}?${qs.toString()}`);
});

// VK OAuth Callback (Server-side PKCE exchange with VK ID)
router.get('/vk/callback', async (req, res) => {
  const code = req.query.code;
  const deviceId = req.query.device_id || '';
  const state = req.query.state || '';
  const codeVerifier = req.cookies.vk_pkce_verifier || '';
  
  console.log('VK Callback received. Code:', !!code, '| device_id:', !!deviceId, '| verifier from cookie:', !!codeVerifier);

  if (!code) {
    return res.redirect('/login?error=vk_no_code');
  }

  // Clear the PKCE cookie immediately
  res.clearCookie('vk_pkce_verifier', { path: '/' });

  if (!codeVerifier) {
    console.error('VK Auth Error: No code_verifier found in cookie. PKCE flow broken.');
    return res.redirect('/login?error=vk_pkce_missing');
  }

  try {
    const host = req.headers.host;
    const redirectUri = host.includes('wbreplyai.ru') 
      ? 'https://wbreplyai.ru/api/auth/vk/callback' 
      : `http://${host}/api/auth/vk/callback`;

    // Step 1: Exchange code for tokens at VK ID endpoint
    console.log('VK ID Token Exchange at id.vk.com/oauth2/auth');
    const tokenRes = await axios.post('https://id.vk.com/oauth2/auth', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: config.vkClientId,
        device_id: deviceId,
        state: state,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    console.log('VK ID Token Response status:', tokenRes.status);

    if (tokenRes.data.error) {
      console.error('VK ID Token Error:', tokenRes.data);
      throw new Error(tokenRes.data.error_description || tokenRes.data.error);
    }

    const { access_token, user_id } = tokenRes.data;

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

    const user = profileRes.data.user || {};
    const vkUserId = (user_id || user.user_id || '').toString();
    const vkFirstName = user.first_name || '';
    const vkLastName = user.last_name || '';
    const vkEmail = user.email || null;
    const vkAvatar = user.avatar || null;

    if (!vkUserId) {
      throw new Error('VK auth succeeded but user_id is missing');
    }

    // Step 3: Upsert user in sellers table
    console.log('VK Auth Success. User ID:', vkUserId, '| Name:', vkFirstName, vkLastName);

    let { data: seller } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', 'vk')
      .eq('auth_provider_id', vkUserId)
      .maybeSingle();

    if (!seller) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);

      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({
          auth_provider: 'vk',
          auth_provider_id: vkUserId,
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

    // Step 4: Issue JWT and redirect
    console.log('Issuing token for sellerId:', seller.id);
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: host.includes('wbreplyai.ru'), 
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'Lax'
    });
    console.log('Cookie auth_token set. Redirecting to /app');

    res.redirect(`/app?token=${token}`);
  } catch (error) {
    const vkErr = error.response?.data;
    console.error('VK Auth Error Details:', JSON.stringify(vkErr, null, 2));
    console.error('VK Auth Error Message:', error.message);
    res.redirect(`/login?error=vk_auth_failed&details=${encodeURIComponent(error.message)}`);
  }
});



// 7. Magic Link (Supabase Auth - Implicit Flow)
router.post('/magic', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const host = req.headers.host;
    const protocol = host.includes('wbreplyai.ru') ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
    // Redirect to /app - implicit flow sends tokens in URL hash (#access_token=...)
    const redirectUrl = `${protocol}://${host}/app`;

    console.log(`Magic Link request for: ${email} | Redirect URL: ${redirectUrl}`);

    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) {
      console.error('Supabase Magic Link Error:', error);
      throw error;
    }
    
    console.log('Magic Link sent successfully via Supabase');
    res.json({ success: true });
  } catch (error) {
    console.error('Magic Link Process Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 7b. Magic Link Verify (Client sends Supabase access_token, we issue our JWT)
router.post('/magic-verify', async (req, res) => {
  const { access_token } = req.body;

  if (!access_token) {
    return res.status(400).json({ error: 'access_token is required' });
  }

  try {
    console.log('Magic Verify: Checking Supabase access_token...');
    
    // Use the access_token to get user info from Supabase
    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    
    if (error || !user) {
      console.error('Magic Verify Error:', error);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const email = user.email;
    const authProvider = user.app_metadata?.provider || 'email';
    const authProviderId = user.id;

    console.log(`Magic Verify Success: ${email} | Provider: ${authProvider} | ID: ${authProviderId}`);

    // Upsert user in sellers table
    let { data: seller } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', authProvider)
      .eq('auth_provider_id', authProviderId)
      .maybeSingle();

    if (!seller) {
      console.log('New magic link user, creating seller record...');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);

      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({
          auth_provider: authProvider,
          auth_provider_id: authProviderId,
          email: email,
          display_name: user.user_metadata?.full_name || email.split('@')[0],
          avatar_url: user.user_metadata?.avatar_url || null,
          subscription_status: 'trial',
          subscription_expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single();
      
      if (insertError) {
        console.error('Magic Verify DB Insert Error:', insertError);
        throw insertError;
      }
      seller = newSeller;
    }

    if (!seller || !seller.id) {
      throw new Error('Seller record missing after upsert');
    }

    // Issue our JWT
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    const host = req.headers.host;
    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: host.includes('wbreplyai.ru'),
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'Lax'
    });

    console.log('Magic Verify: JWT issued for sellerId:', seller.id);
    res.json({ success: true, token, sellerId: seller.id });
  } catch (error) {
    console.error('Magic Verify Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 8. Supabase Auth Callback (Universal)
router.get('/callback', async (req, res) => {
  const code = req.query.code;
  const error_description = req.query.error_description;

  console.log('Supabase Callback received. Code exists:', !!code, 'Error:', error_description);

  if (!code) {
    return res.redirect(`/login?error=no_code&details=${encodeURIComponent(error_description || '')}`);
  }

  try {
    // Exchange the code for a session
    console.log('Exchanging code for session...');
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('Supabase Session Exchange Error:', error);
      throw error;
    }

    const { user } = data;
    const email = user.email;
    const authProvider = user.app_metadata?.provider || 'email';
    const authProviderId = user.id;

    console.log(`Auth Callback Success: ${email} | Provider: ${authProvider} | ID: ${authProviderId}`);

    // Upsert user in our sellers table
    let { data: seller, error: findError } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', authProvider)
      .eq('auth_provider_id', authProviderId)
      .maybeSingle();

    if (!seller) {
      console.log('New user detected, creating seller record...');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);

      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({
          auth_provider: authProvider,
          auth_provider_id: authProviderId,
          email: email,
          display_name: user.user_metadata?.full_name || email.split('@')[0],
          avatar_url: user.user_metadata?.avatar_url || null,
          subscription_status: 'trial',
          subscription_expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single();
      
      if (insertError) {
        console.error('DB Insert Error during magic link callback:', insertError);
        throw insertError;
      }
      seller = newSeller;
    }

    if (!seller || !seller.id) {
        throw new Error('Seller record missing after upsert');
    }

    // Issue our custom JWT
    console.log('Issuing local JWT token for sellerId:', seller.id);
    const token = jwt.sign(
      { sellerId: seller.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    const host = req.headers.host;
    res.cookie('auth_token', token, {
      httpOnly: false,
      secure: host.includes('wbreplyai.ru'), 
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'Lax'
    });
    
    console.log('Local auth_token cookie set. Redirecting to /app');
    res.redirect(`/app?token=${token}`);
  } catch (error) {
    console.error('Supabase Callback Detailed Error:', error.message);
    res.redirect(`/login?error=auth_failed&details=${encodeURIComponent(error.message)}`);
  }
});

module.exports = router;

