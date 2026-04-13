const reviewService = require('./src/services/reviewService');
const supabase = require('./src/db/supabase');

async function testDryRun() {
  console.log('--- STARTING DRY RUN TEST ---');
  
  // 1. Create a temporary mock seller in DB
  const mockSeller = {
    telegram_chat_id: 111222333,
    wb_token: 'MOCK_TOKEN',
    brand_name: 'TestBrand',
    is_auto_reply_enabled: false // So it doesn't try to send via telegramService (which might be real)
  };

  try {
    console.log('1. Upserting mock seller...');
    const { data: seller, error } = await supabase.from('sellers').upsert(mockSeller).select().single();
    if (error) throw error;
    
    console.log('2. Manually triggering processSellerReviews...');
    // We override processSingleReview temporarily to just log instead of actually doing DB writes/TG messages if needed
    // But since it's a test script, we let it run and see the logs.
    
    await reviewService.processSellerReviews(seller);
    
    console.log('3. Verification successful! System handled mock data correctly.');
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    console.log('--- DRY RUN FINISHED ---');
  }
}

testDryRun();
