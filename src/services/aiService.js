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
   * @param {object|string} reviewInput - review context {text, pros, cons, rating} or plain text
   */
  async generateResponse(reviewInput, productMetadata, productMatrix, sellerSettings = {}, extraContext = {}, model = 'nex-agi/deepseek-v3.1-nex-n1') {
    try {
      // Support both old (string) and new (object) format
      const reviewText = typeof reviewInput === 'string' ? reviewInput : reviewInput.text;
      const reviewPros = typeof reviewInput === 'object' ? reviewInput.pros : '';
      const reviewCons = typeof reviewInput === 'object' ? reviewInput.cons : '';
      const reviewRating = typeof reviewInput === 'object' ? reviewInput.rating : null;

      const systemPrompt = this._buildSystemPrompt(productMetadata, productMatrix, sellerSettings, extraContext);
      
      // Build user message with full review context
      let userMessage = `Текст отзыва: "${reviewText}".`;
      if (reviewPros) userMessage += `\nДостоинства (от покупателя): "${reviewPros}".`;
      if (reviewCons) userMessage += `\nНедостатки (от покупателя): "${reviewCons}".`;
      if (reviewRating) userMessage += `\nОценка: ${reviewRating} из 5.`;
      userMessage += `\n\nВЕРНИ ОТВЕТ В ФОРМАТЕ JSON: {"text": "текст ответа", "category": "категория(Качество/Доставка/Цена/Другое)", "sentiment": "positive/neutral/negative"}`;

      const response = await this.client.post('/chat/completions', {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
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
    const productName = matrix?.product_name || product?.name || 'товар';
    const customInstructions = seller?.custom_instructions || 'Радушный и дружелюбный продавец';
    const crossSellName = extraContext.crossSellName;
    
    // HUMAN-ONLY PROMPT (NO "DONT DO THIS", ONLY "BE THIS")
    let prompt = `Твоя личность: ${customInstructions}.
Ты — реальный человек, официальный представитель магазина. Ты лично отвечаешь покупателям на Wildberries.

СТИЛЬ ОБЩЕНИЯ:
- Пиши очень живо и тепло, будто отвечаешь другу в чате.
- Используй живые человеческие реакции: радость, сопереживание, искренность. 
- Твоя речь простая и лаконичная. 
- Говори только от своего имени (Я, МЫ). 
- НИКАКИХ ЭМОДЗИ — используй только слова для передачи чувств.

ТЫ ОТВЕЧАЕШЬ НА ОТЗЫВ О ТОВАРЕ: "${productName}".`;

    // Add product description from Content API
    if (product?.description) prompt += `\nОписание товара: ${product.description.slice(0, 300)}`;

    // Add product characteristics from Content API
    if (product?.characteristics && product.characteristics.length > 0) {
      const charsList = product.characteristics
        .slice(0, 8) // Limit to avoid overly long prompts
        .map(c => `${c.name}: ${Array.isArray(c.value) ? c.value.join(', ') : c.value}`)
        .join('; ');
      prompt += `\nХарактеристики товара: ${charsList}`;
    }

    // ADD CROSS-SELL IF PRESENT
    if (matrix?.cross_sell_article) {
      const prodName = crossSellName ? `"${crossSellName}"` : 'нашу другую модель';
      prompt += `\n\nСПЕЦИАЛЬНОЕ ЗАДАНИЕ: В конце ответа по-дружески упомяни ${prodName} (артикул: ${matrix.cross_sell_article}). 
Сделай это нативно, объяснив почему это круто: "${matrix.cross_sell_description || 'Вам точно понравится!'}"`;
    }

    prompt += `\n\nПРАВИЛА МАРКЕТПЛЕЙСА WILDBERRIES (КРИТИЧНО):
1. Логистика: Если клиент жалуется на долгую доставку, помятую/грязную упаковку, вскрытый пакет, подмену или перепутанный товар на ПВЗ — извинись за ситуацию, но мягко объясни, что доставкой, сборкой и хранением занимается сам Wildberries. Посоветуй создать обращение в поддержку WB (Личный кабинет -> Обращения). Мы как продавцы отгружаем товар на склад новым и целым.
2. Брак и возвраты: Если попался бракованный/сломанный товар, строго инструктируй: возврат нужно оформлять ТОЛЬКО через Личный кабинет -> раздел "Проверка товара". Пообещай, что мы обязательно одобрим заявку, чтобы деньги вернулись.
3. Контакты запрещены: Никогда не проси клиента писать в Telegram, WhatsApp, на почту или звонить. Это ведет к блокировке магазина. Если нужно связаться — предлагай писать в раздел "Вопросы" к товару или в "Чат с продавцом".
4. Деньги: Никогда не обещай перевести компенсацию на карту. Все возвраты только через функционал WB.`;

    prompt += `\n\nОГРАНИЧЕНИЕ: Твой ответ должен быть не длиннее 280 символов.`;

    return prompt;
  }

  async generateConsultation(query, history = []) {
    try {
      const systemPrompt = `Ты — экспертный ИИ-ассистент сервиса WBReply AI. Консультируй продавцов кратко (1-2 предложения).
Направляй к alexandertsyhanov@gmail.com по сложным вопросам.`;

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
