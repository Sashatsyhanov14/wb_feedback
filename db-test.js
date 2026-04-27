require('dotenv').config();
const supabase = require('./src/db/supabase');

async function runHardcoreTest() {
  console.log('🚀 Начинаем жесткий тест базы данных...\n');

  try {
    // 1. Тест создания пользователя (INSERT)
    console.log('1️⃣ Тест: Создание пользователя...');
    const testTgId = 'test_tg_' + Date.now();
    const { data: user, error: userError } = await supabase
      .from('sellers')
      .insert({
        auth_provider: 'telegram',
        auth_provider_id: testTgId,
        display_name: 'Hardcore Tester',
        email: 'tester@example.com'
      })
      .select()
      .single();

    if (userError) throw new Error(`Ошибка создания юзера: ${userError.message}`);
    console.log(`✅ Пользователь создан: ${user.id}`);

    // 2. Тест уникального ограничения (UNIQUE CONSTRAINT)
    console.log('\n2️⃣ Тест: Проверка уникальности (дубликат провайдера)...');
    const { error: duplicateError } = await supabase
      .from('sellers')
      .insert({
        auth_provider: 'telegram',
        auth_provider_id: testTgId // Тот же самый ID
      });
    
    if (duplicateError) {
      console.log('✅ Защита работает! Нельзя создать дубликат пользователя.');
    } else {
      throw new Error('❌ ОШИБКА: База позволила создать дубликат!');
    }

    // 3. Тест добавления отзывов (FOREIGN KEY)
    console.log('\n3️⃣ Тест: Добавление 100 отзывов для пользователя...');
    const reviewsToInsert = [];
    for (let i = 0; i < 100; i++) {
      reviewsToInsert.push({
        seller_id: user.id,
        review_id: `rev_${Date.now()}_${i}`,
        review_text: `Отличный товар ${i}!`,
        rating: 5,
        nm_id: 12345678,
        status: 'pending'
      });
    }

    const { error: reviewsError } = await supabase.from('review_logs').insert(reviewsToInsert);
    if (reviewsError) throw new Error(`Ошибка вставки отзывов: ${reviewsError.message}`);
    
    const { count } = await supabase.from('review_logs').select('id', { count: 'exact', head: true }).eq('seller_id', user.id);
    console.log(`✅ Успешно добавлено ${count} отзывов.`);

    // 4. Тест истории чата (FOREIGN KEY)
    console.log('\n4️⃣ Тест: Добавление истории чата ИИ...');
    const { error: chatError } = await supabase.from('chat_history').insert([
      { seller_id: user.id, role: 'user', content: 'Привет, ИИ!' },
      { seller_id: user.id, role: 'assistant', content: 'Здравствуйте! Чем помочь?' }
    ]);
    if (chatError) throw new Error(`Ошибка вставки чата: ${chatError.message}`);
    console.log('✅ История чата добавлена.');

    // 5. Тест КАСКАДНОГО УДАЛЕНИЯ (ON DELETE CASCADE)
    console.log('\n5️⃣ Тест: Каскадное удаление (ON DELETE CASCADE)...');
    console.log('Удаляем пользователя и проверяем, удалились ли его отзывы и чат...');
    
    const { error: deleteError } = await supabase.from('sellers').delete().eq('id', user.id);
    if (deleteError) throw new Error(`Ошибка удаления юзера: ${deleteError.message}`);

    // Проверяем остались ли отзывы
    const { count: reviewsAfter } = await supabase.from('review_logs').select('id', { count: 'exact', head: true }).eq('seller_id', user.id);
    const { count: chatAfter } = await supabase.from('chat_history').select('id', { count: 'exact', head: true }).eq('seller_id', user.id);

    if (reviewsAfter === 0 && chatAfter === 0) {
      console.log('✅ Каскадное удаление работает идеально! Связанные данные уничтожены.');
    } else {
      throw new Error(`❌ ОШИБКА КАСКАДА: Осталось ${reviewsAfter} отзывов и ${chatAfter} сообщений!`);
    }

    console.log('\n🎉 ВСЕ ТЕСТЫ БАЗЫ ДАННЫХ ПРОЙДЕНЫ УСПЕШНО!');

  } catch (err) {
    console.error('\n❌ ТЕСТ ПРОВАЛЕН:', err.message);
  }
}

runHardcoreTest();
