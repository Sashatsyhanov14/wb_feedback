const express = require('express');
const router = express.Router();
const config = require('../config');
const supabase = require('../db/supabase');
const wbService = require('../services/wbService');
const telegramService = require('../services/telegramService');
const authMiddleware = require('../middleware/authMiddleware');

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

// Get all reviews for a specific seller
router.get('/reviews', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { status } = req.query;
    
    const seller = await getSeller(sellerId);
    if (!seller) return res.json([]); 

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
router.post('/reviews/:id/approve', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    const { data: log, error: logError } = await supabase
      .from('review_logs')
      .select('*, sellers(wb_token)')
      .eq('id', id)
      .single();

    if (logError) throw logError;

    const success = await wbService.sendAnswer(log.review_id, text);
    
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

// GET seller settings
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

// UPDATE seller settings
router.post('/settings', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const { 
      is_auto_reply_enabled, 
      custom_instructions,
      respond_to_bad_reviews,
      brand_name,
      wb_token
    } = req.body;
    
    const seller = await getSeller(sellerId);
    if (!seller) throw new Error('Could not find seller profile');

    const isFirstToken = !seller.wb_token && wb_token;

    const { data, error } = await supabase
      .from('sellers')
      .update({ 
        is_auto_reply_enabled, 
        custom_instructions,
        respond_to_bad_reviews,
        brand_name,
        wb_token
      })
      .eq('id', seller.id)
      .select()
      .single();

    if (error) throw error;

    if (isFirstToken && config.adminId) {
      // Optional: Admin notification
      await telegramService.sendMessage(config.adminId, `🔑 <b>Токен добавлен!</b>\nЮзер: <code>${seller.display_name || seller.id}</code>\nМагазин готов к работе.`);
    }

    res.json({ success: true, settings: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard stats for a specific seller
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const seller = await getSeller(sellerId);
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

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
router.get('/admin/stats', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    // VERY BASIC ADMIN CHECK (should use roles in DB ideally)
    if (sellerId !== process.env.ADMIN_SELLER_ID && sellerId !== config.adminId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayISO = todayStart.toISOString();

    let totalSellers = 0;
    let newToday = 0;
    let activeToday = 0;
    let withoutToken = 0;
    let totalApproved = 0;

    try {
      const { count: tsCount } = await supabase.from('sellers').select('id', { count: 'exact', head: true });
      totalSellers = tsCount || 0;
      
      const { count: subCount } = await supabase.from('sellers')
        .select('id', { count: 'exact', head: true })
        .not('subscription_status', 'in', '("free","trial")');
      const totalSubscribed = subCount || 0;

      const { count: ntCount } = await supabase.from('sellers')
        .select('id', { count: 'exact', head: true })
        .gte('joined_at', todayISO);
      newToday = ntCount || 0;

      const { count: atCount } = await supabase.from('sellers')
        .select('id', { count: 'exact', head: true })
        .gte('last_active_at', todayISO);
      activeToday = atCount || 0;

      // Note: check for NULL or empty string
      const { count: wtCount } = await supabase.from('sellers')
        .select('id', { count: 'exact', head: true })
        .or('wb_token.eq."",wb_token.is.null');
      withoutToken = wtCount || 0;

      const { count: taCount } = await supabase.from('review_logs')
        .select('id', { count: 'exact', head: true })
        .in('status', ['approved', 'auto_posted']);
      totalApproved = taCount || 0;
    } catch (dbError) {
      console.error('[AdminStats] Database query error:', dbError);
    }

    res.json({
      totalSellers,
      newToday,
      activeToday,
      withoutToken,
      totalApproved,
      totalSubscribed
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// Admin: Get all users
router.get('/admin/users', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    if (sellerId !== process.env.ADMIN_SELLER_ID && sellerId !== config.adminId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { data, error } = await supabase
      .from('sellers')
      .select('id, email, display_name, auth_provider, subscription_status, wb_token, joined_at, last_active_at')
      .order('last_active_at', { ascending: false });
      
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Analytics data
router.get('/analytics', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const seller = await getSeller(sellerId);
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    const { data: reviews, error } = await supabase
      .from('review_logs')
      .select('rating, category, sentiment')
      .eq('seller_id', seller.id)
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

// Manual sync trigger
const reviewService = require('../services/reviewService');
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const seller = await getSeller(sellerId);
    
    if (!seller || !seller.wb_token) {
      return res.status(400).json({ error: 'Добавьте WB Токен в настройках' });
    }

    console.log(`[Manual Sync] Triggering for seller ${seller.id}`);
    await reviewService.processSellerReviews(seller);
    
    res.json({ success: true, message: 'Синхронизация запущена!' });
  } catch (error) {
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

// Admin: Get all tickets
router.get('/admin/support', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    if (sellerId !== process.env.ADMIN_SELLER_ID && sellerId !== config.adminId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*, sellers(email, display_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Reply to a ticket
router.post('/admin/support/:id/reply', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    if (sellerId !== process.env.ADMIN_SELLER_ID && sellerId !== config.adminId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { reply } = req.body;
    
    const { data, error } = await supabase
      .from('support_tickets')
      .update({ admin_reply: reply, status: 'replied', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
      
    if (error) throw error;
    res.json({ success: true, ticket: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
