const axios = require('axios');
const config = require('../config');

const WB_FEEDBACK_API_URL = 'https://feedbacks-api.wildberries.ru';
const WB_CONTENT_API_URL = 'https://content-api.wildberries.ru';

class WBService {
  constructor(token) {
    this.token = token || config.wbToken;
    this.client = axios.create({
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Fetch reviews from Wildberries
   * @param {boolean} isAnswered - Filter for answered/unanswered reviews
   * @param {number} take - Number of reviews to fetch (max 5000)
   * @param {number} skip - Offset for pagination
   * @param {object} options - Additional filters (nmId, order, dateFrom, dateTo)
   */
  async getReviews(isAnswered = false, take = 10, skip = 0, options = {}) {
    try {
      const response = await this.client.get(`${WB_FEEDBACK_API_URL}/api/v1/feedbacks`, {
        params: {
          isAnswered,
          take,
          skip,
          ...options
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching WB reviews:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch product metadata (context) for AI
   * @param {number|string} nmId - Wildberries article number
   */
  async getProductMetadata(nmId) {
    try {
      const response = await this.client.post(`${WB_CONTENT_API_URL}/content/v2/get/cards/list`, {
        settings: {
          cursor: { limit: 1 },
          filter: {
            withPhoto: -1,
            textSearch: String(nmId)
          }
        }
      });

      const card = response.data?.cards?.[0];
      if (!card) return null;

      return {
        name: card.title,
        description: card.description,
        characteristics: card.characteristics || []
      };
    } catch (error) {
      console.error('Error fetching WB product metadata:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Send a reply to a review
   * @param {string} feedbackId - Unique review ID
   * @param {string} text - Reply text (2-5000 chars)
   */
  async sendAnswer(feedbackId, text) {
    try {
      const response = await this.client.post(`${WB_FEEDBACK_API_URL}/api/v1/feedbacks/answer`, {
        id: feedbackId,
        text: text
      });
      return response.status === 204;
    } catch (error) {
      console.error('Error sending WB answer:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new WBService();
