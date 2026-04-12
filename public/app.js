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
            state.settings = await res.json();
        }
        
        const matrixRes = await fetch(`/api/matrix/${state.telegramChatId}`);
        if (matrixRes.status === 200) {
            state.matrix = await matrixRes.json();
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
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_chat_id: state.telegramChatId,
                ...state.settings
            })
        });
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
        <div class="animate-in space-y-6">
            <!-- User Identity -->
            <section class="flex items-center justify-between p-4 rounded-xl bg-surface-container-low">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full premium-gradient flex items-center justify-center text-on-primary font-bold text-lg">
                        ${state.telegramChatId.toString().slice(0, 2)}
                    </div>
                    <div>
                        <p class="text-sm font-label text-on-surface-variant leading-none mb-1">Telegram User</p>
                        <p class="text-base font-bold font-headline tracking-wide">ID: ${state.telegramChatId}</p>
                    </div>
                </div>
                <span class="material-symbols-outlined text-outline">verified_user</span>
            </section>

            ${state.settings.is_top_5 ? `
            <!-- Status Card (State A - Winner) -->
            <section class="relative overflow-hidden p-5 rounded-xl bg-surface-container-high border-l-4 border-primary">
                <div class="relative z-10">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="material-symbols-outlined text-primary" style="font-variation-settings: 'FILL' 1;">workspace_premium</span>
                        <h3 class="font-headline font-bold text-on-surface">🎉 Поздравляем! Вы попали в первую пятерку.</h3>
                    </div>
                    <p class="text-sm text-on-surface-variant font-medium">Вам начислен БЕСПЛАТНЫЙ месяц доступа (до: ${expiredDate}).</p>
                </div>
                <!-- Decorative Grain/Light -->
                <div class="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl -mr-16 -mt-16"></div>
            </section>
            ` : ''}

            <!-- Pricing Tier Card (Premium Offer) -->
            <section class="p-6 rounded-2xl bg-surface-container-lowest relative border border-outline-variant/10 shadow-2xl">
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <span class="text-[10px] font-extrabold tracking-[0.2em] text-primary uppercase mb-2 block">Premium Tier</span>
                        <h2 class="font-headline text-2xl font-extrabold text-on-surface">⚡ СТАРТОВОЕ ПРЕДЛОЖЕНИЕ</h2>
                    </div>
                    <div class="bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
                        <span class="text-xs font-bold text-primary">-50%</span>
                    </div>
                </div>
                <div class="mb-8">
                    <div class="flex items-baseline gap-3 mb-1">
                        <span class="text-4xl font-extrabold font-headline text-on-surface">499 ₽</span>
                        <span class="text-xl font-medium text-on-surface-variant line-through opacity-50">999 ₽</span>
                    </div>
                    <p class="text-sm text-on-surface-variant">за первый месяц</p>
                    <div class="mt-3 py-1.5 px-3 bg-surface-container-high rounded-lg inline-block">
                        <p class="text-[11px] font-semibold text-primary">Далее автопродление 999 ₽/мес.</p>
                    </div>
                </div>
                <ul class="space-y-4 mb-8">
                    <li class="flex items-center gap-3">
                        <div class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-[16px] text-primary" style="font-variation-settings: 'FILL' 1;">check</span>
                        </div>
                        <span class="text-sm font-medium text-on-surface">Безлимитные ИИ-ответы на отзывы</span>
                    </li>
                    <li class="flex items-center gap-3">
                        <div class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-[16px] text-primary" style="font-variation-settings: 'FILL' 1;">check</span>
                        </div>
                        <span class="text-sm font-medium text-on-surface">Матрица кросс-сейл допродаж</span>
                    </li>
                    <li class="flex items-center gap-3">
                        <div class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-[16px] text-primary" style="font-variation-settings: 'FILL' 1;">check</span>
                        </div>
                        <span class="text-sm font-medium text-on-surface">Персональные инструкции для ИИ (Tone of Voice)</span>
                    </li>
                </ul>
                <button onclick="showToast('Оплата временно недоступна')" class="w-full py-4 premium-gradient rounded-xl font-headline font-extrabold text-on-primary-container shadow-[0_4px_24px_rgba(173,198,255,0.2)] active:scale-95 duration-150 transition-all">
                    Оплатить 499 ₽
                </button>
                <p class="text-[10px] text-center text-outline mt-4 leading-relaxed">
                    Безопасная оплата через сертифицированные шлюзы. <br/> Отмена подписки возможна в любой момент в настройках.
                </p>
            </section>
            
            <!-- Footer Links -->
            <footer class="pt-4 pb-8 flex flex-col items-center gap-4">
                <div class="flex gap-6">
                    <a class="text-xs font-medium text-on-surface-variant hover:text-primary transition-colors" href="#">Публичная оферта</a>
                    <a class="text-xs font-medium text-on-surface-variant hover:text-primary transition-colors" href="#">Поддержка</a>
                </div>
                <p class="text-[10px] text-outline uppercase tracking-widest opacity-40">WBReply AI • v2.4.0</p>
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
