const wbService = require('./wbService');
const aiService = require('./aiService');
const telegramService = require('./telegramService');
const cacheService = require('./cacheService');
const supabase = require('../db/supabase');

class ReviewService {
  /**
   * Main entry point for processing new reviews
   */
  async processNewReviews() {
    try {
      console.log('[ReviewService] Starting global review processing...');
      // 1. Get all sellers from DB in batches for scalability
      let hasMore = true;
      let offset = 0;
      const limit = 50;

      while (hasMore) {
        const { data: sellers, error } = await supabase
          .from('sellers')
          .select('*')
          .range(offset, offset + limit - 1);

        if (error) throw error;
        if (!sellers || sellers.length === 0) break;

        // Process sellers in parallel with controlled concurrency
        await Promise.allSettled(sellers.map(seller => this.processSellerReviews(seller)));

        offset += limit;
        if (sellers.length < limit) hasMore = false;
      }
      console.log('[ReviewService] Global processing finished.');
    } catch (error) {
      console.error('Error in processNewReviews:', error.message);
    }
  }

  /**
   * Process reviews for a specific seller
   */
  async processSellerReviews(seller) {
    try {
      // 2. Fetch unanswered reviews from WB (limit to 20 for one pass)
      const reviewsData = await wbService.getReviews(false, 20, 0, { token: seller.wb_token });
      const feedbacks = reviewsData?.data?.feedbacks || [];

      for (const feedback of feedbacks) {
        await this.processSingleReview(seller, feedback);
      }
    } catch (error) {
      console.error(`Error processing reviews for seller ${seller.id}:`, error.message);
    }
  }

  /**
   * Process a single review: get context, generate AI response, and send (if auto) or draft
   */
  async processSingleReview(seller, feedback) {
    try {
      // 3. Check if we already processed this review (Optimized with index)
      const { data: existingLog } = await supabase
        .from('review_logs')
        .select('id')
        .eq('review_id', feedback.id)
        .eq('seller_id', seller.id)
        .single();

      if (existingLog) return; 

      // 4. Get product context with Caching
      const cacheKey = `product_meta_${feedback.nmId}`;
      let productMetadata = cacheService.get(cacheKey);

      if (!productMetadata) {
        productMetadata = await wbService.getProductMetadata(feedback.nmId, seller.wb_token);
        if (productMetadata) {
          cacheService.set(cacheKey, productMetadata, 1440); // Cache for 24 hours
        }
      }

      // 5. Get internal product settings from Matrix
      const { data: productMatrix } = await supabase
        .from('product_matrix')
        .select('*')
        .eq('nm_id', feedback.nmId)
        .eq('seller_id', seller.id)
        .single();

      // 6. Generate AI response (now returns JSON)
      const aiData = await aiService.generateResponse(feedback.text, productMetadata, productMatrix, seller);
      if (!aiData || !aiData.text) return;

      const aiResponse = aiData.text;

      // 7. Handle sending logic
      const isBadReview = feedback.productValuation <= 3;
      const canAutoReply = seller.is_auto_reply_enabled && (
        (!isBadReview && feedback.productValuation >= (seller.auto_reply_min_rating || 4)) || 
        (isBadReview && seller.respond_to_bad_reviews)
      );

      if (canAutoReply) {
        // Auto-send to WB
        const success = await wbService.sendAnswer(feedback.id, aiResponse, seller.wb_token);
        if (success) {
          await this.logReview(seller.id, feedback, aiResponse, 'auto_posted', aiData.category, aiData.sentiment);
          await telegramService.sendMessage(seller.telegram_chat_id, `✅ Отзыв на артикул ${feedback.nmId} (${feedback.productValuation}⭐) обработан автоматически.\n\nТекст ответа: "${aiResponse}"`);
        }
      } else {
        // Send draft to Telegram Bot
        const logStatus = seller.is_auto_reply_enabled ? 'pending_low_rating' : 'pending';
        const logId = await this.logReview(seller.id, feedback, aiResponse, logStatus, aiData.category, aiData.sentiment);
        
        await telegramService.sendReviewDraft(seller.telegram_chat_id, logId, aiResponse);
      }
    } catch (error) {
      console.error(`Error processing review ${feedback.id}:`, error.message);
    }
  }

  /**
   * Log review processing to DB
   */
  async logReview(sellerId, feedback, draftText, status, category, sentiment) {
    const { data, error } = await supabase.from('review_logs').insert({
      seller_id: sellerId,
      review_id: feedback.id,
      text: feedback.text,
      rating: feedback.productValuation,
      nm_id: feedback.nmId,
      ai_response_draft: draftText,
      status: status,
      category: category,
      sentiment: sentiment
    }).select().single();

    if (error) throw error;
    return data.id;
  }
}

module.exports = new ReviewService();
