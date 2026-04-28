require('dotenv').config();

module.exports = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  polzaAiApiKey: process.env.POLZA_AI_API_KEY,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  wbToken: process.env.WB_TOKEN,
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  cronSecret: process.env.CRON_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://wbreplyai.ru/api/auth/google/callback',
  vkClientId: process.env.VK_CLIENT_ID,
  vkClientSecret: process.env.VK_CLIENT_SECRET,
  vkRedirectUri: process.env.VK_REDIRECT_URI || 'https://wbreplyai.ru/api/auth/vk/callback',
  adminId: '68cfdf5a-25fb-43f5-8672-c03d1bddc29b',
  adminIdUsername: process.env.TELEGRAM_ADMIN_USERNAME || '@edh4hhr',
  
  // Robokassa
  robokassaMerchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN,
  robokassaPassword1: process.env.ROBOKASSA_PASSWORD_1,
  robokassaPassword2: process.env.ROBOKASSA_PASSWORD_2,
  robokassaIsTest: process.env.ROBOKASSA_IS_TEST === 'true',
  
  // YooKassa
  yookassaShopId: process.env.YOOKASSA_SHOP_ID,
  yookassaSecretKey: process.env.YOOKASSA_SECRET_KEY,

  jwtSecret: process.env.JWT_SECRET || 'your_fallback_secret_change_me'
};
