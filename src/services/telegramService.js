const { Telegraf } = require('telegraf');
const config = require('../config');

class TelegramService {
  constructor() {
    this.bot = new Telegraf(config.telegramBotToken);
    this._setupHandlers();
  }

  _setupHandlers() {
    this.bot.start((ctx) => {
      const welcome = `🚀 *WBReply AI* запущен! \n\nВаш Chat ID: \`${ctx.chat.id}\``;
      return ctx.reply(welcome, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Открыть Приложение', web_app: { url: process.env.APP_URL || 'https://wb-feedback.vercel.app' } }]]
        }
      });
    });

    this.bot.on('text', async (ctx) => {
        if (ctx.message.text.startsWith('/')) return;
        return ctx.reply('Я — автоматический ассистент. Управляйте мной через Mini App! 🚀');
    });
  }

  async launch() {
    if (config.nodeEnv === 'development') {
      console.log('🤖 Starting Telegram Bot in [POLLING] mode...');
      try { this.bot.launch(); } catch (e) { console.error('Bot launch failed:', e.message); }
    }
  }

  async handleUpdate(req, res) {
    try {
      if (req.body) await this.bot.handleUpdate(req.body);
      if (!res.headersSent) res.status(200).send('OK');
    } catch (err) {
      console.error('❌ Bot update error:', err.message);
      if (!res.headersSent) res.status(500).send('Error');
    }
  }

  async sendMessage(chatId, text) {
    if (!chatId) return false;
    console.log(`[TelegramService] Sending message to ${chatId}`);
    try {
      await this.bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      console.error(`❌ TG Message Error:`, error.message);
      // Fallback
      try {
        await this.bot.telegram.sendMessage(chatId, text.replace(/<[^>]*>/g, ''));
        return true;
      } catch (e) { return false; }
    }
  }
}

module.exports = new TelegramService();
