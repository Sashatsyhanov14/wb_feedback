require('dotenv').config();

module.exports = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  polzaAiApiKey: process.env.POLZA_AI_API_KEY,
  maxBotToken: process.env.MAX_BOT_TOKEN,
  maxAppId: process.env.MAX_APP_ID,
  wbToken: process.env.WB_TOKEN,
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  cronSecret: process.env.CRON_SECRET
};
