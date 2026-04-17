const wbService = require('./wbService');
const aiService = require('./aiService');
const telegramService = require('./telegramService');
const supabase = require('../db/supabase');

class ReviewService {
  /**
   * Main cron/sync entry point
   */
  async processAllSellers() {
    console.log('[ReviewService] Starting processing for all sellers...');
    try {
      const { data: sellers, error } = await supabase
        .from('sellers')
        .select('*')
        .not('wb_token', 'is', null);

      if (error) throw error;
      if (!sellers || sellers.length === 0) return;

      for (const seller of sellers) {
        await this.processSellerReviews(seller);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error('[ReviewService] Process all error:', error.message);
    }
  }

  /**
   * Fetch and process new reviews for one seller
   */
  async processSellerReviews(seller) {
    try {
      console.log(`[ReviewService] Processing reviews for ${seller.brand_name || seller.telegram_chat_id}...`);
      
      const response = await wbService.getReviews(false, 30, 0, { token: seller.wb_token });
      const reviews = response?.data?.feedbacks || [];
      
      if (reviews.length === 0) return;

      for (const review of reviews) {
        // Check if already handled or exists as pending
        const { data: existing } = await supabase
          .from('review_logs')
          .select('id, status')
          .eq('review_id', review.id)
          .maybeSingle();

        // If it was already posted, skip
        if (existing && (existing.status === 'auto_posted' || existing.status === 'approved' || existing.status === 'rejected')) {
          continue;
        }

        // If it exists as 'pending', we RE-PROCESS it to apply new styles
        const isUpdate = existing && existing.status === 'pending';
        await this.processSingleReview(seller, review, isUpdate ? existing.id : null);
      }
    } catch (error) {
      console.error(`[ReviewService] Error for seller ${seller.id}:`, error.message);
    }
  }

  /**
   * Core logic for a single review
   */
  async processSingleReview(seller, feedback, existingLogId = null) {
    try {
      const productMetadata = await wbService.getProductMetadata(feedback.nmId, seller.wb_token);

      const { data: productMatrix } = await supabase
        .from('product_matrix')
        .select('*')
        .eq('seller_id', seller.id)
        .eq('nm_id', feedback.nmId)
        .maybeSingle(); // maybeSingle instead of single to prevent errors if not found
      
      console.log(`[ReviewService] Matrix lookup for nmId ${feedback.nmId}: ${productMatrix ? 'FOUND (' + productMatrix.cross_sell_article + ')' : 'NOT FOUND'}`);
      
      console.log(`[ReviewService] Processing review for seller instructions: "${seller.custom_instructions || 'MISSING'}"`);
      const aiData = await aiService.generateResponse(feedback.text, productMetadata, productMatrix, seller);
      if (!aiData || !aiData.text) return;

      const aiResponse = aiData.text;
      
      // USER REQUEST: Auto-reply is ALWAYS true
      const canAutoReply = true;

      if (canAutoReply) {
        console.log(`[ReviewService] Auto-replying to review ${feedback.id}`);
        const success = await wbService.sendAnswer(feedback.id, aiResponse, seller.wb_token);
        
        if (success) {
          await this.saveReviewLog(seller.id, feedback, aiResponse, 'auto_posted', aiData, existingLogId);
          
          // USER REQUESTED TEMPLATE:
          // Отзыв (5⭐️):
          // "Текст отзыва"
          // Товар: Название
          // 
          // ответ:
          // "Текст ответа"
          const template = `Отзыв (${feedback.productValuation}⭐️):\n` +
            `"${this._escapeHtml(feedback.text)}"\n` +
            `Товар: ${this._escapeHtml(productMetadata?.name || feedback.nmId)}\n\n` +
            `ответ:\n` +
            `"${this._escapeHtml(aiResponse)}"`;

          await telegramService.sendMessage(seller.telegram_chat_id, template);
          return;
        }
      }

      // If not auto-replying, save as draft and notify
      const logId = await this.saveReviewLog(seller.id, feedback, aiResponse, 'pending', aiData, existingLogId);
      
      const productInfo = productMatrix?.product_name || productMetadata?.name || feedback.nmId;
      await telegramService.sendReviewDraft(seller.telegram_chat_id, logId, aiResponse, {
        reviewText: feedback.text,
        rating: feedback.productValuation,
        productInfo: productInfo,
        nmId: feedback.nmId
      });

    } catch (error) {
      console.error(`[ReviewService] Error processing review ${feedback.id}:`, error.message);
    }
  }

  /**
   * Unified save/update log
   */
  async saveReviewLog(sellerId, feedback, response, status, aiData, existingId = null) {
    const logData = {
      seller_id: sellerId,
      review_id: feedback.id,
      nm_id: feedback.nmId,
      text: feedback.text,
      rating: feedback.productValuation,
      ai_response_draft: response,
      status: status,
      category: aiData.category,
      sentiment: aiData.sentiment
    };

    if (existingId) {
      const { error } = await supabase.from('review_logs').update(logData).eq('id', existingId);
      if (error) throw error;
      return existingId;
    } else {
      const { data, error } = await supabase.from('review_logs').insert(logData).select().single();
      if (error) throw error;
      return data.id;
    }
  }

  _escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}

module.exports = new ReviewService();
