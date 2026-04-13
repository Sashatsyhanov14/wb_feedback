const reviewService = require('./src/services/reviewService');
const supabase = require('./src/db/supabase');

async function testSandbox() {
  console.log('--- STARTING SANDBOX (MOCK MODE) TEST ---');

  // 1. Create/Get a developer test account
  const testChatId = 795056847; // User's ID from screenshot
  
  console.log('1. Configuring Test Seller in DB with MOCK_TOKEN...');
  const { data: seller, error } = await supabase
    .from('sellers')
    .upsert({
      telegram_chat_id: testChatId,
      wb_token: 'MOCK_TOKEN',
      brand_name: 'Sandbox Brand',
      custom_instructions: 'Отвечай дружелюбно, зови в гости еще раз!',
      subscription_status: 'premium',
      is_auto_reply_enabled: true,
      auto_reply_min_rating: 4
    })
    .select()
    .single();

  if (error) {
    console.error('Initial setup error:', error.message);
    return;
  }

  console.log('2. Mocking Matrix for better results...');
  await supabase.from('product_matrix').upsert({
    seller_id: seller.id,
    nm_id: 123456,
    product_name: 'Тестовый Артикул',
    cross_sell_article: '987654',
    cross_sell_description: 'Посмотрите наши другие аксессуары!'
  });

  console.log('3. Triggering ReviewSync (This will fetch FAKE reviews from WB Server)...');
  
  // Note: reviewService.processSellerReviews will call wbService.getReviews
  // Since seller.wb_token is 'MOCK_TOKEN', wbService will return 3 fake reviews.
  try {
    await reviewService.processSellerReviews(seller);
    console.log('4. Process finished! Check your Telegram Bot and Dashboard Stats.');
  } catch (err) {
    console.error('Processing error:', err.message);
  }

  console.log('--- SANDBOX TEST FINISHED ---');
}

testSandbox();
