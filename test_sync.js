const reviewService = require('./src/services/reviewService');
require('dotenv').config();

async function runSync() {
    console.log('Testing Process Seller Reviews (Mock Mode)...');
    const seller = {
        id: 'test_seller_123',
        telegram_chat_id: '1234567',
        wb_token: 'MOCK_TOKEN',
        subscription_status: 'premium'
    };
    
    try {
        await reviewService.processSellerReviews(seller);
        console.log('Sync finished.');
    } catch(e) {
        console.error('Error:', e);
    }
}
runSync();
