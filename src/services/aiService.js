const axios = require('axios');
const config = require('../config');

const POLZA_AI_BASE_URL = 'https://polza.ai/api/v1';

class AIService {
  constructor() {
    this.apiKey = config.polzaAiApiKey;
    this.client = axios.create({
      baseURL: POLZA_AI_BASE_URL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Generate an answer to a review
   * @param {string} reviewText - The text of the review from WB
   * @param {object} productMetadata - Product name, description, characteristics
   * @param {object} productMatrix - Internal name, cross-sell info
   * @param {object} sellerSettings - Brand name, seller description, custom instructions
   * @param {string} model - The model to use (default: nex-agi/deepseek-v3.1-nex-n1)
   */
  async generateResponse(reviewText, productMetadata, productMatrix, sellerSettings = {}, model = 'nex-agi/deepseek-v3.1-nex-n1') {
    try {
      const systemPrompt = this._buildSystemPrompt(productMetadata, productMatrix, sellerSettings);
      
      const response = await this.client.post('/chat/completions', {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Текст отзыва: "${reviewText}".\n\nВЕРНИ ОТВЕТ В ФОРМАТЕ JSON: {"text": "текст ответа", "category": "категория(Качество/Доставка/Цена/Другое)", "sentiment": "positive/neutral/negative"}` }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      });

      const content = JSON.parse(response.data?.choices?.[0]?.message?.content || '{}');
      return content;
    } catch (error) {
      console.error('Error generating AI response via Polza AI:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Internal helper to build the prompt for AI
   */
  _buildSystemPrompt(product, matrix, seller) {
    const brandName = seller?.brand_name || 'нашего магазина';
    const productName = matrix?.product_name || product?.name || 'товар';
    
    let prompt = `Ты — вежливый менеджер магазина "${brandName}" на Wildberries. Твоя задача — написать ответ на отзыв покупателя.`;

    if (seller?.seller_description) {
      prompt += `\n\nИнформация о бренде/магазине:\n${seller.seller_description}`;
    }

    prompt += `\n\nИнформация о товаре:
Название: ${productName}`;

    if (product?.description) prompt += `\nОписание: ${product.description}`;
    
    if (product?.characteristics) {
      const characteristics = product.characteristics.map(c => `- ${c.name}: ${c.value}`).join('\n');
      prompt += `\nХарактеристики:\n${characteristics}`;
    }

    if (matrix?.cross_sell_article) {
      prompt += `\n\nСПЕЦИАЛЬНОЕ ЗАДАНИЕ (Cross-sell): В конце ответа ненавязчиво порекомендуй покупателю обратить внимание на наш другой товар (артикул ${matrix.cross_sell_article}). ${matrix.cross_sell_description || ''}`;
    }

    if (seller?.custom_instructions) {
      prompt += `\n\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ОТ ПРОДАВЦА:\n${seller.custom_instructions}`;
    }

    prompt += `
\nПравила ответа:
1. Будь вежливым и профессиональным. Всегда обращайся на "Вы".
2. Поблагодари за высокую оценку, если она 4 или 5.
3. Посочувствуй и предложи решение, если оценка низкая. Не используй шаблоны.
4. Используй информацию о товаре, чтобы ответ был персонализированным.
5. Пиши кратко (до 300 символов), но по делу.`;

    return prompt;
  }
}

module.exports = new AIService();
