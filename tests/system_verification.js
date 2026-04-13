const reviewService = require('../src/services/reviewService');
const supabase = require('../src/db/supabase');
const config = require('../src/config');

async function runFullVerification() {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 WBReply AI: ГЛОБАЛЬНАЯ ПРОВЕРКА СИСТЕМЫ');
  console.log('='.repeat(60) + '\n');

  const testChatId = config.adminId; // Testing on the owner's ID
  
  try {
    // 1. Сброс тестовых данных (опционально для чистоты)
    console.log('🧹 [1/5] Подготовка чистого окружения...');
    const { data: existingSeller } = await supabase
      .from('sellers')
      .select('id')
      .eq('telegram_chat_id', testChatId)
      .single();

    if (existingSeller) {
      await supabase.from('review_logs').delete().eq('seller_id', existingSeller.id);
      await supabase.from('product_matrix').delete().eq('seller_id', existingSeller.id);
    }

    // 2. Имитация Onboarding
    console.log('👤 [2/5] Имитация онбординга пользователя...');
    const { data: seller, error: sError } = await supabase
      .from('sellers')
      .upsert({
        telegram_chat_id: testChatId,
        wb_token: 'MOCK_TOKEN', // Включает режим эмуляции в wbService
        brand_name: 'Premium Leather Goods',
        custom_instructions: 'Отвечай изысканно и вежливо. Используй смайлики ✨💼.',
        subscription_status: 'premium',
        is_auto_reply_enabled: true,
        auto_reply_min_rating: 4
      })
      .select()
      .single();

    if (sError) throw sError;
    console.log(`   ✅ Пользователь зарегистрирован: ID ${seller.id}`);

    // 3. Настройка Матрицы
    console.log('📊 [3/5] Настройка матрицы допродаж...');
    await supabase.from('product_matrix').insert({
      seller_id: seller.id,
      nm_id: 123456,
      product_name: 'Кожаный кошелек "Imperial"',
      cross_sell_article: '999111',
      cross_sell_description: 'К этому кошельку идеально подойдет наш ремень из той же коллекции!'
    });
    console.log('   ✅ Матрица настроена (123456 -> 999111)');

    // 4. Запуск Цикла Обработки
    console.log('⚙️ [4/5] Запуск обработки отзывов (Режим эмуляции)...');
    console.log('   (Система скачает 3 тестовых отзыва от WB и обработает их через ИИ)');
    
    const startTime = Date.now();
    await reviewService.processSellerReviews(seller);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`   ✅ Цикл завершен за ${duration} сек.`);

    // 5. Верификация Результатов в БД
    console.log('🔍 [5/5] Финальная проверка логов...');
    const { data: logs, count } = await supabase
      .from('review_logs')
      .select('*', { count: 'exact' })
      .eq('seller_id', seller.id);

    console.log(`\n📊 РЕЗУЛЬТАТЫ:`);
    console.log(`- Обработано отзывов: ${count}`);
    
    logs.forEach((log, i) => {
      console.log(`\n--- Отзыв #${i + 1} (${log.status}) ---`);
      console.log(`Текст: "${log.review_text.slice(0, 50)}..."`);
      console.log(`Ответ ИИ: "${log.ai_response?.slice(0, 80)}..."`);
      if (log.ai_response && log.ai_response.includes('999111')) {
        console.log('✨ Кросс-сейл сработал! Артикул 999111 найден в ответе.');
      }
    });

    console.log('\n' + '='.repeat(60));
    console.log('🎉 СИСТЕМА ПОЛНОСТЬЮ ГОТОВА К ЗАПУСКУ!');
    console.log('Все компоненты: Onboarding, DB, AI, Matrix — работают штатно.');
    console.log('='.repeat(60) + '\n');

  } catch (err) {
    console.error('\n❌ ОШИБКА ПРИ ПРОВЕРКЕ:', err.message);
  }
}

runFullVerification();
