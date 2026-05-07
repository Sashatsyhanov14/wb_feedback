const express = require('express');
const router = express.Router();
const config = require('../config');
const supabase = require('../db/supabase');
const wbService = require('../services/wbService');
const authMiddleware = require('../middleware/authMiddleware');
const aiService = require('../services/aiService');

// In-memory daily test counter per seller
const testCounters = {};
function getTestCount(sellerId) {
  const today = new Date().toDateString();
  if (!testCounters[sellerId] || testCounters[sellerId].date !== today) {
    testCounters[sellerId] = { date: today, count: 0 };
  }
  return testCounters[sellerId];
}

// AI Test Endpoint (Playground)
router.post('/ai/test', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { reviewText, productName, productDescription, characteristicsText, toneOfVoice, brandName, rating } = req.body;

    if (!reviewText) {
      return res.status(400).json({ error: 'Текст отзыва обязателен' });
    }

    const seller = await getSeller(sellerId);
    if (!seller) return res.status(404).json({ error: 'Продавец не найден' });

    // Rate limit: 5 tests/day for users without active subscription
    const hasSubscription = seller.subscription_status === 'trial' || seller.subscription_status === 'active';
    const isExpired = seller.subscription_expires_at && new Date() > new Date(seller.subscription_expires_at);
    const isUnlimited = hasSubscription && !isExpired;

    if (!isUnlimited) {
      const counter = getTestCount(sellerId);
      if (counter.count >= 5) {
        return res.status(429).json({ 
          error: 'Лимит тестов исчерпан (5 в день). Подключите токен WB, чтобы получить безлимитный доступ!',
          limitReached: true,
          testsUsed: counter.count,
          testsMax: 5
        });
      }
      counter.count++;
    }

    // Build custom context for the test
    const mockProduct = { 
      name: productName || 'Тестовый товар', 
      description: productDescription || '',
      characteristics: characteristicsText ? [{ name: 'Свойства', value: characteristicsText }] : []
    };
    
    const mockMatrix = { 
      product_name: productName || 'Тестовый товар' 
    };

    const customSettings = {
      brand_name: brandName || 'Наш Магазин',
      custom_instructions: toneOfVoice || ''
    };

    const reviewInput = { 
      text: reviewText, 
      pros: '', 
      cons: '',
      rating: rating || null 
    };

    const response = await aiService.generateResponse(
      reviewInput, 
      mockProduct, 
      mockMatrix, 
      customSettings
    );

    // Track test in DB for admin analytics
    try {
      await supabase.from('support_tickets').insert({
        seller_id: sellerId,
        type: 'analytics',
        message: 'ai_test_success'
      });
    } catch (trackErr) {
      console.error('[Analytics] Failed to log AI test:', trackErr);
    }

    res.json(response);
  } catch (error) {
    console.error('AI Test error:', error);
    res.status(500).json({ error: error.message });
  }
});
// Helper to get seller by UUID
async function getSeller(sellerId) {
  let { data: seller, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('id', sellerId)
    .single();
  
  if (error) return null;
  return seller;
}

// --- Debugging Endpoint ---
router.get('/debug-db', async (req, res) => {
  try {
    console.log('🔍 Running Database Diagnostic...');
    const { data: testRead, error: readError } = await supabase.from('sellers').select('id').limit(1).maybeSingle();
    
    const testId = 'test_' + Math.floor(Math.random() * 1000);
    const { data: testWrite, error: writeError } = await supabase
      .from('sellers')
      .insert({ auth_provider: 'test', auth_provider_id: testId, wb_token: 'TEST' })
      .select()
      .single();

    if (testWrite) {
      await supabase.from('sellers').delete().eq('id', testWrite.id);
    }

    res.json({
      status: 'diagnostic_complete',
      read: { success: !readError, error: readError },
      write: { success: !writeError, error: writeError },
      env: {
        hasUrl: !!process.env.SUPABASE_URL,
        hasKey: !!process.env.SUPABASE_KEY,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Global Stats (Command Center)
router.get('/stats/global', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Fetch all shops for this seller
    const { data: shops, error: shopsError } = await supabase
      .from('shops')
      .select('*')
      .eq('seller_id', sellerId);
    
    if (shopsError) throw shopsError;

    // 2. Fetch all review logs for these shops
    const shopIds = (shops || []).map(s => s.id);
    
    let totalProcessed = 0;
    let todayProcessed = 0;

    if (shopIds.length > 0) {
      const { data: logs, error: logsError } = await supabase
        .from('review_logs')
        .select('created_at, status')
        .in('shop_id', shopIds)
        .in('status', ['auto_posted', 'approved']);
      
      if (logsError) throw logsError;

      totalProcessed = logs.length;
      todayProcessed = logs.filter(l => new Date(l.created_at) >= today).length;
    }

    // 3. Analyze shop health
    const redZone = (shops || []).filter(s => 
      !s.wb_token_valid || 
      (s.subscription_expires_at && new Date(s.subscription_expires_at) < new Date())
    );
    
    const greenZoneCount = (shops || []).length - redZone.length;

    // Calculate time saved (assume 2 mins per review)
    const totalMinutesSaved = totalProcessed * 2;
    const hoursSaved = Math.floor(totalMinutesSaved / 60);

    res.json({
      todayProcessed,
      totalProcessed,
      hoursSaved,
      greenZoneCount,
      redZone: redZone.map(s => ({
        id: s.id,
        name: s.name,
        issue: !s.wb_token_valid ? 'API Key Invalid' : 'Subscription Expired'
      }))
    });
  } catch (error) {
    console.error('[GlobalStats] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all reviews for a specific shop
router.get('/reviews', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { status, shopId } = req.query;
    let query = supabase
      .from('review_logs')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    
    if (shopId) query = query.eq('shop_id', shopId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve and send a review to WB
router.post('/reviews/:id/approve', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    const { data: log, error: logError } = await supabase
      .from('review_logs')
      .select('*, shops(wb_token)')
      .eq('id', id)
      .single();

    if (logError) throw logError;

    const token = log.shops?.wb_token;
    if (!token) throw new Error('WB Token not found for this shop');

    const success = await wbService.sendAnswer(log.review_id, text, token);
    
    if (success) {
      const { error: updateError } = await supabase
        .from('review_logs')
        .update({ status: 'approved', ai_response_draft: text })
        .eq('id', id);
      
      if (updateError) throw updateError;
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to send answer to Wildberries' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET seller settings (auth + subscription only, no shop fields)
router.get('/settings', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const seller = await getSeller(sellerId);
    
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    res.json(seller);
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE seller settings (account-level only: display_name, etc.)
router.post('/settings', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { display_name } = req.body;
    
    const seller = await getSeller(sellerId);
    if (!seller) throw new Error('Could not find seller profile');

    const updateData = {};
    if (display_name !== undefined) updateData.display_name = display_name;

    const { data, error } = await supabase
      .from('sellers')
      .update(updateData)
      .eq('id', seller.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, settings: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard stats for a specific shop
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { shopId } = req.query;

    if (!shopId) return res.status(400).json({ error: 'shopId is required' });

    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayISO = todayStart.toISOString();

    const { count: total } = await supabase
      .from('review_logs')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('shop_id', shopId);

    const { count: pending } = await supabase
      .from('review_logs')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('shop_id', shopId)
      .eq('status', 'pending');

    const { count: approved } = await supabase
      .from('review_logs')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('shop_id', shopId)
      .in('status', ['approved', 'auto_posted']);

    const { count: approvedToday } = await supabase
      .from('review_logs')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('shop_id', shopId)
      .in('status', ['approved', 'auto_posted'])
      .gte('created_at', todayISO);

    res.json({
      total: total || 0,
      pending: pending || 0,
      approved: approved || 0,
      approvedToday: approvedToday || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Analytics data for a specific shop
router.get('/analytics', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { shopId } = req.query;

    if (!shopId) return res.status(400).json({ error: 'shopId is required' });

    const { data: reviews, error } = await supabase
      .from('review_logs')
      .select('rating, category, sentiment')
      .eq('seller_id', sellerId)
      .eq('shop_id', shopId)
      .not('category', 'is', null);

    if (error) throw error;

    const stats = {
      ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      categories: {},
      sentiments: { positive: 0, neutral: 0, negative: 0 }
    };

    reviews.forEach(r => {
      if (stats.ratings[r.rating] !== undefined) stats.ratings[r.rating]++;
      if (r.category) stats.categories[r.category] = (stats.categories[r.category] || 0) + 1;
      if (r.sentiment) stats.sentiments[r.sentiment]++;
    });

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PRODUCT MATRIX ---

router.get('/matrix', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { shopId } = req.query;
    
    if (!shopId) return res.status(400).json({ error: 'shopId is required' });

    const { data, error } = await supabase
      .from('product_matrix')
      .select('*')
      .eq('seller_id', sellerId)
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/matrix', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { shopId, nm_id, product_name, custom_instructions, cross_sell_article } = req.body;
    
    if (!shopId || !nm_id) return res.status(400).json({ error: 'shopId and nm_id are required' });

    const { data, error } = await supabase
      .from('product_matrix')
      .upsert({ 
        seller_id: sellerId, 
        shop_id: shopId, 
        nm_id, 
        product_name, 
        custom_instructions, 
        cross_sell_article 
      })
      .select()
      .single();
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual sync trigger for a specific shop
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { shopId } = req.body;
    
    if (!shopId) return res.status(400).json({ error: 'shopId is required' });

    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('*')
      .eq('id', shopId)
      .eq('seller_id', sellerId)
      .single();

    if (shopError || !shop || !shop.wb_token) {
      return res.status(400).json({ error: 'Магазин не найден или отсутствует WB Токен' });
    }

    console.log(`[Manual Sync] Triggering for shop ${shop.name} (${shop.id})`);
    await reviewService.processShopReviews(shop);
    
    res.json({ success: true, message: 'Синхронизация запущена!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- SHOP MANAGEMENT ROUTES ---

router.get('/shops', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { data, error } = await supabase
      .from('shops')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/shops', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { name, wb_token, brand_name, custom_instructions } = req.body;
    
    if (!name) return res.status(400).json({ error: 'Название магазина обязательно' });

    // Check shop limit
    const { data: seller } = await supabase
      .from('sellers')
      .select('max_shops')
      .eq('id', sellerId)
      .single();
      
    const { count: shopCount } = await supabase
      .from('shops')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId);
      
    const limit = seller?.max_shops || 1;
    if (shopCount >= limit) {
      return res.status(403).json({ error: `Достигнут лимит магазинов для вашего тарифа (${limit}). Перейдите на тариф выше.` });
    }

    const { data, error } = await supabase
      .from('shops')
      .insert({ 
        seller_id: sellerId, 
        name, 
        wb_token: wb_token || '', 
        brand_name: brand_name || '', 
        custom_instructions: custom_instructions || '' 
      })
      .select()
      .single();
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/shops/:id', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { id } = req.params;
    const updateData = req.body;

    const { data: shop, error: fetchError } = await supabase
      .from('shops')
      .select('id')
      .eq('id', id)
      .eq('seller_id', sellerId)
      .single();

    if (fetchError || !shop) return res.status(403).json({ error: 'Доступ запрещен' });

    const { data, error } = await supabase
      .from('shops')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/shops/:id', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { id } = req.params;

    console.log(`[Shop] Attempting to delete shop ${id} for seller ${sellerId}`);

    // 1. Manually delete related logs and matrix to avoid FK constraints issues if ON DELETE CASCADE is missing
    await supabase.from('review_logs').delete().eq('shop_id', id).eq('seller_id', sellerId);
    await supabase.from('product_matrix').delete().eq('shop_id', id).eq('seller_id', sellerId);

    // 2. Delete the shop
    const { error } = await supabase
      .from('shops')
      .delete()
      .eq('id', id)
      .eq('seller_id', sellerId);
      
    if (error) {
      console.error('[Shop] Deletion error:', error);
      throw error;
    }

    console.log(`[Shop] Successfully deleted shop ${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Shop] Delete catch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get support tickets for user
router.get('/support', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new support ticket / feedback
router.post('/support', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { type, message } = req.body;
    
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({ seller_id: sellerId, type, message })
      .select()
      .single();
      
    if (error) throw error;
    
    if (config.adminId) {
      await telegramService.sendMessage(config.adminId, `📬 <b>Новое обращение (${type})</b>\nОт: <code>${sellerId}</code>\nТекст: ${message}`);
    }
    res.json({ success: true, ticket: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;
