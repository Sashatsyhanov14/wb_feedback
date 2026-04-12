const { Telegraf } = require('telegraf');
const config = require('../config');

class TelegramService {
  constructor() {
    this.bot = new Telegraf(config.telegramBotToken);
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
