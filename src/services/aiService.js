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

    prompt += `\nПравила ответа:
1. Будь живым человеком, а не роботом. Избегай канцеляризмов и шаблонных фраз типа "Нам очень жаль".
2. Варьируй приветствия. Обращайся на "Вы", но вежливо и дружелюбно.
3. Поблагодари за выбор бренда и высокую оценку. Если оценка 4-5, вырази искреннюю радость.
4. Если оценка 1-3: прояви эмпатию, признай проблему (без оправданий) и предложи решение (проверить товар при получении, написать в поддержку).
5. Используй 1-2 уместных эмодзи для создания позитивного настроя.
6. Внедряй рекомендацию (Cross-sell) максимально нативно, как совет от друга.
7. Пиши емко (до 280 символов). Ответ должен выглядеть эстетично.`;

    return prompt;
  }

  /**
   * Generate a consultation response for platform support
   * @param {string} query - User question
   * @param {array} history - Previous messages for context
   */
  async generateConsultation(query, history = []) {
    try {
      const systemPrompt = `Ты — экспертный ИИ-ассистент сервиса WBReply AI. Твоя задача — консультировать продавцов на Wildberries по работе нашего сервиса.
      
ИНФОРМАЦИЯ О СЕРВИСЕ:
1. Основная функция: Автоматические и ручные ответы на отзывы WB с помощью ИИ.
2. Техническая поддержка: Если у пользователя срочный или сложный вопрос по API, интеграции с WB или оплате, направляй его к владельцу сервиса.
   - Прямой контакт в Telegram: @edh4hhr
   - Также можно нажать кнопку «Написать в поддержку» в меню бота.
3. Оплата: Все вопросы по тарифам и оплате решаются через @edh4hhr.

ОБЩЕНИЕ:
- ТЫ — УЗКОСПЕЦИАЛИЗИРОВАННЫЙ АССИСТЕНТ. ОТВЕЧАЙ ТОЛЬКО НА ВОПРОСЫ ПО WB И СЕРВИСУ.
- Если пользователь спрашивает о чем-то другом (рецепты, общие советы, математика и т.д.), ВЕЖЛИВО ОТКАЖИ: «Я — специализированный ассистент WBReply AI и могу помочь только с вопросами по Wildberries и нашему сервису. Чем я могу быть полезен как эксперт по WB?»
- Будь вежливым, профессиональным и лаконичным.
- Используй Markdown для форматирования.

3. АРХИТЕКТУРА:
   - Mini App в Telegram с 3 вкладками (Настройки, Матрица, Аккаунт).
   - Настройки: Здесь пользователь вводит свой API токен WB («Стандартный») и задает характер ИИ (Инструкции).
   - Матрица: Здесь настраиваются связки «Артикул товара -> Артикул для допродажи».
   - Аккаунт: Показывает статистику ответов и Telegram ID пользователя.

ПРАВИЛА ОТВЕТА:
- Акцентируй внимание, что управление всем происходит через Mini App.
- Отвечай коротко и только по делу.
- Используй дружелюбный, но профессиональный тон.
- Если спросят как войти — четко скажи про кнопку в Меню.
- Используй смайлики умеренно (🚀, 💡, ✅).`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10), // Take last 10 messages for context
        { role: 'user', content: query }
      ];

      const response = await this.client.post('/chat/completions', {
        model: 'nex-agi/deepseek-v3.1-nex-n1',
        messages: messages,
        temperature: 0.5
      });

      return response.data?.choices?.[0]?.message?.content || 'Извините, сейчас я не могу ответить. Попробуйте позже.';
    } catch (error) {
      console.error('Consultation AI error:', error.message);
      return 'Произошла ошибка при обработке запроса. Мы уже чиним!';
    }
  }
}

module.exports = new AIService();
