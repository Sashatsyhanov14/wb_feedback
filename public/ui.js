let state = {
    telegramChatId: null,
    settings: {
        wb_token: '',
        custom_instructions: '',
        is_auto_reply_enabled: true,
        respond_to_bad_reviews: false,
        subscription_status: 'free',
        subscription_expires_at: null
    },
    reviews: [],
    matrix: [],
    currentView: 'settings',
    stats: { approved: 0, pending: 0, total: 0, approvedToday: 0 },
    adminStats: { totalSellers: 0, totalApproved: 0, newToday: 0, activeToday: 0, withoutToken: 0 },
    adminUsers: []
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize TG WebApp
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.expand();
        tg.ready();
        state.telegramChatId = tg.initDataUnsafe.user?.id || 795056847;
    } else {
        state.telegramChatId = 795056847;
    }

    // 2. Initial View (Immediate render)
    showView('settings');

    // 3. Load Data & Update
    await refreshData();
    showView(state.currentView);
});

async function refreshData() {
    try {
        const adminId = '795056847';
        const requests = [
            fetch(`/api/settings/${state.telegramChatId}`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/matrix/${state.telegramChatId}`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/stats/${state.telegramChatId}`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/reviews/${state.telegramChatId}`).then(r => r.status === 200 ? r.json() : null)
        ];

        // Conditional Admin Data Fetch
        if (state.telegramChatId.toString() === adminId) {
            requests.push(fetch(`/api/admin/stats/${adminId}`).then(r => r.status === 200 ? r.json() : null));
            requests.push(fetch(`/api/admin/users/${adminId}`).then(r => r.status === 200 ? r.json() : null));
        }

        const [settings, matrix, stats, reviews, adminStats, adminUsers] = await Promise.all(requests);

        if (settings) state.settings = { ...state.settings, ...settings };
        if (matrix) state.matrix = matrix;
        if (stats) state.stats = stats;
        if (reviews) state.reviews = reviews;
        if (adminStats) state.adminStats = adminStats;
        if (adminUsers) state.adminUsers = adminUsers;
    } catch (e) {
        console.error('Refresh data error:', e);
    }
}

async function handleSaveSettings() {
    state.settings.wb_token = document.getElementById('wb-token-input').value;
    state.settings.custom_instructions = document.getElementById('ai-instructions-input').value;
    await saveSettings();
}

async function saveSettings() {
    try {
        const res = await fetch(`/api/settings/${state.telegramChatId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.settings)
        });
        const data = await res.json();
        if (data.settings) state.settings = data.settings;
        showToast('Конфигурация сохранена');
    } catch (e) {
        console.error('Save settings error:', e);
        showToast('Ошибка сохранения', true);
    }
}

async function handleSync() {
    try {
        if (!state.settings.wb_token) {
            showToast('Сначала введите WB Токен в настройках', true);
            return;
        }
        showToast('Запуск синхронизации...', false);
        const res = await fetch(`/api/sync/${state.telegramChatId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(data.message);
            await refreshData();
            showView('subscription');
        } else {
            showToast(data.error || 'Ошибка синхронизации', true);
        }
    } catch (e) {
        console.error('Sync error:', e);
        showToast('Ошибка сети', true);
    }
}

function showView(view) {
    state.currentView = view;
    const content = document.getElementById('content-view');
    if (!content) return;

    // Update Nav active classes
    document.querySelectorAll('.tab-item').forEach(item => {
        item.classList.remove('active', 'bg-[#2A2A2A]', 'text-[#ADC6FF]');
        item.classList.add('text-[#C1C6D7]');
        const icon = item.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 0";
    });
    
    const activeNav = document.getElementById(`nav-${view}`);
    if (activeNav) {
        activeNav.classList.add('active', 'bg-[#2A2A2A]', 'text-[#ADC6FF]');
        activeNav.classList.remove('text-[#C1C6D7]');
        const icon = activeNav.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 1";
    }

    if (view === 'settings') {
        content.innerHTML = renderSettings();
    } else if (view === 'matrix') {
        content.innerHTML = renderMatrix();
    } else if (view === 'subscription') {
        content.innerHTML = renderSubscription();
    }
}

function renderSettings() {
    return `
        <div class="space-y-6">
            <div class="mb-8">
                <span class="text-primary text-xs font-bold tracking-widest uppercase opacity-70">Workspace</span>
                <h2 class="font-headline text-3xl font-extrabold text-on-surface tracking-tight mt-1">Настройки</h2>
            </div>

            <section class="bg-surface-container-low rounded-xl p-6 border border-outline-variant/5">
                <div class="flex items-center justify-between mb-4">
                    <label class="text-on-surface font-semibold text-sm">API Токен WB</label>
                    <span class="material-symbols-outlined text-outline text-lg">key</span>
                </div>
                <div class="relative group">
                    <input id="wb-token-input" class="w-full bg-surface-container-lowest border-none rounded-lg py-4 px-4 text-on-surface-variant focus:ring-1 focus:ring-primary transition-all text-sm font-mono" 
                        type="password" value="${state.settings.wb_token || ''}" placeholder="••••••••••••••••••••••••">
                    <button class="absolute right-4 top-1/2 -translate-y-1/2 text-outline hover:text-primary transition-colors" onclick="toggleTokenVisibility()">
                        <span id="token-visibility-icon" class="material-symbols-outlined">visibility</span>
                    </button>
                </div>
                <p class="mt-3 text-[11px] text-on-surface-variant/60 leading-relaxed">
                    Используйте API-ключ типа «Стандартный» для обеспечения корректной работы автоматических ответов.
                </p>
            </section>

            <section class="bg-surface-container-low rounded-xl p-6 border border-outline-variant/5">
                <div class="flex items-center justify-between mb-4">
                    <label class="text-on-surface font-semibold text-sm">Инструкции для ИИ</label>
                    <div class="flex gap-2">
                        <span class="px-2 py-0.5 bg-secondary-container text-on-secondary-container text-[10px] rounded font-medium">Smart Logic</span>
                    </div>
                </div>
                <div class="relative">
                    <textarea id="ai-instructions-input" class="w-full bg-surface-container-lowest border-none rounded-lg p-4 text-on-surface-variant focus:ring-1 focus:ring-primary transition-all text-sm leading-relaxed resize-none placeholder:text-outline/40" 
                        placeholder="Например: Пиши вежливо, обращайся на Вы, в конце предлагай новинки..." rows="8">${state.settings.custom_instructions || ''}</textarea>
                </div>
            </section>

            <div class="pt-4">
                <button onclick="handleSaveSettings()" class="w-full bg-electric-gradient py-4 rounded-xl text-on-primary font-bold text-base shadow-[0_4px_24px_0_rgba(173,198,255,0.2)] active:scale-[0.98] transition-transform flex items-center justify-center gap-2 relative overflow-hidden group">
                    <span class="material-symbols-outlined text-xl" style="font-variation-settings: 'FILL' 1;">save</span>
                    Сохранить конфигурацию
                </button>
            </div>
        </div>
    `;
}

function renderMatrix() {
    return `
        <div class="space-y-6">
            <section class="mb-8">
                <h2 class="text-3xl font-headline font-extrabold tracking-tight text-on-surface mb-2">Матрица допродаж</h2>
                <p class="text-sm text-on-surface-variant leading-relaxed">
                    Настройте связки товаров для автоматических рекомендаций в отзывах.
                </p>
            </section>

            <div class="grid grid-cols-1 gap-3 mb-8">
                <div class="bg-surface-container-low p-4 rounded-xl flex items-center justify-between">
                    <div class="text-on-surface-variant text-[10px] uppercase tracking-wider">Активных пар в матрице</div>
                    <div class="text-2xl font-headline font-bold text-primary">${state.matrix.length}</div>
                </div>
            </div>

            <div class="space-y-3">
                ${state.matrix.map((item, idx) => `
                    <div class="bg-surface-container-high p-4 rounded-xl flex items-center gap-3">
                        <div class="flex-1 space-y-1">
                            <label class="text-[10px] text-on-surface-variant ml-3 uppercase font-semibold">Артикул товара</label>
                            <div class="w-full bg-surface-container-lowest rounded-lg text-sm text-on-surface h-10 px-3 flex items-center font-mono">${item.nm_id}</div>
                        </div>
                        <div class="flex items-center pt-5">
                            <span class="material-symbols-outlined text-primary">arrow_forward</span>
                        </div>
                        <div class="flex-1 space-y-1">
                            <label class="text-[10px] text-on-surface-variant ml-3 uppercase font-semibold">Рекомендация</label>
                            <div class="w-full bg-surface-container-lowest rounded-lg text-sm text-on-surface h-10 px-3 flex items-center font-mono">${item.cross_sell_article}</div>
                        </div>
                        <button class="pt-5 text-on-surface-variant hover:text-red-500 transition-colors" onclick="handleDeleteMatrix(${item.id || idx})">
                            <span class="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                    </div>
                `).join('')}

                <div class="bg-surface-container-high p-4 rounded-xl flex items-center gap-3 border border-primary/20">
                    <div class="flex-1 space-y-1">
                        <label class="text-[10px] text-on-surface-variant ml-3 uppercase font-semibold">Артикул товара</label>
                        <input id="new-nm-id" class="w-full bg-surface-container-lowest border-none rounded-lg text-sm text-on-surface focus:ring-1 focus:ring-primary h-10 px-3 transition-all" placeholder="Введите SKU" type="text">
                    </div>
                    <div class="flex items-center pt-5">
                        <span class="material-symbols-outlined text-primary/40">arrow_forward</span>
                    </div>
                    <div class="flex-1 space-y-1">
                        <label class="text-[10px] text-on-surface-variant ml-3 uppercase font-semibold">Рекомендация</label>
                        <input id="new-cross-id" class="w-full bg-surface-container-lowest border-none rounded-lg text-sm text-on-surface focus:ring-1 focus:ring-primary h-10 px-3 transition-all" placeholder="Введите SKU" type="text">
                    </div>
                    <button class="pt-5 text-primary hover:scale-110 transition-transform" onclick="handleAddMatrixRow()">
                        <span class="material-symbols-outlined text-[28px]">add_box</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderSubscription() {
    const expiresAt = state.settings.subscription_expires_at;
    let daysLeft = 0;
    if (expiresAt) {
        const diff = new Date(expiresAt) - new Date();
        daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }

    const expiredDateStr = expiresAt ? new Date(expiresAt).toLocaleDateString() : '—';
    
    return `
        <div class="animate-in space-y-8 pb-12">
            <!-- Analytics Dashboard (Simplified for Users) -->
            <section class="grid grid-cols-2 gap-3">
                <div class="bg-surface-container-low p-5 rounded-2xl border border-outline-variant/10 shadow-sm relative overflow-hidden group hover:border-primary/30 transition-all">
                    <div class="absolute -top-6 -right-6 w-16 h-16 bg-primary/5 rounded-full blur-xl group-hover:bg-primary/10 transition-colors"></div>
                    <div class="flex items-center gap-2 mb-2">
                        <span class="material-symbols-outlined text-primary text-sm" style="font-variation-settings: 'FILL' 1">auto_awesome</span>
                        <span class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/60">За сегодня</span>
                    </div>
                    <p class="text-3xl font-black font-headline text-on-surface">${state.stats?.approvedToday || 0}</p>
                    <p class="text-[9px] text-on-surface-variant/40 mt-1">умных ответов</p>
                </div>

                <div class="bg-surface-container-low p-5 rounded-2xl border border-outline-variant/10 shadow-sm relative overflow-hidden group hover:border-primary/30 transition-all">
                    <div class="absolute -top-6 -right-6 w-16 h-16 bg-secondary/5 rounded-full blur-xl group-hover:bg-secondary/10 transition-colors"></div>
                    <div class="flex items-center gap-2 mb-2">
                        <span class="material-symbols-outlined text-secondary text-sm" style="font-variation-settings: 'FILL' 1">done_all</span>
                        <span class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/60">Всего</span>
                    </div>
                    <p class="text-3xl font-black font-headline text-on-surface">${state.stats?.approved || 0}</p>
                    <p class="text-[9px] text-on-surface-variant/40 mt-1">за всё время</p>
                </div>
            </section>

            ${state.telegramChatId.toString() === '795056847' ? `
            <!-- Admin Console (Visible only to Owner) -->
            <section class="mt-4 p-6 rounded-3xl bg-electric-gradient text-on-primary shadow-2xl shadow-primary/20">
                <div class="flex items-center gap-3 mb-6">
                    <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-md">
                        <span class="material-symbols-outlined text-white text-xl">admin_panel_settings</span>
                    </div>
                    <div>
                        <h3 class="font-headline font-black text-lg tracking-tight leading-none">Админ-панель</h3>
                        <p class="text-[10px] uppercase font-bold tracking-widest opacity-60 mt-1">Growth & Retention</p>
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-3">
                    <div class="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
                        <p class="text-[9px] uppercase font-black tracking-widest opacity-60 mb-1">Всего юзеров</p>
                        <p class="text-2xl font-black font-headline">${state.adminStats?.totalSellers || 0}</p>
                    </div>
                    <div class="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 bg-green-500/10">
                        <p class="text-[9px] uppercase font-black tracking-widest opacity-60 mb-1">Новых сегодня</p>
                        <p class="text-2xl font-black font-headline">${state.adminStats?.newToday || 0}</p>
                    </div>
                    <div class="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
                        <p class="text-[9px] uppercase font-black tracking-widest opacity-60 mb-1">Активных (24ч)</p>
                        <p class="text-2xl font-black font-headline">${state.adminStats?.activeToday || 0}</p>
                    </div>
                    <div class="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 bg-red-500/10">
                        <p class="text-[9px] uppercase font-black tracking-widest opacity-60 mb-1">Без токена (Drop)</p>
                        <p class="text-2xl font-black font-headline">${state.adminStats?.withoutToken || 0}</p>
                    </div>
                    <div class="col-span-2 bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 flex justify-between items-center">
                        <div>
                            <p class="text-[9px] uppercase font-black tracking-widest opacity-60 mb-1">Глобально ответов</p>
                            <p class="text-2xl font-black font-headline">${state.adminStats?.totalApproved || 0}</p>
                        </div>
                        <span class="material-symbols-outlined opacity-30 text-3xl">auto_graph</span>
                    </div>
                </div>

                <!-- Recent Activity Feed -->
                <div class="mt-8 space-y-3">
                    <p class="text-[9px] uppercase font-black tracking-[0.2em] opacity-40">Последние регистрации</p>
                    ${state.adminUsers?.map(user => `
                        <div class="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between backdrop-blur-sm">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-[10px] font-black">${user.telegram_chat_id.toString().slice(0,2)}</div>
                                <div>
                                    <p class="text-xs font-bold font-headline">ID: ${user.telegram_chat_id}</p>
                                    <p class="text-[8px] opacity-40 uppercase tracking-tighter">${new Date(user.joined_at).toLocaleDateString()}</p>
                                </div>
                            </div>
                            <span class="px-2 py-0.5 rounded text-[8px] font-black uppercase ${user.wb_token ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}">
                                ${user.wb_token ? 'TOKEN OK' : 'NO TOKEN'}
                            </span>
                        </div>
                    `).join('')}
                </div>
            </section>
            ` : ''}

            <button onclick="handleSync()" class="w-full bg-surface-container-high border border-outline-variant/10 text-on-surface py-5 rounded-2xl font-black font-headline flex items-center justify-center gap-3 active:scale-[0.98] transition-all mb-8 shadow-lg group">
                <span class="material-symbols-outlined text-primary group-hover:rotate-180 transition-transform duration-500">sync</span>
                Синхронизировать отзывы
            </button>

            <!-- Subscription Status Card -->
            <section class="relative overflow-hidden p-6 rounded-2xl bg-surface-container-high border-2 ${daysLeft > 3 ? 'border-primary/30' : 'border-error/30'} shadow-xl shadow-primary/5">
                <div class="relative z-10 flex items-center justify-between">
                    <div class="flex items-start gap-4">
                        <div class="w-12 h-12 rounded-xl ${daysLeft > 3 ? 'bg-primary/20' : 'bg-error/20'} flex items-center justify-center flex-shrink-0">
                            <span class="material-symbols-outlined ${daysLeft > 3 ? 'text-primary' : 'text-error'} text-2xl" style="font-variation-settings: 'FILL' 1;">
                                ${daysLeft > 0 ? 'workspace_premium' : 'lock'}
                            </span>
                        </div>
                        <div>
                            <h3 class="font-headline font-bold text-on-surface text-base mb-1">
                                ${state.settings.subscription_status === 'premium' ? 'Premium Доступ' : 'Бесплатный план'}
                            </h3>
                            <p class="text-sm text-on-surface-variant font-medium">Активен до: <span class="text-on-surface italic">${expiredDateStr}</span></p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] uppercase font-black text-on-surface-variant/50 mb-1">Осталось</p>
                        <p class="text-2xl font-black font-headline ${daysLeft > 3 ? 'text-primary' : 'text-error'}">${daysLeft} дн.</p>
                    </div>
                </div>
                ${state.settings.is_top_5 ? `
                <div class="mt-4 pt-4 border-t border-outline-variant/10">
                    <p class="text-xs text-on-surface-variant/80">Вы получили этот доступ как <span class="text-primary font-bold">Первопроходец</span> (Топ-5 пользователей).</p>
                </div>
                ` : ''}
            </section>

            <!-- Pricing Tier Card (Premium Offer) -->
            <section class="p-8 rounded-[2rem] bg-surface-container-lowest relative border border-outline-variant/20 shadow-2xl overflow-hidden group">
                <div class="absolute top-0 right-0 p-4">
                    <div class="bg-primary/15 px-4 py-1.5 rounded-full border border-primary/30 backdrop-blur-md">
                        <span class="text-[11px] font-black text-primary tracking-tighter">-50% OFF</span>
                    </div>
                </div>

                <div class="mb-8">
                    <span class="text-[10px] font-black tracking-[0.3em] text-primary/60 uppercase mb-3 block">WBReply AI • Premium</span>
                    <h2 class="font-headline text-3xl font-extrabold text-on-surface leading-tight mb-4">Стартовое Предложение</h2>
                    
                    <div class="flex items-baseline gap-3 mb-2">
                        <span class="text-5xl font-black font-headline text-on-surface tracking-tighter">499 ₽</span>
                        <span class="text-xl font-medium text-on-surface-variant/40 line-through">999 ₽</span>
                    </div>
                    <p class="text-xs text-on-surface-variant/60 font-semibold mb-4 uppercase tracking-wider">за первый месяц пользования</p>
                    
                    <div class="py-2 px-4 bg-primary/10 rounded-xl inline-flex items-center gap-2 border border-primary/20">
                        <span class="material-symbols-outlined text-primary text-sm">schedule</span>
                        <p class="text-[11px] font-bold text-primary">Далее автопродление 999 ₽/мес.</p>
                    </div>
                </div>

                <div class="space-y-5 mb-10">
                    <div class="flex items-center gap-4 group/item">
                        <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center transition-colors group-hover/item:bg-primary/20">
                            <span class="material-symbols-outlined text-xl text-primary" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                        </div>
                        <span class="text-sm font-semibold text-on-surface/90">Безлимитные ИИ-ответы на отзывы</span>
                    </div>
                    <div class="flex items-center gap-4 group/item">
                        <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center transition-colors group-hover/item:bg-primary/20">
                            <span class="material-symbols-outlined text-xl text-primary" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                        </div>
                        <span class="text-sm font-semibold text-on-surface/90">Умная матрица кросс-сейл допродаж</span>
                    </div>
                    <div class="flex items-center gap-4 group/item">
                        <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center transition-colors group-hover/item:bg-primary/20">
                            <span class="material-symbols-outlined text-xl text-primary" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                        </div>
                        <span class="text-sm font-semibold text-on-surface/90">Tone of Voice: персональные инструкции</span>
                    </div>
                </div>

                <button onclick="showToast('Оплата временно недоступна')" class="w-full py-5 premium-gradient rounded-2xl font-headline font-black text-on-primary-container shadow-[0_8px_32px_rgba(173,198,255,0.3)] hover:shadow-[0_12px_48px_rgba(173,198,255,0.4)] hover:brightness-110 active:scale-[0.97] duration-300 transition-all uppercase tracking-widest text-sm flex items-center justify-center gap-3">
                    <span>Оплатить подписку</span>
                    <span class="material-symbols-outlined font-bold">bolt</span>
                </button>
                
                <p class="text-[9px] text-center text-on-surface-variant/40 mt-6 leading-relaxed uppercase font-bold tracking-widest">
                    Безопасная оплата • Отмена в любой момент
                </p>
            </section>
            
            <!-- Footer Links -->
            <footer class="pt-8 pb-12 flex flex-col items-center gap-6">
                <div class="flex gap-8">
                    <a class="text-[11px] font-bold text-on-surface-variant/50 hover:text-primary transition-colors uppercase tracking-widest" href="offer.html">Оферта</a>
                    <a class="text-[11px] font-bold text-on-surface-variant/50 hover:text-primary transition-colors uppercase tracking-widest" href="https://t.me/edh4hhr" target="_blank">Поддержка</a>
                </div>
                <div class="flex flex-col items-center gap-1 opacity-30">
                    <p class="text-[10px] text-on-surface font-black uppercase tracking-[0.5em]">WBReply AI</p>
                    <p class="text-[8px] text-on-surface font-bold">PRODUCTION BUILD • v2.4.0</p>
                </div>
            </footer>
        </div>
    `;
}

async function handleSaveSettings() {
    const tokenInput = document.getElementById('wb-token-input');
    const instructionsInput = document.getElementById('ai-instructions-input');
    
    if (tokenInput) state.settings.wb_token = tokenInput.value;
    if (instructionsInput) state.settings.custom_instructions = instructionsInput.value;
    
    // Auto-reply is forced to true globally
    state.settings.is_auto_reply_enabled = true;
    state.settings.auto_reply_min_rating = 1;
    
    await saveSettings();
}

async function saveSettings() {
    try {
        const res = await fetch(`/api/settings/${state.telegramChatId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.settings)
        });
        const data = await res.json();
        if (data.settings) state.settings = data.settings;
        showToast('Конфигурация сохранена');
    } catch (e) {
        console.error('Save settings error:', e);
        showToast('Ошибка сохранения', true);
    }
}

async function handleSync() {
    try {
        if (!state.settings.wb_token) {
            showToast('Сначала введите WB Токен в настройках', true);
            return;
        }
        showToast('Запуск синхронизации...', false);
        const res = await fetch(`/api/sync/${state.telegramChatId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(data.message);
            await refreshData();
            showView('subscription');
        } else {
            showToast(data.error || 'Ошибка синхронизации', true);
        }
    } catch (e) {
        console.error('Sync error:', e);
        showToast('Ошибка сети', true);
    }
}

function showView(view) {
    state.currentView = view;
    const content = document.getElementById('content-view');
    if (!content) return;

    // Update Nav active classes
    document.querySelectorAll('.tab-item').forEach(item => {
        item.classList.remove('active', 'bg-[#2A2A2A]', 'text-[#ADC6FF]');
        item.classList.add('text-[#C1C6D7]');
        const icon = item.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 0";
    });
    
    const activeNav = document.getElementById(`nav-${view}`);
    if (activeNav) {
        activeNav.classList.add('active', 'bg-[#2A2A2A]', 'text-[#ADC6FF]');
        activeNav.classList.remove('text-[#C1C6D7]');
        const icon = activeNav.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 1";
    }

    if (view === 'settings') {
        content.innerHTML = renderSettings();
    } else if (view === 'matrix') {
        content.innerHTML = renderMatrix();
    } else if (view === 'subscription') {
        content.innerHTML = renderSubscription();
    }
}

async function handleAddMatrixRow() {
    const nm_id = document.getElementById('new-nm-id').value;
    const cross_sell_article = document.getElementById('new-cross-id').value;
    if (!nm_id || !cross_sell_article) return showToast('Заполните оба поля', true);

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_chat_id: state.telegramChatId, nm_id, cross_sell_article })
        });
        
        const data = await res.json();
        if (res.ok) {
            await refreshData();
            showView('matrix');
            showToast('Пара добавлена');
        } else {
            showToast(data.error || 'Ошибка сохранения', true);
        }
    } catch (e) {
        showToast('Ошибка сети', true);
    }
}

async function handleDeleteMatrix(id) {
    try {
        await fetch(`/api/matrix/${id}`, { method: 'DELETE' });
        await refreshData();
        showView('matrix');
        showToast('Пара удалена');
    } catch (e) {
        showToast('Ошибка удаления', true);
    }
}

function toggleTokenVisibility() {
    const input = document.getElementById('wb-token-input');
    const icon = document.getElementById('token-visibility-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.innerText = 'visibility_off';
    } else {
        input.type = 'password';
        icon.innerText = 'visibility';
    }
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full text-white text-xs font-bold z-[100] transition-all transform scale-90 opacity-0 ${isError ? 'bg-error-container text-on-error-container border border-error' : 'bg-primary text-on-primary'}`;
    toast.innerText = message;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.classList.remove('scale-90', 'opacity-0');
        toast.classList.add('scale-100', 'opacity-100');
    });

    setTimeout(() => {
        toast.classList.remove('scale-100', 'opacity-100');
        toast.classList.add('scale-90', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}
