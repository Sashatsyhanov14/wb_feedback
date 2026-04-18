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
  adminId: '795056847',
  adminIdUsername: process.env.TELEGRAM_ADMIN_USERNAME || '@edh4hhr',
  
  // Robokassa
  robokassaMerchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN,
  robokassaPassword1: process.env.ROBOKASSA_PASSWORD_1,
  robokassaPassword2: process.env.ROBOKASSA_PASSWORD_2,
  robokassaIsTest: process.env.ROBOKASSA_IS_TEST === 'true'
};
