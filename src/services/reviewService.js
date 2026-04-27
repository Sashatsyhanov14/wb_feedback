const wbService = require('./wbService');
const aiService = require('./aiService');
const telegramService = require('./telegramService');
const supabase = require('../db/supabase');

class ReviewService {
  /**
   * Main synchronization loop
   */
  async processSellerReviews(seller) {
    if (!seller || !seller.wb_token) return;

    // --- Subscription Check ---
    const now = new Date();
    const expiresAt = seller.subscription_expires_at ? new Date(seller.subscription_expires_at) : null;
    
    if (expiresAt && now > expiresAt) {
      console.log(`[ReviewService] Subscription EXPIRED for ${seller.telegram_chat_id}`);
      
      // Update status in DB if not already expired
      if (seller.subscription_status !== 'expired') {
        await supabase.from('sellers').update({ subscription_status: 'expired' }).eq('id', seller.id);
        
        // Notify user
        const message = `⚠️ <b>Ваша подписка на WBReply AI истекла!</b>\n\n` +
          `Авто-ответы на отзывы приостановлены. Для возобновления работы, пожалуйста, оплатите тариф (749 руб/мес) в разделе <b>«Аккаунт»</b> внутри Mini App.\n\n` +
          `Если возникли вопросы: @edh4hhr 🚀`;
        await telegramService.sendMessage(seller.telegram_chat_id, message);
      }
      return;
    }

    try {
      console.log(`[ReviewService] Starting Sync for seller ${seller.telegram_chat_id}`);
      
      const response = await wbService.getReviews(false, 30, 0, { token: seller.wb_token });
      const reviews = response?.data?.feedbacks || [];
      
      console.log(`[ReviewService] Found ${reviews.length} unanswered reviews`);

      for (const review of reviews) {
        // Skip if already processed in this state (no update needed if auto_posted)
        const { data: existing } = await supabase
          .from('review_logs')
          .select('id, status')
          .eq('review_id', review.id)
          .maybeSingle();

        if (existing && (existing.status === 'auto_posted' || existing.status === 'approved' || existing.status === 'rejected')) {
          continue;
        }

        await this.processSingleReview(seller, review, existing?.id);
        
        // Rate limit: delay between processing reviews (WB allows 3 req/s)
        await this._delay(400);
      }
    } catch (error) {
      console.error(`[ReviewService] Sync error for ${seller.telegram_chat_id}:`, error.message);
    }
  }

  /**
   * Logic for a single review
   */
  async processSingleReview(seller, feedback, existingLogId = null) {
    try {
      // 1. Get Product Data from WB Content API (real metadata: name, description, characteristics)
      let productMetadata = null;
      try {
        productMetadata = await wbService.getProductMetadata(feedback.nmId, seller.wb_token);
      } catch (metaErr) {
        console.warn(`[ReviewService] Could not fetch product metadata for nmId ${feedback.nmId}:`, metaErr.message);
      }

      // 2. Get product matrix (seller's custom config for this product)
      const { data: productMatrix } = await supabase
        .from('product_matrix')
        .select('*')
        .eq('seller_id', seller.id)
        .eq('nm_id', feedback.nmId)
        .maybeSingle();

      let crossSellName = null;
      if (productMatrix?.cross_sell_article) {
        console.log(`[ReviewService] Fetching metadata for cross-sell article: ${productMatrix.cross_sell_article}`);
        const crossMetadata = await wbService.getProductMetadata(productMatrix.cross_sell_article, seller.wb_token);
        crossSellName = crossMetadata?.name || null;
        // Rate limit: small delay after Content API call
        await this._delay(350);
      }

      // Extract product name from WB API response (productDetails.productName)
      const wbProductName = feedback.productDetails?.productName || '';

      console.log(`[ReviewService] Processing feedback ${feedback.id} | Product: "${wbProductName}" | Matrix: ${productMatrix ? 'YES' : 'NO'} | Metadata: ${productMetadata ? 'YES' : 'NO'}`);

      // 3. Generate AI Response (pass pros, cons, and full review context)
      const reviewContext = {
        text: feedback.text,
        pros: feedback.pros || '',
        cons: feedback.cons || '',
        rating: feedback.productValuation
      };
      const aiData = await aiService.generateResponse(reviewContext, productMetadata, productMatrix, seller, { crossSellName });
      if (!aiData || !aiData.text) return;

      const aiResponse = aiData.text;

      // 4. AUTO-POST ALWAYS
      console.log(`[ReviewService] Auto-posting to ${feedback.id}`);
      const posted = await wbService.sendAnswer(feedback.id, aiResponse, seller.wb_token);
      
      // Rate limit: delay after posting answer
      await this._delay(350);
      
      if (posted) {
        await this.saveReviewLog(seller.id, feedback, aiResponse, 'auto_posted', aiData, existingLogId);
        
        // 5. Notify User in requested format
        const productLabel = productMatrix?.product_name || productMetadata?.name || wbProductName || feedback.nmId;
        const notification = `Отзыв (${feedback.productValuation}⭐️):\n` +
          `"${this._escapeHtml(feedback.text)}"\n` +
          `Товар: ${this._escapeHtml(String(productLabel))}\n\n` +
          `Ответ ИИ:\n` +
          `"${this._escapeHtml(aiResponse)}"`;

        await telegramService.sendMessage(seller.telegram_chat_id, notification);
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

  async saveReviewLog(sellerId, feedback, response, status, aiData, existingId = null) {
    const logData = {
      seller_id: sellerId,
      review_id: feedback.id,
      review_text: feedback.text,
      product_name: feedback.productDetails?.productName || '',
      nm_id: feedback.nmId,
      rating: feedback.productValuation,
      ai_response_draft: response,
      status: status,
      sentiment: aiData?.sentiment || 'netural',
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
      const { data: sellers } = await supabase.from('sellers').select('*');
      if (!sellers) return;
      for (const seller of sellers) {
        if (seller.wb_token && seller.wb_token !== 'pending') {
          await this.processSellerReviews(seller);
        }
      }
    } catch (error) {
      console.error('[ReviewService] ProcessAll Error:', error);
    }
  }
}

module.exports = new ReviewService();
