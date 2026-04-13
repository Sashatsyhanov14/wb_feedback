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
    if (token === 'MOCK_TOKEN') return true;
    try {
      // Small request to check if token is valid
      await this.client.get(`${WB_FEEDBACK_API_URL}/api/v1/feedbacks`, {
        headers: this._getHeaders(token),
        params: { take: 1, skip: 0, isAnswered: false }
      });
      return true;
    } catch (error) {
      // ...
      if (error.response?.status === 401) return false;
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
   * Fetch reviews from Wildberries (Mock support added)
   */
  async getReviews(isAnswered = false, take = 10, skip = 0, options = {}) {
    const { token, ...params } = options;
    
    // MOCK MODE
    if (token === 'MOCK_TOKEN') {
      return {
        data: {
          feedbacks: [
            {
              id: 'mock_rev_1',
              text: 'Очень классное платье! Цвет как на фото, размер подошел.',
              productValuation: 5,
              nmId: 123456,
              createdDate: new Date().toISOString()
            },
            {
              id: 'mock_rev_2',
              text: 'Приехал рваный пакет, товар испачкан. Ужасно!',
              productValuation: 1,
              nmId: 123456,
              createdDate: new Date().toISOString()
            }
          ]
        }
      };
    }

    try {
      const response = await this.client.get(`${WB_FEEDBACK_API_URL}/api/v1/feedbacks`, {
        headers: this._getHeaders(token),
        params: { isAnswered, take, skip, ...params }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching WB reviews:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch product metadata (Mock support added)
   */
  async getProductMetadata(nmId, token) {
    if (token === 'MOCK_TOKEN') {
      return {
        name: 'Платье вечернее Silk',
        description: 'Элегантное платье из натурального шелка.',
        characteristics: [{ name: 'Материал', value: 'Шелк 100%' }]
      };
    }

    try {
      const response = await this.client.post(`${WB_CONTENT_API_URL}/content/v2/get/cards/list`, {
        settings: { cursor: { limit: 1 }, filter: { nmIDs: [Number(nmId)] } }
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
   * Send a reply to a review (Mock support added)
   */
  async sendAnswer(feedbackId, text, token) {
    if (token === 'MOCK_TOKEN') {
      console.log(`[MOCK] Sending answer to ${feedbackId}: "${text}"`);
      return true;
    }

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
