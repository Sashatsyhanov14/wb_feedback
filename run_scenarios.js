const reviewService = require('./src/services/reviewService');
const aiService = require('./src/services/aiService');
const supabase = require('./src/db/supabase');

async function runScenarios() {
  console.log('🚀 ЗАПУСК СЦЕНАРИЕВ ТЕСТИРОВАНИЯ ИИ\n');

  // Данные для теста (имитируем реального продавца)
  const mockSeller = {
    id: 'test-uuid-123',
    telegram_chat_id: 795056847,
    brand_name: 'Premium Store',
    custom_instructions: 'Будь максимально дружелюбным и используй пару эмодзи.',
    is_auto_reply_enabled: true,
    auto_reply_min_rating: 4,
    wb_token: 'MOCK_TOKEN'
  };

  const mockProduct = {
    name: 'Кожаная сумка Classic',
    description: 'Стильная сумка из натуральной итальянской кожи.',
    characteristics: [{ name: 'Материал', value: '100% кожа' }]
  };

  const mockMatrix = {
    product_name: 'Кожаная сумка Classic',
    cross_sell_article: '888777',
    cross_sell_description: 'К этой сумке отлично подойдет наш кожаный кошелек в том же цвете!'
  };

  // Сценарий 1: Пятерка
  console.log('📌 СЦЕНАРИЙ 1: Отзыв 5 звезд (Ожидаем: Восторг + Допродажа)');
  const feedback5 = { text: 'Сумка просто супер! Качество кожи на высоте, швы ровные.', productValuation: 5 };
  const res5 = await aiService.generateResponse(feedback5.text, mockProduct, mockMatrix, mockSeller);
  console.log('Ответ ИИ:', res5.text);
  console.log('Категория:', res5.category, '| Настроение:', res5.sentiment);
  console.log('--------------------------------------------------\n');

  // Сценарий 2: Тройка (Проблема)
  console.log('📌 СЦЕНАРИЙ 2: Отзыв 2 звезды (Ожидаем: Эмпатия + Решение БЕЗ допродажи)');
  const feedback2 = { text: 'Пришла сумка с царапиной на застежке. Очень расстроена.', productValuation: 2 };
  const res2 = await aiService.generateResponse(feedback2.text, mockProduct, null, mockSeller);
  console.log('Ответ ИИ:', res2.text);
  console.log('Категория:', res2.category, '| Настроение:', res2.sentiment);
  console.log('--------------------------------------------------\n');

  console.log('✅ ТЕСТЫ ЗАВЕРШЕНЫ. Если ответы выглядят ок — система готова!');
}

runScenarios().catch(err => console.error('Ошибка в тестах:', err));
