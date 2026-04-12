const { Telegraf } = require('telegraf');
const config = require('../config');
const supabase = require('../db/supabase');
const wbService = require('./wbService');

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
  }

  /**
   * Middleware for Vercel/Express webhook
   */
  handleUpdate(req, res) {
    return this.bot.webhookCallback('/api/bot')(req, res);
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
