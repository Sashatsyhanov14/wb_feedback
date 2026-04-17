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

    try {
      console.log(`[ReviewService] Starting Sync for seller ${seller.telegram_chat_id}`);
      
      const response = await wbService.getReviews(false, 30, 0, { token: seller.wb_token });
      const reviews = response?.data?.feedbacks || [];
      
      console.log(`[ReviewService] Found ${reviews.length} new reviews`);

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
      // 1. Get Product Data
      const { data: productMetadata } = await supabase
        .from('products')
        .select('*')
        .eq('nm_id', feedback.nmId)
        .maybeSingle();

      const { data: productMatrix } = await supabase
        .from('product_matrix')
        .select('*')
        .eq('seller_id', seller.id)
        .eq('nm_id', feedback.nmId)
        .maybeSingle();
      
      console.log(`[ReviewService] Processing feedback ${feedback.id} (Matrix: ${productMatrix ? 'YES' : 'NO'})`);

      // 2. Generate AI Response
      const aiData = await aiService.generateResponse(feedback.text, productMetadata, productMatrix, seller);
      if (!aiData || !aiData.text) return;

      const aiResponse = aiData.text;

      // 3. AUTO-POST ALWAYS
      console.log(`[ReviewService] Auto-posting to ${feedback.id}`);
      const posted = await wbService.sendAnswer(feedback.id, aiResponse, seller.wb_token);
      
      if (posted) {
        await this.saveReviewLog(seller.id, feedback, aiResponse, 'auto_posted', aiData, existingLogId);
        
        // 4. Notify User in requested format
        const productLabel = productMatrix?.product_name || productMetadata?.name || feedback.nmId;
        const notification = `Отзыв (${feedback.productValuation}⭐️):\n` +
          `"${this._escapeHtml(feedback.text)}"\n` +
          `Товар: ${this._escapeHtml(productLabel)}\n\n` +
          ` ответ:\n` +
          `"${this._escapeHtml(aiResponse)}"`;

        await telegramService.sendMessage(seller.telegram_chat_id, notification);
      }
    } catch (error) {
      console.error(`[ReviewService] Error in single review ${feedback.id}:`, error.message);
    }
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
      product_name: feedback.productName || '',
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
