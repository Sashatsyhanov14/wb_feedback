const { Telegraf } = require('telegraf');
const config = require('../config');
const supabase = require('../db/supabase');
const aiService = require('./aiService');

class TelegramService {
  constructor() {
    this.bot = new Telegraf(config.telegramBotToken);
    this._setupHandlers();
  }

  _setupHandlers() {
    // 1. START COMMAND (Premium Welcome)
    this.bot.start(async (ctx) => {
      const chatId = ctx.from.id;
      
      // Auto-register seller if new
      await this._ensureSellerExists(chatId);

      const welcome = `🚀 *Добро пожаловать в WBReply AI!*

Я ваш интеллектуальный ассистент для автоматизации Wildberries. 

🎁 *Вам начислен пробный доступ на 3 дня!* Протестируйте все функции бота абсолютно бесплатно.
Через 3 дня стоимость составит *749 руб/мес*.

💰 *Управлять подпиской и оплатить доступ можно в разделе «Аккаунт»* внутри нашего приложения.

*Я помогу вам:*
✅ Отвечать на отзывы в 10 раз быстрее.
✅ Увеличить LTV и рейтинг магазина.
✅ Продавать больше через умную матрицу.

💡 *Ваш Chat ID:* \`${chatId}\`

Нажмите кнопку ниже, чтобы войти в кабинет и подключить магазин! 👇`;

      return ctx.reply(welcome, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💎 Вход в Личный Кабинет', web_app: { url: process.env.APP_URL || 'https://wb-feedback.vercel.app' } }],
            [{ text: '🆘 Тех. Поддержка', url: 'https://t.me/edh4hhr' }]
          ]
        }
      });
    });

    // 2. AI CONSULTANT (Lively interaction for users)
    this.bot.on('text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;

      const chatId = ctx.from.id;
      const userMessage = ctx.message.text;

      try {
        await ctx.sendChatAction('typing');
        
        const seller = await this._ensureSellerExists(chatId);

        // Load recent history (last 5 messages)
        let history = [];
        if (seller) {
          const { data } = await supabase
            .from('chat_history')
            .select('role, content')
            .eq('seller_id', seller.id)
            .order('created_at', { ascending: false })
            .limit(5);
          history = (data || []).reverse();
        }

        const answer = await aiService.generateConsultation(userMessage, history);
        await ctx.reply(answer, { parse_mode: 'Markdown' });

        // Save history asynchronously
        if (seller) {
          supabase.from('chat_history').insert([
            { seller_id: seller.id, role: 'user', content: userMessage },
            { seller_id: seller.id, role: 'assistant', content: answer }
          ]).then(({error}) => { if(error) console.error('History Error:', error.message); });
        }

      } catch (err) {
        console.error('Bot Text Error:', err.message);
        ctx.reply('⚠️ Произошла небольшая заминка. Попробуйте еще раз или загляните в Mini App! 🚀');
      }
    });
  }

  async _ensureSellerExists(chatId) {
    try {
      let { data: seller } = await supabase
        .from('sellers')
        .select('*')
        .eq('telegram_chat_id', chatId)
        .maybeSingle();

      if (!seller) {
        console.log(`🆕 Auto-registering user ${chatId}`);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 3);

        const { data: newSeller, error } = await supabase
          .from('sellers')
          .insert({ 
            telegram_chat_id: chatId, 
            wb_token: 'pending',
            subscription_status: 'trial',
            subscription_expires_at: expiresAt.toISOString()
          })
          .select('*')
          .single();
        
        if (error) throw error;
        seller = newSeller;
      }
      return seller;
    } catch (e) {
      console.error('Registration Error:', e.message);
      return null;
    }
  }

  async launch() {
    // If on Vercel, we use webhooks.
    // If on VPS without domain, we use polling.
    if (!process.env.VERCEL) {
      console.log('🤖 Starting Telegram Bot [POLLING]...');
      this.bot.launch().catch(e => console.error('TG Launch:', e.message));
    } else {
      console.log('🌐 Webhook mode active (Vercel)');
    }
  }

  async handleUpdate(req, res) {
    try {
      if (req.body) await this.bot.handleUpdate(req.body);
      if (!res.headersSent) res.status(200).send('OK');
    } catch (err) {
      console.error('❌ Update Error:', err.message);
      if (!res.headersSent) res.status(500).send('Error');
    }
  }

  async sendMessage(chatId, text) {
    if (!chatId) return false;
    try {
      await this.bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      console.error(`❌ TG Error for ${chatId}:`, error.message);
      try {
        await this.bot.telegram.sendMessage(chatId, text.replace(/<[^>]*>/g, ''));
        return true;
      } catch (e) { return false; }
    }
  }
}

module.exports = new TelegramService();
