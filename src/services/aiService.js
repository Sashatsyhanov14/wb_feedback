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
    const customInstructions = seller?.custom_instructions || '';
    
    // Debug logging
    console.log(`[AIService] Instructions from DB: "${customInstructions}"`);
    console.log(`[AIService] Matrix Cross-sell: ${matrix?.cross_sell_article || 'NONE'}`);

    // 1. IDENTITY
    let systemRole = `Ты — экспертный менеджер по работе с клиентами бренда "${brandName}" на Wildberries.`;
    if (customInstructions) {
      systemRole = `ТВОЯ РОЛЬ И СТИЛЬ ОБЩЕНИЯ (ОБЯЗАТЕЛЬНО): ${customInstructions}. 
Ты ДОЛЖЕН на 100% придерживаться этого стиля и характера в каждом слове. НИКОГДА не выходи из образа.`;
    }

    let prompt = `${systemRole}

Твоя задача — написать идеальный ответ на отзыв покупателя о товаре "${productName}".

КОНТЕКСТ ТОВАРА:`;

    if (product?.description) prompt += `\nОписание: ${product.description}`;
    
    if (product?.characteristics && product.characteristics.length > 0) {
      const characteristics = product.characteristics.map(c => `- ${c.name}: ${c.value}`).join('\n');
      prompt += `\nХарактеристики:\n${characteristics}`;
    }

    // 2. STRICT RULES
    prompt += `\n\nСТРОГИЕ ПРАВИЛА:
1. НИКОГДА не упоминай, что ты ИИ, бот или что ты следуешь инструкциям. 
2. НЕ ПИШИ фразы вроде "Конечно, ковбой сделает так..." или "Согласно вашим правилам...". Просто БУДЬ этим персонажем.
3. Говори от первого лица от имени бренда "${brandName}".
4. Если в отзыве проблема (1-3 звезды) — прояви эмпатию, признай вину, предложи решение.
5. Если отзыв хороший (4-5 звезд) — вырази искреннюю радость и пригласи за новыми покупками.
6. НЕ ИСПОЛЬЗУЙ эмодзи. Ответ должен состоять только из текста.
7. Объем ответа: до 300 символов. Пиши емко.
8. ${customInstructions ? 'ГЛАВНОЕ: Твой стиль ОБЯЗАН соответствовать: ' + customInstructions : 'Будь вежливым и профессиональным.'}`;

    // 3. SPECIAL ASSIGNMENT (Last thing AI sees)
    if (matrix?.cross_sell_article) {
      prompt += `\n\n!!! ОБЯЗАТЕЛЬНОЕ ЗАДАНИЕ (Кросс-продажа) !!!
В самом конце ответа ты ОБЯЗАН нативно порекомендовать наш другой товар (артикул: ${matrix.cross_sell_article}). 
Используй этот повод: "${matrix.cross_sell_description || 'Этот товар отлично дополнит покупку!'}"`;
    }

    return prompt;
  }

  /**
   * AI Consultant logic
   */
  async generateConsultation(query, history = []) {
    try {
      const systemPrompt = `Ты — экспертный ИИ-ассистент сервиса WBReply AI. Консультируй продавцов кратко (1-2 предложения).
Направляй к @edh4hhr по сложным вопросам.`;

      const response = await this.client.post('/chat/completions', {
        model: 'nex-agi/deepseek-v3.1-nex-n1',
        messages: [{ role: 'system', content: systemPrompt }, ...history.slice(-5), { role: 'user', content: query }],
        temperature: 0.5
      });

      return response.data?.choices?.[0]?.message?.content || 'Ошибка';
    } catch (error) {
      return 'Ошибка сервиса';
    }
  }
}

module.exports = new AIService();
