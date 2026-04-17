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
  async generateResponse(reviewText, productMetadata, productMatrix, sellerSettings = {}, extraContext = {}, model = 'nex-agi/deepseek-v3.1-nex-n1') {
    try {
      const systemPrompt = this._buildSystemPrompt(productMetadata, productMatrix, sellerSettings, extraContext);
      
      const response = await this.client.post('/chat/completions', {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Текст отзыва: "${reviewText}".\n\nВЕРНИ ОТВЕТ В ФОРМАТЕ JSON: {"text": "текст ответа", "category": "категория(Качество/Доставка/Цена/Другое)", "sentiment": "positive/neutral/negative"}` }
        ],
        temperature: 0.85,
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
  _buildSystemPrompt(product, matrix, seller, extraContext = {}) {
    const brandName = seller?.brand_name || 'нашего магазина';
    const productName = matrix?.product_name || product?.name || 'товар';
    const customInstructions = seller?.custom_instructions || 'Радушный и дружелюбный владелец';
    const crossSellName = extraContext.crossSellName;
    
    // HUMAN-ONLY PROMPT (NO "DONT DO THIS", ONLY "BE THIS")
    let prompt = `Твоя личность: ${customInstructions}.
Ты — реальный человек, создатель бренда "${brandName}". Ты лично отвечаешь покупателям на Wildberries.

СТИЛЬ ОБЩЕНИЯ:
- Пиши очень живо и тепло, будто отвечаешь другу в чате.
- Используй живые человеческие реакции: радость, сопереживание, искренность. 
- Твоя речь простая и лаконичная. 
- Говори только от своего имени (Я, МЫ). 
- НИКАКИХ ЭМОДЗИ — используй только слова для передачи чувств.

ТЫ ОТВЕЧАЕШЬ НА ОТЗЫВ О ТОВАРЕ: "${productName}".`;

    if (product?.description) prompt += `\nКраткая информация о товаре: ${product.description.slice(0, 250)}`;

    // ADD CROSS-SELL IF PRESENT
    if (matrix?.cross_sell_article) {
      const prodName = crossSellName ? `"${crossSellName}"` : 'нашу другую модель';
      prompt += `\n\nСПЕЦИАЛЬНОЕ ЗАДАНИЕ: В конце ответа по-дружески упомяни ${prodName} (артикул: ${matrix.cross_sell_article}). 
Сделай это нативно, объяснив почему это круто: "${matrix.cross_sell_description || 'Вам точно понравится!'}"`;
    }

    prompt += `\n\nОГРАНИЧЕНИЕ: Твой ответ должен быть не длиннее 280 символов.`;

    return prompt;
  }

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
