const { Telegraf } = require('telegraf');
const config = require('../config');
const supabase = require('../db/supabase');
const wbService = require('./wbService');
const aiService = require('./aiService');

class TelegramService {
  constructor() {
    this.bot = new Telegraf(config.telegramBotToken);
    this._setupHandlers();
  }

  _setupHandlers() {
    this.bot.start((ctx) => ctx.reply('Привет! Я бот для ответов на отзывы WB. Пришли мне свой Chat ID, если он тебе нужен: ' + ctx.chat.id));
    
    // Handle inline buttons
    this.bot.action(/approve_(.+)/, async (ctx) => {
      const logId = ctx.match[1];
      try {
        const { data: log, error } = await supabase
          .from('review_logs')
          .select('*, sellers(wb_token)')
          .eq('id', logId)
          .single();

        if (error || !log) return ctx.answerCbQuery('Отзыв не найден');

        const success = await wbService.sendAnswer(log.review_id, log.ai_response_draft, log.sellers.wb_token);
        if (success) {
          await supabase.from('review_logs').update({ status: 'approved' }).eq('id', logId);
          await ctx.editMessageText(`✅ Отправлено в WB: "${log.ai_response_draft}"`);
          await ctx.answerCbQuery('Ответ отправлен!');
        } else {
          await ctx.answerCbQuery('Ошибка при отправке в WB');
        }
      } catch (err) {
        console.error('Bot approve error:', err.message);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/reject_(.+)/, async (ctx) => {
      const logId = ctx.match[1];
      await supabase.from('review_logs').update({ status: 'rejected' }).eq('id', logId);
      await ctx.editMessageText('❌ Черновик удален');
      await ctx.answerCbQuery('Удалено');
    });

    // Handle consultation queries
    this.bot.on('text', async (ctx) => {
      // Ignore commands
      if (ctx.message.text.startsWith('/')) return;

      const chatId = ctx.from.id;
      const userMessage = ctx.message.text;

      try {
        await ctx.sendChatAction('typing');
        
        // 1. Ensure seller exists and get seller_id
        const { data: seller, error: sellerError } = await supabase
          .from('sellers')
          .select('id')
          .eq('telegram_chat_id', chatId)
          .single();

        if (sellerError || !seller) {
          console.warn('Seller not found for persistent chat:', chatId);
          return ctx.reply('Пожалуйста, сначала откройте наше приложение, чтобы я мог вас узнать! 😊');
        }

        // 2. Load persistent history from Supabase (last 10 messages)
        const { data: dbHistory } = await supabase
          .from('chat_history')
          .select('role, content')
          .eq('seller_id', seller.id)
          .order('created_at', { ascending: false })
          .limit(10);

        const history = (dbHistory || []).reverse();

        // 3. Generate response using AI
        const answer = await aiService.generateConsultation(userMessage, history);
        await ctx.reply(answer, { parse_mode: 'Markdown' });

        // 4. Save to Supabase (User message + Assistant response)
        await supabase.from('chat_history').insert([
          { seller_id: seller.id, role: 'user', content: userMessage },
          { seller_id: seller.id, role: 'assistant', content: answer }
        ]);

        // Notification logic: If AI mentions adminUsername, notify admin
        if (answer.includes(config.adminUsername) && config.adminId) {
          const alert = `🚨 *Нужна помощь человека!*\n\nПользователь: ${ctx.from.first_name || 'User'} (@${ctx.from.username || 'no_username'})\nID: ${ctx.from.id}\nВопрос: _${ctx.message.text}_`;
          await this.bot.telegram.sendMessage(config.adminId, alert, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error('Consultation handler error:', err);
        await ctx.reply('⚠️ Извините, произошла внутренняя ошибка при обработке сообщения. Мы уже разбираемся!');
      }
    });
  }

  /**
   * Launch the bot (Polling for Dev, Webhook for Prod)
   */
  async launch() {
    if (config.nodeEnv === 'development') {
      console.log('🤖 Starting Telegram Bot in [POLLING] mode...');
      try {
        this.bot.launch();
      } catch (e) {
        console.error('Bot launch failed:', e.message);
      }
    } else {
      console.log('🌐 Bot using [WEBHOOK] mode on Vercel.');
    }
  }

  /**
   * Middleware for Vercel/Express webhook
   */
  async handleUpdate(req, res) {
    try {
      if (!req.body) {
        console.warn('⚠️ Received empty body in /api/bot');
        return res.status(200).send('OK'); // Telegram expects 200
      }

      console.log(`📩 Incoming update: ${Object.keys(req.body).filter(k => k !== 'update_id')}`);
      
      await this.bot.handleUpdate(req.body);
      
      if (!res.headersSent) {
        res.status(200).send('OK');
      }
    } catch (err) {
      console.error('❌ Error handling bot update:', err.message);
      if (!res.headersSent) {
        res.status(500).send('Error');
      }
    }
  }

  /**
   * Send a plain text message to a user
   * @param {string|number} chatId - Telegram Chat ID
   * @param {string} text - Message content
   */
  async sendMessage(chatId, text) {
    try {
      await this.bot.telegram.sendMessage(chatId, text);
      return true;
    } catch (error) {
      console.error(`Error sending Telegram message to ${chatId}:`, error.message);
      return false;
    }
  }

  /**
   * Send a review draft with buttons (Approved/Reject logic placeholder)
   * @param {string|number} chatId - Telegram Chat ID
   * @param {string} logId - Internal Review Log ID
   * @param {string} draftText - The AI generated draft
   */
  async sendReviewDraft(chatId, logId, draftText) {
    try {
      const message = `💡 *Сгенерирован черновик ответа*:\n\n${draftText}`;
      
      // Inline buttons for quick actions (logic for handling these would be in a separate bot handler)
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Одобрить и отправить', callback_data: `approve_${logId}` },
              { text: '❌ Удалить', callback_data: `reject_${logId}` }
            ],
            [
              { text: '✏️ Редактировать в Mini App', url: `${process.env.APP_URL || ''}/review/${logId}` }
            ]
          ]
        }
      });
      return true;
    } catch (error) {
      console.error(`Error sending Telegram review draft to ${chatId}:`, error.message);
      return false;
    }
  }
}

module.exports = new TelegramService();
