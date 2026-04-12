const axios = require('axios');
const config = require('../config');

const WB_FEEDBACK_API_URL = 'https://feedbacks-api.wildberries.ru';
const WB_CONTENT_API_URL = 'https://content-api.wildberries.ru';

class WBService {
  constructor() {
    this.client = axios.create({
      timeout: 10000 // 10s timeout
    });
  }

  /**
   * Validates if the WB token is active and correct
   * @param {string} token - WB API token to validate
   * @returns {Promise<boolean>}
   */
  async validateToken(token) {
    try {
      // Small request to check if token is valid
      await this.client.get(`${WB_FEEDBACK_API_URL}/api/v1/feedbacks`, {
        headers: this._getHeaders(token),
        params: { take: 1, skip: 0, isAnswered: false }
      });
      return true;
    } catch (error) {
      if (error.response?.status === 401) return false;
      console.error('Token validation error:', error.response?.data || error.message);
      // If it's another error (500 etc), we might want to return false or throw
      return false;
    }
  }

  /**
   * Internal helper to get headers with token
   * @param {string} token - WB API token
   */
  _getHeaders(token) {
    const activeToken = token || config.wbToken;
    return {
      'Authorization': activeToken,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Fetch reviews from Wildberries
   * @param {boolean} isAnswered - Filter for answered/unanswered reviews
   * @param {number} take - Number of reviews to fetch (max 5000)
   * @param {number} skip - Offset for pagination
   * @param {object} options - Additional filters (nmId, order, dateFrom, dateTo, token)
   */
  async getReviews(isAnswered = false, take = 10, skip = 0, options = {}) {
    try {
      const { token, ...params } = options;
      const response = await this.client.get(`${WB_FEEDBACK_API_URL}/api/v1/feedbacks`, {
        headers: this._getHeaders(token),
        params: {
          isAnswered,
          take,
          skip,
          ...params
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
   * @param {string} token - WB API token
   */
  async getProductMetadata(nmId, token) {
    try {
      const response = await this.client.post(`${WB_CONTENT_API_URL}/content/v2/get/cards/list`, {
        settings: {
          cursor: { limit: 1 },
          filter: {
            withPhoto: -1,
            textSearch: String(nmId)
          }
        }
      }, {
        headers: this._getHeaders(token)
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
   * @param {string} token - WB API token
   */
  async sendAnswer(feedbackId, text, token) {
    try {
      const response = await this.client.post(`${WB_FEEDBACK_API_URL}/api/v1/feedbacks/answer`, {
        id: feedbackId,
        text: text
      }, {
        headers: this._getHeaders(token)
      });
      return response.status === 204;
    } catch (error) {
      console.error('Error sending WB answer:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new WBService();
