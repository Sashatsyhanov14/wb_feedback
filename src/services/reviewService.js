const wbService = require('./wbService');
const aiService = require('./aiService');
const supabase = require('../db/supabase');

class ReviewService {
  /**
   * Main synchronization loop for a specific shop
   */
  async processShopReviews(shop) {
    if (!shop || !shop.wb_token) return;

    // --- Subscription Check (from seller, not shop) ---
    const seller = shop.sellers || {};
    const now = new Date();
    const expiresAt = seller.subscription_expires_at ? new Date(seller.subscription_expires_at) : null;
    
    if (expiresAt && now > expiresAt) {
      console.log(`[ReviewService] Subscription EXPIRED for shop ${shop.name} (Seller: ${shop.seller_id})`);
      return;
    }

    try {
      console.log(`[ReviewService] Starting Sync for shop: ${shop.name} (${shop.id})`);
      
      const response = await wbService.getReviews(false, 30, 0, { token: shop.wb_token });
      const reviews = response?.data?.feedbacks || [];
      
      console.log(`[ReviewService] Found ${reviews.length} unanswered reviews`);

      for (const review of reviews) {
        // Skip if already processed
        const { data: existing } = await supabase
          .from('review_logs')
          .select('id, status')
          .eq('shop_id', shop.id)
          .eq('review_id', review.id)
          .maybeSingle();

        if (existing && (existing.status === 'auto_posted' || existing.status === 'approved' || existing.status === 'rejected')) {
          continue;
        }

        await this.processSingleReview(shop, review, existing?.id);
        
        // Rate limit
        await this._delay(400);
      }
    } catch (error) {
      console.error(`[ReviewService] Sync error for shop ${shop.id}:`, error.message);
    }
  }

  /**
   * Logic for a single review
   */
  async processSingleReview(shop, feedback, existingLogId = null) {
    try {
      let productMetadata = null;
      try {
        productMetadata = await wbService.getProductMetadata(feedback.nmId, shop.wb_token);
      } catch (metaErr) {
        console.warn(`[ReviewService] Could not fetch product metadata for nmId ${feedback.nmId}:`, metaErr.message);
      }

      // Matrix is still seller-level or shop-level? 
      // Let's assume product_matrix should now be shop-level for better granularity.
      // For now, we'll check by shop_id if column exists, otherwise fallback to seller_id.
      const { data: productMatrix } = await supabase
        .from('product_matrix')
        .select('*')
        .eq('shop_id', shop.id)
        .eq('nm_id', feedback.nmId)
        .maybeSingle();

      let crossSellName = null;
      if (productMatrix?.cross_sell_article) {
        const crossMetadata = await wbService.getProductMetadata(productMatrix.cross_sell_article, shop.wb_token);
        crossSellName = crossMetadata?.name || null;
        await this._delay(350);
      }

      const wbProductName = feedback.productDetails?.productName || '';

      const reviewContext = {
        text: feedback.text,
        pros: feedback.pros || '',
        cons: feedback.cons || '',
        rating: feedback.productValuation
      };
      
      // Use shop as the 'seller' object for aiService (it has brand_name, custom_instructions)
      const aiData = await aiService.generateResponse(reviewContext, productMetadata, productMatrix, shop, { crossSellName });
      if (!aiData || !aiData.text) return;

      const aiResponse = aiData.text;

      console.log(`[ReviewService] Auto-posting to ${feedback.id} in shop ${shop.name}`);
      const posted = await wbService.sendAnswer(feedback.id, aiResponse, shop.wb_token);
      
      await this._delay(350);
      
      if (posted) {
        await this.saveReviewLog(shop, feedback, aiResponse, 'auto_posted', aiData, existingLogId);
      }
    } catch (error) {
      console.error(`[ReviewService] Error in single review ${feedback.id}:`, error.message);
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async saveReviewLog(shop, feedback, response, status, aiData, existingId = null) {
    const logData = {
      seller_id: shop.seller_id,
      shop_id: shop.id,
      review_id: feedback.id,
      review_text: feedback.text,
      product_name: feedback.productDetails?.productName || '',
      nm_id: feedback.nmId,
      rating: feedback.productValuation,
      ai_response_draft: response,
      status: status,
      sentiment: aiData?.sentiment || 'neutral',
      category: aiData?.category || 'Другое'
    };

    if (existingId) {
      const { data } = await supabase.from('review_logs').update(logData).eq('id', existingId).select();
      return data?.[0]?.id;
    } else {
      const { data } = await supabase.from('review_logs').insert([logData]).select();
      return data?.[0]?.id;
    }
  }

  async processAllSellers() {
    try {
      const { data: shops, error } = await supabase
        .from('shops')
        .select('*, sellers(id, auth_provider, subscription_status, subscription_expires_at)');
      
      if (error) throw error;
      if (!shops) return;

      for (const shop of shops) {
        // Skip shops belonging to guest accounts
        if (shop.sellers?.auth_provider === 'guest') continue;
        
        if (shop.wb_token && shop.wb_token !== 'pending') {
          await this.processShopReviews(shop);
        }
      }
    } catch (error) {
      console.error('[ReviewService] ProcessAll Error:', error);
    }
  }
}

module.exports = new ReviewService();
