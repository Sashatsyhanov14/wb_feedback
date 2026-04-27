let state = {
    sellerId: null,
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
    currentView: 'reviews',
    stats: { approved: 0, pending: 0, total: 0, approvedToday: 0 },
    adminStats: { totalSellers: 0, totalApproved: 0, newToday: 0, activeToday: 0, withoutToken: 0 },
    adminUsers: []
};

document.addEventListener('DOMContentLoaded', async () => {
    // Fast path: if no token cookie exists and not in Telegram, show login immediately
    const hasToken = document.cookie.includes('auth_token=');
    const isTelegram = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData;
    
    if (!hasToken && !isTelegram) {
        showView('login');
        return; // Skip API check
    }

    // 1. Check Auth (Web or Mini App)
    await checkAuth();

    // 2. Initial View
    if (!state.sellerId) {
        showView('login');
    } else {
        showView('reviews');
        refreshData(); // Don't await to render faster
        showView(state.currentView);
    }

    // 3. Handle Payment Redirect Hash
    if (window.location.hash === '#success') {
        showToast('Оплата прошла успешно');
        window.location.hash = '';
    } else if (window.location.hash === '#fail') {
        showToast('Ошибка оплаты. Попробуйте снова.', true);
        window.location.hash = '';
    }
});

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            state.sellerId = data.sellerId;
        } else if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
            // Automatic login for Mini App
            const tg = window.Telegram.WebApp;
            tg.expand();
            tg.ready();
            
            const rawData = tg.initDataUnsafe;
            const resAuth = await fetch('/api/auth/tg-callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rawData.user)
            });
            if (resAuth.ok) {
                const data = await resAuth.json();
                state.sellerId = data.sellerId;
            }
        }
    } catch (e) {
        console.error('Auth check error:', e);
    }
}

async function refreshData() {
    if (!state.sellerId) return;
    try {
        const adminId = '795056847';
        const requests = [
            fetch(`/api/settings`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/matrix`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/stats`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/reviews`).then(r => r.status === 200 ? r.json() : null)
        ];

        if (state.sellerId.toString() === adminId) {
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

async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
}

function showView(view) {
    state.currentView = view;
    const content = document.getElementById('content-view');
    const nav = document.getElementById('main-nav');
    const sidebar = document.getElementById('desktop-sidebar');
    const mobileHeader = document.getElementById('mobile-header');
    if (!content) return;

    // Hide chrome on login, show on everything else
    if (view === 'login') {
        if (nav) nav.style.display = 'none';
        if (sidebar) sidebar.style.display = 'none';
        if (mobileHeader) mobileHeader.style.display = 'none';
    } else {
        if (nav) nav.style.display = '';
        if (sidebar) sidebar.style.display = '';
        if (mobileHeader) mobileHeader.style.display = '';
    }

    // Update Nav active classes (Mobile & Desktop)
    const navItems = document.querySelectorAll('.tab-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        const icon = item.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 0";
    });
    
    // Highlight matching elements in both navs
    const activeElements = document.querySelectorAll(`[onclick="showView('${view}')"]`);
    activeElements.forEach(el => {
        el.classList.add('active');
        const icon = el.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 1";
    });

    if (view === 'settings') {
        content.innerHTML = renderSettings();
    } else if (view === 'reviews') {
        content.innerHTML = renderReviews();
    } else if (view === 'subscription') {
        content.innerHTML = renderSubscription();
    } else if (view === 'interface') {
        content.innerHTML = renderInterface();
    } else if (view === 'login') {
        content.innerHTML = renderLogin();
    }
}

function renderLogin() {
    return `
        <div class="flex flex-col items-center justify-center min-h-[85vh] animate-in px-4">
            <div class="w-full max-w-[380px] space-y-10">
                <div class="space-y-3 text-center">
                    <h2 class="flex items-center justify-center font-headline text-3xl sm:text-4xl font-black tracking-tight leading-tight mb-2">
                        <span class="text-text-main">WBREPLY</span>
                        <svg class="w-6 h-6 sm:w-8 sm:h-8 text-[#E1AF66] mx-1 sm:mx-1.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0C12 6.627 6.627 12 0 12C6.627 12 12 17.373 12 24C12 17.373 17.373 12 24 12C17.373 12 12 6.627 12 0Z"/>
                        </svg>
                        <span class="text-[#E1AF66]">AI</span>
                    </h2>
                    <p class="text-on-surface-variant text-sm font-medium tracking-wide">
                        В один клик, без паролей и регистраций
                    </p>
                </div>
                
                <div class="flex flex-col gap-4">
                    <!-- Google Button -->
                    <button onclick="handleGoogleLogin()" class="w-full h-16 flex items-center justify-center gap-4 bg-white hover:bg-gray-100 active:scale-[0.97] transition-all rounded-[12px] shadow-lg shadow-black/10 border border-gray-200">
                        <svg class="w-6 h-6" viewBox="0 0 48 48">
                            <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                            <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                            <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                            <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                        </svg>
                        <span class="text-base font-bold text-gray-900">Войти через Google</span>
                    </button>

                    <!-- VK Button -->
                    <button onclick="handleTestLogin('VK')" class="w-full h-16 flex items-center justify-center gap-4 bg-[#0077FF] hover:brightness-110 active:scale-[0.97] transition-all rounded-[12px] shadow-lg shadow-[#0077FF]/30">
                        <svg class="w-8 h-8" viewBox="0 0 24 24" fill="white">
                            <path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.833 17.333h-1.75c-.53 0-.7-.42-1.66-1.38-.84-.8-1.21-.9-1.42-.9-.3 0-.38.08-.38.51v1.1c0 .4-.13.67-1.17.67-1.72 0-3.62-1.04-4.96-2.95-2-2.85-2.57-5.01-2.57-5.44 0-.25.1-.48.58-.48h1.75c.43 0 .59.19.75.62.86 2.5 2.31 4.7 2.91 4.7.22 0 .32-.1.32-.65V10c0-.7-.41-.76-.41-1.01 0-.12.1-.24.26-.24h2.74c.23 0 .33.11.33.36v3.7c0 .4.18.54.34.54.26 0 .47-.14.94-.61 1.05-1.18 1.84-3.5 1.84-3.5.12-.3.29-.49.72-.49h1.75c.53 0 .65.27.53.67-.38 1.4-2.5 4.36-2.5 4.36-.2.33-.27.46 0 .82.2.26.85.83 1.28 1.34.78.93 1.37 1.7 1.53 2.23.16.53-.1.82-.63.82z"/>
                        </svg>
                        <span class="text-base font-bold text-white">Войти через ВКонтакте</span>
                    </button>

                    <!-- Telegram Button -->
                    <button onclick="handleTestLogin('Telegram')" class="w-full h-16 flex items-center justify-center gap-4 bg-[#24A1DE] hover:brightness-110 active:scale-[0.97] transition-all rounded-[12px] shadow-lg shadow-[#24A1DE]/30">
                        <svg class="w-8 h-8 fill-white" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.74 7.58-3.27 3.61-1.51 4.35-1.77 4.84-1.78.11 0 .35.03.5.16.12.1.16.23.18.33.02.11.02.24.01.37z"/>
                        </svg>
                        <span class="text-base font-bold text-white tracking-tight">Войти через Telegram</span>
                    </button>
                </div>

                <div class="flex flex-col items-center gap-6 pt-8 opacity-30">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">verified_user</span>
                        <p class="text-[9px] font-bold uppercase tracking-[0.3em]">Secure Auth System</p>
                    </div>
                    <p class="text-[10px] font-medium tracking-[0.1em]">© 2025 WB RESPONSE AI</p>
                </div>
            </div>
        </div>
    `;
}

async function handleTestLogin(provider) {
    showToast(`Вход через ${provider} (Тестовый режим)...`);
    try {
        const res = await fetch('/api/auth/demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (res.ok) {
            const data = await res.json();
            state.sellerId = data.sellerId;
            showToast('Успешный вход!', false);
            setTimeout(() => {
                showView('reviews');
                refreshData();
            }, 800);
        } else {
            // Fallback for UI-only testing if backend is not ready
            state.sellerId = '795056847';
            showToast('Вход (UI-Demo режим)', false);
            setTimeout(() => {
                showView('reviews');
                refreshData();
            }, 800);
        }
    } catch (err) {
        // Even on network error, allow entering for UI demonstration
        state.sellerId = '795056847';
        showToast('Вход (Offline-Demo)', false);
        setTimeout(() => {
            showView('reviews');
            refreshData();
        }, 800);
    }
}

async function handleGoogleLogin() {
    window.location.href = '/api/auth/google';
}

async function handleVkLogin() {
    // Replaced by handleTestLogin for testing
}


window.onTelegramAuth = async function(user) {
    try {
        const res = await fetch('/api/auth/tg-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        
        if (res.ok) {
            const data = await res.json();
            state.sellerId = data.sellerId;
            showToast('Успешный вход');
            showView('reviews');
            await refreshData();
            showView(state.currentView);
        } else {
            const data = await res.json();
            showToast(data.error || 'Ошибка входа', true);
        }
    } catch (e) {
        console.error('Auth callback error:', e);
        showToast('Ошибка сети', true);
    }
}

function renderSettings() {
    return `
        <div class="max-w-2xl mx-auto space-y-10 animate-in pb-10">
            <header class="text-left">
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Конфигурация</p>
                <h2 class="font-headline text-3xl sm:text-4xl font-bold text-text-main tracking-tight">Бизнес-настройка</h2>
            </header>

            <div class="space-y-5">
                <section class="premium-card p-5 sm:p-8 space-y-5">
                    <div class="space-y-2">
                        <label class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">API Токен Wildberries</label>
                        <div class="relative">
                            <input id="wb-token-input" class="w-full bg-bg-main border border-outline-variant outline-none py-4 px-5 pr-12 text-text-main text-sm font-mono focus:border-primary transition-colors rounded-lg" 
                                type="password" value="${state.settings.wb_token || ''}" placeholder="Вставьте ваш Standard API ключ">
                            <button class="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors" onclick="toggleTokenVisibility()">
                                <span id="token-visibility-icon" class="material-symbols-outlined text-lg">visibility</span>
                            </button>
                        </div>
                        <p class="text-[10px] text-on-surface-variant leading-relaxed">
                            Используйте ключ типа "Стандартный". Мы не имеем доступа к вашим продажам и финансам.
                        </p>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Инструкции для ИИ</label>
                        <textarea id="ai-instructions-input" class="w-full bg-bg-main border border-outline-variant outline-none p-5 text-text-main text-sm leading-relaxed h-40 sm:h-48 focus:border-primary transition-colors resize-none rounded-lg" 
                            placeholder="Пример: Будь профессионален, обращайся на Вы, упоминай наш бренд...">${state.settings.custom_instructions || ''}</textarea>
                        <div class="flex gap-2 flex-wrap">
                            <span class="text-[9px] font-black text-primary uppercase border border-primary/20 px-2 py-0.5 rounded">Tone of Voice</span>
                            <span class="text-[9px] font-black text-on-surface-variant uppercase border border-outline-variant px-2 py-0.5 rounded">Умная логика</span>
                        </div>
                    </div>
                </section>

                <button onclick="handleSaveSettings()" class="primary-btn w-full py-4 sm:py-5 text-xs uppercase tracking-[0.2em] shadow-lg active:scale-[0.99] transition-all">
                    Применить настройки
                </button>
            </div>
        </div>
    `;
}

function renderReviews() {
    if (!state.reviews || state.reviews.length === 0) {
        return `
            <div class="flex flex-col items-center justify-center py-24 text-center animate-in opacity-40">
                <span class="material-symbols-outlined text-5xl mb-4 font-light">inventory_2</span>
                <p class="text-xs font-bold uppercase tracking-widest">Нет данных об активности</p>
            </div>
        `;
    }

    return `
        <div class="w-full space-y-8 animate-in pb-10">
            <header>
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Активность</p>
                <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">Лента ответов</h2>
            </header>

            <!-- Mobile card layout -->
            <div class="sm:hidden space-y-3">
                ${state.reviews.map(review => {
                    const isAuto = review.status === 'auto_posted';
                    return `
                        <div class="premium-card p-4 space-y-3 relative overflow-hidden">
                            ${isAuto ? '<div class="absolute left-0 top-0 bottom-0 w-1 bg-wb-purple"></div>' : ''}
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="flex items-center gap-0.5 text-primary font-bold text-xs">
                                        ${review.rating}
                                        <svg class="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                                            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                                        </svg>
                                    </span>
                                    <span class="text-text-main font-bold text-[11px] truncate uppercase tracking-tight">${review.product_name || 'WB Product'}</span>
                                </div>
                                <span class="w-2 h-2 rounded-full ${isAuto ? 'bg-wb-purple shadow-[0_0_8px_rgba(124,58,237,0.5)]' : 'bg-outline-variant'}"></span>
                            </div>
                            <p class="text-[11px] text-on-surface-variant italic font-light leading-relaxed line-clamp-2">"${review.review_text}"</p>
                            <p class="text-[11px] text-text-main leading-relaxed line-clamp-2">${review.ai_response_draft}</p>
                        </div>
                    `;
                }).join('')}
            </div>

            <!-- Desktop table layout -->
            <div class="hidden sm:block border border-outline-variant rounded-lg overflow-hidden">
                <div class="grid grid-cols-12 gap-4 px-6 py-4 bg-bg-main border-b border-outline-variant text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                    <div class="col-span-1">Рейтинг</div>
                    <div class="col-span-3">Товар</div>
                    <div class="col-span-3">Отзыв</div>
                    <div class="col-span-4">Ответ ИИ</div>
                    <div class="col-span-1 text-right">Статус</div>
                </div>
                <div class="divide-y divide-outline-variant">
                    ${state.reviews.map(review => {
                        const isAuto = review.status === 'auto_posted';
                        return `
                            <div class="grid grid-cols-12 gap-4 px-6 py-5 items-center hover:bg-bg-main transition-colors relative overflow-hidden">
                                ${isAuto ? '<div class="absolute left-0 top-0 bottom-0 w-1 bg-wb-purple"></div>' : ''}
                                <div class="col-span-1 flex items-center gap-1 text-primary font-bold text-xs">
                                    ${review.rating}
                                    <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24">
                                        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                                    </svg>
                                </div>
                                <div class="col-span-3 min-w-0">
                                    <div class="text-text-main font-bold text-[11px] truncate uppercase tracking-tight">${review.product_name || 'WB Product'}</div>
                                    <div class="text-[9px] text-on-surface-variant font-mono">SKU: ${review.nm_id}</div>
                                </div>
                                <div class="col-span-3 text-[11px] text-on-surface-variant line-clamp-2 italic font-light leading-relaxed">
                                    "${review.review_text}"
                                </div>
                                <div class="col-span-4 text-[11px] text-text-main line-clamp-2 leading-relaxed">
                                    ${review.ai_response_draft}
                                </div>
                                <div class="col-span-1 flex justify-end">
                                    <span class="w-2 h-2 rounded-full ${isAuto ? 'bg-wb-purple' : 'bg-outline-variant'} shadow-[0_0_8px_rgba(124,58,237,0.5)]"></span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderSubscription() {
    const expiresAt = state.settings.subscription_expires_at;
    const diff = expiresAt ? new Date(expiresAt) - new Date() : 0;
    const daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    const expiredDateStr = expiresAt ? new Date(expiresAt).toLocaleDateString() : '—';
    
    return `
        <div class="max-w-2xl mx-auto space-y-8 animate-in pb-8">
            <header>
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Финансы и показатели</p>
                <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">Обзор аккаунта</h2>
            </header>

            <div class="grid grid-cols-2 gap-3 sm:gap-4">
                <div class="premium-card p-5 sm:p-8">
                    <p class="text-[9px] font-black uppercase tracking-[0.3em] text-on-surface-variant mb-3">Сегодня</p>
                    <p class="text-3xl sm:text-4xl font-bold text-text-main tracking-tighter">${state.stats?.approvedToday || 0}</p>
                </div>
                <div class="premium-card p-5 sm:p-8">
                    <p class="text-[9px] font-black uppercase tracking-[0.3em] text-on-surface-variant mb-3">Всего ответов</p>
                    <p class="text-3xl sm:text-4xl font-bold text-text-main tracking-tighter">${state.stats?.approved || 0}</p>
                </div>
            </div>

            <section class="premium-card p-5 sm:p-8 flex items-center justify-between gap-4">
                <div class="space-y-1 min-w-0">
                    <h3 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Тарифный план</h3>
                    <p class="text-xs text-on-surface-variant">Истекает: <span class="text-text-main font-mono">${expiredDateStr}</span></p>
                </div>
                <div class="text-right flex-shrink-0">
                    <p class="text-[9px] uppercase font-black text-on-surface-variant mb-1">Осталось</p>
                    <p class="text-2xl sm:text-3xl font-bold ${daysLeft > 3 ? 'text-primary' : 'text-red-400'}">${daysLeft} дн.</p>
                </div>
            </section>

            <section class="premium-card p-6 sm:p-10 space-y-6">
                <div class="space-y-3">
                    <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tighter">Premium Доступ</h2>
                    <div class="flex items-baseline gap-2">
                        <span class="text-3xl sm:text-4xl font-bold text-primary">₽749</span>
                        <span class="text-sm font-medium text-on-surface-variant">/ месяц</span>
                    </div>
                </div>
                
                <button onclick="handlePayment()" class="primary-btn w-full py-4 sm:py-5 text-xs uppercase tracking-[0.2em] shadow-lg active:scale-[0.99] transition-all">
                    Активировать безлимит
                </button>
                
                <p class="text-[10px] text-center text-on-surface-variant uppercase font-bold tracking-widest">
                    Безопасная оплата • Мгновенная активация
                </p>
            </section>
        </div>
    `;
}

// Actions
async function handleSaveSettings() {
    state.settings.wb_token = document.getElementById('wb-token-input').value;
    state.settings.custom_instructions = document.getElementById('ai-instructions-input').value;
    
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.settings)
        });
        if (res.ok) {
            showToast('Конфигурация сохранена');
            await refreshData();
        } else {
            showToast('Ошибка сохранения', true);
        }
    } catch (e) { showToast('Ошибка сети', true); }
}

function setTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    }
    showView('interface'); 
    showToast(`Тема: ${theme === 'dark' ? 'Темная' : 'Светлая'}`);
}

function renderInterface() {
    const isDark = document.documentElement.classList.contains('dark');
    
    return `
        <div class="max-w-2xl mx-auto space-y-8 animate-in pb-10">
            <header>
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Система</p>
                <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">Параметры интерфейса</h2>
            </header>

            <div class="space-y-5">
                <section class="premium-card p-5 sm:p-8 space-y-6">
                    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Цветовая тема</h4>
                            <p class="text-xs text-on-surface-variant">Выберите оформление приложения</p>
                        </div>
                        <div class="flex border border-outline-variant p-1 rounded-lg bg-bg-main">
                            <button onclick="setTheme('dark')" class="px-4 py-2 ${isDark ? 'bg-primary text-bg-main shadow-lg' : 'text-on-surface-variant'} rounded-md text-[10px] font-black uppercase tracking-widest transition-all">Темная</button>
                            <button onclick="setTheme('light')" class="px-4 py-2 ${!isDark ? 'bg-primary text-white shadow-lg' : 'text-on-surface-variant'} rounded-md text-[10px] font-black uppercase tracking-widest transition-all">Светлая</button>
                        </div>
                    </div>


                </section>

                <section class="premium-card p-5 sm:p-8 border-primary/20 bg-primary/5">
                    <div class="flex items-start gap-4">
                        <span class="material-symbols-outlined text-primary">info</span>
                        <div class="space-y-1">
                            <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Версия ПО</h4>
                            <p class="text-xs text-on-surface-variant">WB Response v2.4.0 (Стабильная сборка). Система готова к работе.</p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    `;
}

async function handleSync() {
    if (!state.settings.wb_token) return showToast('Сначала добавьте API токен', true);
    showToast('Синхронизация...');
    try {
        const res = await fetch('/api/sync', { method: 'POST' });
        if (res.ok) {
            showToast('Готово');
            await refreshData();
            showView('reviews');
        } else { showToast('Ошибка синхронизации', true); }
    } catch (e) { showToast('Ошибка сети', true); }
}



async function handlePayment() {
    showToast('Обработка...');
    try {
        const res = await fetch('/api/payments/create', { method: 'POST' });
        const data = await res.json();
        if (data.url) {
            window.location.href = data.url;
        } else { showToast('Ошибка платежа', true); }
    } catch (e) { showToast('Ошибка сети', true); }
}

// Utils
function toggleTokenVisibility() {
    const input = document.getElementById('wb-token-input');
    const icon = document.getElementById('token-visibility-icon');
    input.type = input.type === 'password' ? 'text' : 'password';
    icon.innerText = input.type === 'password' ? 'visibility' : 'visibility_off';
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-24 left-1/2 -translate-x-1/2 px-8 py-4 text-xs font-bold z-[100] uppercase tracking-widest animate-toast rounded-lg ${
        isError 
            ? 'bg-red-50 text-red-700 border border-red-200' 
            : ''
    }`;
    toast.style.background = isError ? '' : 'var(--c-toast-bg)';
    toast.style.color = isError ? '' : 'var(--c-primary)';
    toast.style.border = isError ? '' : '1px solid var(--c-toast-border)';
    toast.style.boxShadow = '0 10px 25px -5px rgb(0 0 0 / 0.15)';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}
