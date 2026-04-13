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
    currentView: 'settings'
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize TG WebApp
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.expand();
        tg.ready();
        state.telegramChatId = tg.initDataUnsafe.user?.id || 'TEST_USER_123';
    } else {
        state.telegramChatId = 'TEST_USER_123';
    }

    // 2. Initial View (Immediate render)
    showView('settings');

    // 3. Load Data & Update
    await refreshData();
    showView(state.currentView);
});

async function refreshData() {
    try {
        const res = await fetch(`/api/settings/${state.telegramChatId}`);
        if (res.status === 200) {
            const data = await res.json();
            state.settings = { ...state.settings, ...data };
        }
        
        const matrixRes = await fetch(`/api/matrix/${state.telegramChatId}`);
        if (matrixRes.status === 200) {
            state.matrix = await matrixRes.json();
        }

        const statsRes = await fetch(`/api/stats/${state.telegramChatId}`);
        if (statsRes.status === 200) {
            state.stats = await statsRes.json();
        }

        const reviewsRes = await fetch(`/api/reviews/${state.telegramChatId}`);
        if (reviewsRes.status === 200) {
            state.reviews = await reviewsRes.json();
        }
    } catch (e) {
        console.error('Refresh data error:', e);
    }
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
                <div class="mt-4 flex flex-wrap gap-2">
                    <button class="text-[10px] px-3 py-1.5 bg-surface-container-high rounded-full text-on-surface-variant border border-outline-variant/10">#вежливость</button>
                    <button class="text-[10px] px-3 py-1.5 bg-surface-container-high rounded-full text-on-surface-variant border border-outline-variant/10">#допродажи</button>
                    <button class="text-[10px] px-3 py-1.5 bg-surface-container-high rounded-full text-on-surface-variant border border-outline-variant/10">#официальный_тон</button>
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
                </div>
            </div>

            <div class="mt-8">
                <button onclick="handleAddMatrixRow()" class="w-full premium-gradient h-14 rounded-xl flex items-center justify-center gap-2 text-on-primary font-bold shadow-lg shadow-primary/10 active:scale-[0.98] transition-transform">
                    <span class="material-symbols-outlined">add_circle</span>
                    <span>Добавить новую пару</span>
                </button>
            </div>
        </div>
    `;
}

function renderSubscription() {
    const expiredDate = state.settings.subscription_expires_at ? new Date(state.settings.subscription_expires_at).toLocaleDateString() : '12.06.2026';
    
    return `
        <div class="animate-in space-y-8 pb-12">
            <!-- User Identity -->
            <section class="flex items-center justify-between p-5 rounded-2xl bg-surface-container-low border border-outline-variant/10">
                <div class="flex items-center gap-4">
                    <div class="w-14 h-14 rounded-2xl premium-gradient flex items-center justify-center text-on-primary font-bold text-xl shadow-lg shadow-primary/20">
                        ${state.telegramChatId.toString().slice(0, 2)}
                    </div>
                    <div>
                        <p class="text-[10px] font-extrabold tracking-widest text-on-surface-variant/50 uppercase mb-1">Telegram User</p>
                        <p class="text-lg font-bold font-headline tracking-wide text-on-surface">ID: ${state.telegramChatId}</p>
                    </div>
                </div>
                <div class="flex flex-col items-end">
                    <p class="text-[10px] font-extrabold text-primary uppercase tracking-widest mb-1">AI Responses</p>
                    <p class="text-xl font-black font-headline text-on-surface">${state.stats?.approved || 0}</p>
                </div>
            </section>

            ${state.settings.is_top_5 ? `
            <!-- Status Card (State A - Winner) -->
            <section class="relative overflow-hidden p-6 rounded-2xl bg-surface-container-high border-2 border-primary/30 shadow-xl shadow-primary/5">
                <div class="relative z-10 flex items-start gap-4">
                    <div class="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <span class="material-symbols-outlined text-primary text-2xl" style="font-variation-settings: 'FILL' 1;">workspace_premium</span>
                    </div>
                    <div>
                        <h3 class="font-headline font-bold text-on-surface text-base mb-1">Приветствуем Первопроходца!</h3>
                        <p class="text-sm text-on-surface-variant font-medium leading-relaxed">Вы попали в топ-5 первых пользователей. Вам начислен <span class="text-primary font-bold">БЕСПЛАТНЫЙ месяц</span> Premium доступа до ${expiredDate}.</p>
                    </div>
                </div>
                <!-- Decorative Grain/Light -->
                <div class="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-3xl -mr-16 -mt-16"></div>
            </section>
            ` : ''}

            <!-- Pricing Tier Card (Premium Offer) -->
            <section class="p-8 rounded-[2rem] bg-surface-container-lowest relative border border-outline-variant/20 shadow-2xl overflow-hidden group">
                <div class="absolute top-0 right-0 p-4">
                    <div class="bg-primary/15 px-4 py-1.5 rounded-full border border-primary/30 backdrop-blur-md">
                        <span class="text-[11px] font-black text-primary tracking-tighter">-50% OFF</span>
                    </div>
                </div>

                <div class="mb-8">
                    <span class="text-[10px] font-black tracking-[0.3em] text-primary/60 uppercase mb-3 block">Legatus AI • Premium</span>
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
                    <a class="text-[11px] font-bold text-on-surface-variant/50 hover:text-primary transition-colors uppercase tracking-widest" href="#">Оферта</a>
                    <a class="text-[11px] font-bold text-on-surface-variant/50 hover:text-primary transition-colors uppercase tracking-widest" href="#">Поддержка</a>
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
    state.settings.wb_token = document.getElementById('wb-token-input').value;
    state.settings.custom_instructions = document.getElementById('ai-instructions-input').value;
    await saveSettings();
}

async function handleAddMatrixRow() {
    const nm_id = document.getElementById('new-nm-id').value;
    const cross_sell_article = document.getElementById('new-cross-id').value;
    if (!nm_id || !cross_sell_article) return showToast('Заполните оба поля', true);

    try {
        await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_chat_id: state.telegramChatId, nm_id, cross_sell_article })
        });
        await refreshData();
        showView('matrix');
        showToast('Пара добавлена');
    } catch (e) {
        showToast('Ошибка добавления', true);
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
