const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const wbService = require('../services/wbService');
const telegramService = require('../services/telegramService');

// --- Debugging Endpoint ---
router.get('/debug-db', async (req, res) => {
  try {
    console.log('🔍 Running Database Diagnostic...');
    
    // 1. Check connection/keys by fetching 1 seller
    const { data: testRead, error: readError } = await supabase.from('sellers').select('id').limit(1).maybeSingle();
    
    // 2. Try a test insert (we'll use a unique chat ID that won't collide)
    const testId = 999999 + Math.floor(Math.random() * 1000);
    const { data: testWrite, error: writeError } = await supabase
      .from('sellers')
      .insert({ telegram_chat_id: testId, wb_token: 'TEST' })
      .select()
      .single();

    // 3. Cleanup test data
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

// Register or update seller (Onboarding)
router.post('/register', async (req, res) => {
  try {
    const { telegramChatId, wbToken, brandName, sellerDescription } = req.body;
    
    if (!telegramChatId || !wbToken) {
      return res.status(400).json({ error: 'telegramChatId and wbToken are required' });
    }

    // Validate token with WB
    const isValid = await wbService.getNewReviews(wbToken); 
    if (!isValid) return res.status(400).json({ error: 'Invalid WB Token' });

    const { data, error } = await supabase
      .from('sellers')
      .upsert({ 
        telegram_chat_id: telegramChatId, 
        wb_token: wbToken,
        brand_name: brandName,
        seller_description: sellerDescription,
        respond_to_bad_reviews: false, // Default
        subscription_status: 'free' // Default
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, seller: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to get or create seller by TG ID
async function ensureSeller(telegramChatId) {
  let { data: seller, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('telegram_chat_id', telegramChatId)
    .single();

  if (error && error.code === 'PGRST116') {
    // 1. Check total sellers count for Top-5 promo
    const { count } = await supabase.from('sellers').select('id', { count: 'exact', head: true });
    const isTop5 = (count || 0) < 5;
    
    // 2. Set expiration date (30 days from now) if top 5
    const expiresAt = isTop5 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;

    const { data: newSeller, error: insertError } = await supabase
      .from('sellers')
      .insert({ 
        telegram_chat_id: telegramChatId,
        wb_token: '', 
        is_auto_reply_enabled: true,
        respond_to_bad_reviews: false,
        subscription_status: isTop5 ? 'premium' : 'free',
        subscription_expires_at: expiresAt,
        is_top_5: isTop5
      })
      .select()
      .single();
    if (insertError) return null;
    return newSeller;
  }
  return seller;
}

// Get all reviews for a specific seller
router.get('/reviews/:telegramChatId', async (req, res) => {
  try {
    const { telegramChatId } = req.params;
    const { status } = req.query;
    
    const seller = await ensureSeller(telegramChatId);
    if (!seller) return res.json([]); // Return empty reviews if user can't be created

    let query = supabase
      .from('review_logs')
      .select('*')
      .eq('seller_id', seller.id)
      .order('created_at', { ascending: false });
    
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve and send a review to WB
router.post('/reviews/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    // 1. Get review details from DB
    const { data: log, error: logError } = await supabase
      .from('review_logs')
      .select('*, sellers(wb_token)')
      .eq('id', id)
      .single();

    if (logError) throw logError;

    // 2. Send to WB
    const success = await wbService.sendAnswer(log.review_id, text);
    
    if (success) {
      // 3. Update status in DB
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

// GET seller settings
router.get('/settings/:telegramChatId', async (req, res) => {
  try {
    const { telegramChatId } = req.params;
    
    // Attempt to find seller
    let { data: seller, error } = await supabase
      .from('sellers')
      .select('*')
      .eq('telegram_chat_id', telegramChatId)
      .single();
    
    // Seamless Onboarding: If not found, create a new record
    if (error && error.code === 'PGRST116') { // PGRST116 is "No rows found"
      const { data: newSeller, error: insertError } = await supabase
        .from('sellers')
        .insert({ 
          telegram_chat_id: telegramChatId,
          wb_token: '', 
          is_auto_reply_enabled: true,
          respond_to_bad_reviews: false,
          subscription_status: 'free'
        })
        .select()
        .single();
        
      if (insertError) throw insertError;
      seller = newSeller;
    } else if (error) {
      throw error;
    }

    // Find rank of this seller
    const { count: totalBefore } = await supabase
      .from('sellers')
      .select('id', { count: 'exact', head: true })
      .lt('created_at', seller.created_at);

    const is_top_5 = (totalBefore || 0) < 5;
    
    // Auto-apply promo for top 5 if they are still 'free'
    if (is_top_5 && seller.subscription_status === 'free') {
      const expiresAt = new Date(new Date(seller.created_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: updated, error: uError } = await supabase
        .from('sellers')
        .update({ subscription_status: 'premium', subscription_expires_at: expiresAt })
        .eq('id', seller.id)
        .select()
        .single();
      
      if (!uError) return res.json({ ...updated, is_top_5: true });
    }

    res.json({
      ...seller,
      is_top_5
    });
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE seller settings
router.post('/settings/:telegramChatId', async (req, res) => {
  try {
    const { 
      is_auto_reply_enabled, 
      auto_reply_min_rating, 
      custom_instructions,
      respond_to_bad_reviews,
      brand_name,
      seller_description,
      wb_token
    } = req.body;
    
    // Ensure seller exists (Seamless Onboarding)
    const seller = await ensureSeller(req.params.telegramChatId);
    if (!seller) throw new Error('Could not initialize seller profile');

    const { data, error } = await supabase
      .from('sellers')
      .update({ 
        is_auto_reply_enabled, 
        auto_reply_min_rating, 
        custom_instructions,
        respond_to_bad_reviews,
        brand_name,
        seller_description,
        wb_token
      })
      .eq('id', seller.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, settings: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard stats for a specific seller
router.get('/stats/:telegramChatId', async (req, res) => {
  try {
    const { telegramChatId } = req.params;

    const seller = await ensureSeller(telegramChatId);
    if (!seller) return res.status(404).json({ error: 'Seller not found or created' });

    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayISO = todayStart.toISOString();

    const { count: total } = await supabase
      .from('review_logs')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', seller.id);

    const { count: pending } = await supabase
      .from('review_logs')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', seller.id)
      .eq('status', 'pending');

    const { count: approved } = await supabase
      .from('review_logs')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', seller.id)
      .in('status', ['approved', 'auto_posted']);

    const { count: approvedToday } = await supabase
      .from('review_logs')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', seller.id)
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

// Admin Global Stats
router.get('/admin/stats/:adminId', async (req, res) => {
  try {
    const { adminId } = req.params;
    if (adminId !== config.adminId) return res.status(403).json({ error: 'Access denied' });

    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayISO = todayStart.toISOString();

    const { count: totalSellers } = await supabase.from('sellers').select('id', { count: 'exact', head: true });
    
    const { count: newToday } = await supabase.from('sellers')
      .select('id', { count: 'exact', head: true })
      .gte('joined_at', todayISO);

    const { count: activeToday } = await supabase.from('sellers')
      .select('id', { count: 'exact', head: true })
      .gte('last_active_at', todayISO);

    const { count: withoutToken } = await supabase.from('sellers')
      .select('id', { count: 'exact', head: true })
      .filter('wb_token', 'eq', ''); // Since it's NOT NULL, just check empty string

    const { count: totalApproved } = await supabase.from('review_logs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['approved', 'auto_posted']);

    res.json({
      totalSellers: totalSellers || 0,
      newToday: newToday || 0,
      activeToday: activeToday || 0,
      withoutToken: withoutToken || 0,
      totalApproved: totalApproved || 0
    });
  } catch (error) {
    console.error(`[AdminStats] CRITICAL ERROR for admin ${req.params.adminId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get latest sellers
router.get('/admin/users/:adminId', async (req, res) => {
  try {
    const { adminId } = req.params;
    if (adminId !== config.adminId) return res.status(403).json({ error: 'Access denied' });

    const { data: users, error } = await supabase
      .from('sellers')
      .select('telegram_chat_id, joined_at, last_active_at, wb_token')
      .order('last_active_at', { ascending: false })
      .limit(5);

    if (error) throw error;
    res.json(users);
  } catch (error) {
    console.error(`[AdminUsers] Error for admin ${req.params.adminId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// --- Product Matrix ---

router.get('/matrix/:telegramChatId', async (req, res) => {
  try {
    const { telegramChatId } = req.params;
    const seller = await ensureSeller(telegramChatId);
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    const { data, error } = await supabase
      .from('product_matrix')
      .select('*')
      .eq('seller_id', seller.id);
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/matrix', async (req, res) => {
  try {
    const { 
      telegramChatId, 
      telegram_chat_id, 
      nm_id, 
      product_name, 
      cross_sell_article, 
      cross_sell_description 
    } = req.body;
    
    const chatId = telegramChatId || telegram_chat_id;
    
    // Find seller by TG ID
    const { data: seller, error: sError } = await supabase
      .from('sellers')
      .select('id')
      .eq('telegram_chat_id', chatId)
      .single();
    
    if (sError || !seller) return res.status(404).json({ error: 'Seller not found' });
    
    const { data, error } = await supabase.from('product_matrix').upsert({
      seller_id: seller.id,
      nm_id: Number(nm_id),
      product_name: product_name || 'Товар', // Provide fallback for NOT NULL constraint
      cross_sell_article,
      cross_sell_description: cross_sell_description || ''
    }).select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/matrix/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('product_matrix').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Analytics data for a specific seller
router.get('/analytics/:telegramChatId', async (req, res) => {
  try {
    const { telegramChatId } = req.params;

    const seller = await ensureSeller(telegramChatId);
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    const { data: reviews, error } = await supabase
      .from('review_logs')
      .select('rating, category, sentiment')
      .eq('seller_id', seller.id)
      .not('category', 'is', null);

    if (error) throw error;

    // Aggregations
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

// Manual sync trigger
const reviewService = require('../services/reviewService');

router.post('/sync/:telegramChatId', async (req, res) => {
  try {
    const { telegramChatId } = req.params;
    const seller = await ensureSeller(telegramChatId);
    if (!seller || !seller.wb_token) {
      return res.status(400).json({ error: 'Добавьте WB Токен в настройках' });
    }

    console.log(`[Manual Sync] Triggering for seller ${seller.id}`);
    await reviewService.processSellerReviews(seller);
    
    res.json({ success: true, message: 'Синхронизация запущена. Проверьте сообщения от бота!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
