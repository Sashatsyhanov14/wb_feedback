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
    this.bot.start((ctx) => {
      const welcome = `🚀 *Добро пожаловать в WBReply AI!*

Я ваш интеллектуальный ассистент для автоматизации ответов на отзывы Wildberries.

*Что я умею:*
✅ Генерировать умные ответы с учетом вашего Tone of Voice.
✅ Увеличивать продажи через рекомендательную матрицу.
✅ Анализировать тональность отзывов.

💡 *Ваш Chat ID:* \`${ctx.chat.id}\` (он может понадобиться в приложении)

Чтобы начать, нажмите кнопку ниже и перейдите в раздел *Настройки*:`;

      return ctx.reply(welcome, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Открыть Приложение', web_app: { url: process.env.APP_URL || 'https://wb-feedback.vercel.app' } }],
            [{ text: '🆘 Поддержка', url: 'https://t.me/edh4hhr' }]
          ]
        }
      });
    });
    
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
        
        // 1. Ensure seller exists and get seller_id (using UPSERT logic)
        let { data: seller, error: sellerError } = await supabase
          .from('sellers')
          .select('id')
          .eq('telegram_chat_id', chatId)
          .single();

        if (sellerError || !seller) {
          console.log(`🆕 Creating new seller for chat ${chatId}`);
          const { data: newSeller, error: insertError } = await supabase
            .from('sellers')
            .insert({ 
              telegram_chat_id: chatId, 
              wb_token: 'pending',
              subscription_status: 'free',
              is_top_5: false
            })
            .select('id')
            .single();
          
          if (insertError) {
            console.error('❌ Failed to create seller in Supabase:', insertError.message);
            if (chatId.toString() === config.adminId) {
              await ctx.reply(`⚠️ Ошибка создания профиля в БД: ${insertError.message}`);
            }
            // Fallback to anonymous session but continue bot response
          } else {
            seller = newSeller;
          }
        }

        // 2. Load persistent history from Supabase if seller exists
        let history = [];
        if (seller) {
          const { data: dbHistory } = await supabase
            .from('chat_history')
            .select('role, content')
            .eq('seller_id', seller.id)
            .order('created_at', { ascending: false })
            .limit(10);
          history = (dbHistory || []).reverse();
        }

        // 3. Generate response using AI
        const answer = await aiService.generateConsultation(userMessage, history);
        await ctx.reply(answer, { parse_mode: 'Markdown' });

        // 4. Save to Supabase (User message + Assistant response)
        if (seller) {
          const { error: historyError } = await supabase.from('chat_history').insert([
            { seller_id: seller.id, role: 'user', content: userMessage },
            { seller_id: seller.id, role: 'assistant', content: answer }
          ]);
          if (historyError) {
            console.error('❌ History Save Error:', historyError.message);
            if (chatId.toString() === config.adminId) {
              await ctx.reply(`⚠️ Ошибка сохранения истории: ${historyError.message}`);
            }
          }
        } else {
          if (chatId.toString() === config.adminId) {
            await ctx.reply('⚠️ Не удалось создать/найти профиль продавца в БД. История не сохранена.');
          }
        }

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
   * Helper to escape HTML characters
   */
  _escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async sendMessage(chatId, text) {
    console.log(`[TelegramService] Sending message to ${chatId}: ${text.slice(0, 50)}...`);
    try {
      await this.bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      console.error(`❌ Error sending Telegram message to ${chatId}:`, error.message);
      // Last resort: plain text
      try {
        await this.bot.telegram.sendMessage(chatId, text);
        return true;
      } catch (e) { return false; }
    }
  }

  async sendReviewDraft(chatId, logId, draftText, context = {}) {
    try {
      const { reviewText, rating, productInfo, nmId } = context;
      
      let message = `<b>💡 Сгенерирован черновик ответа:</b>\n\n`;
      
      if (reviewText) {
        const escapedReview = this._escapeHtml(reviewText);
        message += `<b>Отзыв (${rating}⭐):</b>\n<i>"${escapedReview}"</i>\n`;
        message += `<b>Товар:</b> ${productInfo || nmId}\n\n`;
      }
      
      const escapedDraft = this._escapeHtml(draftText);
      message += `<b>Вариант ответа:</b>\n"${escapedDraft}"`;
      
      const keyboard = [
        [
          { text: '✅ Одобрить и отправить', callback_data: `approve_${logId}` },
          { text: '❌ Удалить', callback_data: `reject_${logId}` }
        ]
      ];

      // Only add Mini App link if URL is available and valid
      if (process.env.APP_URL && process.env.APP_URL.startsWith('http')) {
        keyboard.push([
          { text: '✏️ Редактировать в Mini App', url: `${process.env.APP_URL}/review/${logId}` }
        ]);
      }
      
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
      return true;
    } catch (error) {
      console.error(`❌ Error sending Telegram review draft to ${chatId}:`, error.message);
      // Fallback: send without HTML
      try {
        await this.bot.telegram.sendMessage(chatId, `💡 Сгенерирован черновик ответа:\n\n${draftText}`);
        return true;
      } catch (inner) {
        console.error(`❌ CRITICAL: Fallback ALSO failed for ${chatId}:`, inner.message);
        return false;
      }
    }
  }
}

module.exports = new TelegramService();
