const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const wbService = require('../services/wbService');

// Register or update seller (Onboarding)
router.post('/register', async (req, res) => {
  try {
    const { maxUserId, wbToken, brandName, sellerDescription, customInstructions } = req.body;

    if (!maxUserId || !wbToken) {
      return res.status(400).json({ error: 'maxUserId and wbToken are required' });
    }

    // 1. Validate WB Token
    const isValid = await wbService.validateToken(wbToken);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid Wildberries API token' });
    }

    // 2. Upsert seller in DB
    const { data, error } = await supabase
      .from('sellers')
      .upsert({
        max_user_id: maxUserId,
        wb_token: wbToken,
        brand_name: brandName,
        seller_description: sellerDescription,
        custom_instructions: customInstructions
      }, { onConflict: 'max_user_id' })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, seller: data });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all reviews with optional status filter
router.get('/reviews', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase.from('review_logs').select('*').order('created_at', { ascending: false });
    
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
router.get('/settings/:maxUserId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sellers')
      .select('is_auto_reply_enabled, auto_reply_min_rating')
      .eq('max_user_id', req.params.maxUserId)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE seller settings
router.post('/settings/:maxUserId', async (req, res) => {
  try {
    const { is_auto_reply_enabled, auto_reply_min_rating } = req.body;
    const { error } = await supabase
      .from('sellers')
      .update({ is_auto_reply_enabled, auto_reply_min_rating })
      .eq('max_user_id', req.params.maxUserId);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const { data: totalReviews } = await supabase.from('review_logs').select('id', { count: 'exact' });
    const { data: pendingReviews } = await supabase.from('review_logs').select('id', { count: 'exact' }).ilike('status', 'pending%');
    const { data: approvedReviews } = await supabase.from('review_logs').select('id', { count: 'exact' }).in('status', ['approved', 'auto_posted']);

    res.json({
      total: totalReviews?.length || 0,
      pending: pendingReviews?.length || 0,
      approved: approvedReviews?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Product Matrix ---

router.get('/matrix', async (req, res) => {
  try {
    const { data, error } = await supabase.from('product_matrix').select('*');
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/matrix', async (req, res) => {
  try {
    const { nm_id, product_name, cross_sell_article, cross_sell_description } = req.body;
    // For MVP, we'll use a hardcoded seller_id or get it from context
    const { data: seller } = await supabase.from('sellers').select('id').limit(1).single();
    
    const { data, error } = await supabase.from('product_matrix').upsert({
      seller_id: seller.id,
      nm_id,
      product_name,
      cross_sell_article,
      cross_sell_description
    }).select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Analytics data
router.get('/analytics', async (req, res) => {
  try {
    const { data: reviews, error } = await supabase
      .from('review_logs')
      .select('rating, category, sentiment')
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

module.exports = router;
