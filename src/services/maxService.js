const axios = require('axios');
const config = require('../config');

const MAX_API_BASE_URL = 'https://platform-api.max.ru';

class MaxService {
  constructor() {
    this.token = config.maxBotToken;
    this.client = axios.create({
      baseURL: MAX_API_BASE_URL,
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Send a simple text message
   */
  async sendMessage(userId, text) {
    try {
      const response = await this.client.post('/messages', {
        text: text
      }, {
        params: { user_id: userId }
      });
      return response.data;
    } catch (error) {
      console.error('Error sending Max message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send a review draft with a button to open the Mini App
   * @param {string} userId - Max user ID
   * @param {string} reviewId - ID of the review in DB/WB
   * @param {string} draftText - The generated AI response
   */
  async sendReviewDraft(userId, reviewId, draftText) {
    try {
      const payload = {
        text: `💡 Сгенерирован новый ответ на отзыв:\n\n"${draftText}"`,
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [
                [
                  {
                    type: 'open_app',
                    text: '📝 Редактировать / Одобрить',
                    app_id: config.maxAppId,
                    parameters: `review_id=${reviewId}`
                  }
                ]
              ]
            }
          }
        ]
      };

      const response = await this.client.post('/messages', payload, {
        params: { user_id: userId }
      });
      return response.data;
    } catch (error) {
      console.error('Error sending Max draft:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Register webhook URL
   */
  async setWebhook(url) {
    try {
      const response = await this.client.post('/subscriptions', {
        url: url
      });
      return response.data;
    } catch (error) {
      console.error('Error setting Max webhook:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new MaxService();
