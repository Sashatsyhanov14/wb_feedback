const aiService = require('./src/services/aiService');
const config = require('./src/config');

async function runTests() {
  console.log('--- STARTING CORE TESTS ---');

  // 1. Test AI Response Generation (Cross-sell & Persona)
  console.log('\n[Test 1] AI Response Generation...');
  const mockProduct = { name: 'Футболка черная', description: 'Хлопок 100%' };
  const mockMatrix = { product_name: 'Футболка Premium', cross_sell_article: '987654', cross_sell_description: 'Посмотрите наши шорты!' };
  const mockSeller = { brand_name: 'SuperBrand', custom_instructions: 'Отвечай в стиле пирата.' };
  
  const response = await aiService.generateResponse('Отличная футболка, спасибо!', mockProduct, mockMatrix, mockSeller);
  console.log('Result:', JSON.stringify(response, null, 2));

  // 2. Test AI Consultant (Memory & Persona)
  console.log('\n[Test 2] AI Consultant Memory...');
  const history = [{ role: 'user', content: 'Привет, кто ты?' }, { role: 'assistant', content: 'Я ассистент Legatus AI.' }];
  const consultResponse = await aiService.generateConsultation('Как настроить матрицу?', history);
  console.log('Consultant Response:', consultResponse);

  console.log('\n--- TESTS FINISHED ---');
}

runTests();
