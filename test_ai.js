const aiService = require('./src/services/aiService');
const wbService = require('./src/services/wbService');
require('dotenv').config();

async function test() {
    try {
        console.log('Testing WB Service MOCK...');
        const wbReviews = await wbService.getReviews(false, 1, 0, { token: 'MOCK_TOKEN' });
        console.log('WB Reviews Count:', wbReviews.data.feedbacks.length);
        
        const review = wbReviews.data.feedbacks[0];
        
        console.log('\nTesting AI Service generation...');
        // We will mock the AI response because we might not have a valid POLZA_AI_API_KEY
        // Or we can just print the system prompt to see if it generates correctly!
        
        const productMetadata = { name: 'Платье', description: 'Красное платье', characteristics: [] };
        const matrix = { product_name: 'Крутое Платье', cross_sell_article: '123456', cross_sell_description: 'Возьмите еще сумку' };
        const seller = { brand_name: 'BrandTest', custom_instructions: 'Будь милым' };
        
        const prompt = aiService._buildSystemPrompt(productMetadata, matrix, seller, { crossSellName: 'Сумка кожаная' });
        console.log('--- SYSTEM PROMPT ---');
        console.log(prompt);
        console.log('---------------------');
        
        console.log('Success!');
    } catch(e) {
        console.error('Test Error:', e);
    }
}
test();
