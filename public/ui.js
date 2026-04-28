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
    adminUsers: [],
    tickets: [],
    adminTickets: []
};

document.addEventListener('DOMContentLoaded', async () => {
    // Handle token from URL query (for VK/Google OAuth redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    
    if (urlToken) {
        const cookieStr = `auth_token=${urlToken}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
        document.cookie = cookieStr;
        localStorage.setItem('auth_token', urlToken);
        console.log('Token captured from URL query and saved');
    }

    // Handle Supabase implicit flow hash (for Magic Link)
    // URL looks like: /app#access_token=...&token_type=bearer&type=magiclink
    const hash = window.location.hash;
    let magicLinkProcessed = false;
    
    if (hash && hash.includes('access_token=')) {
        console.log('Supabase implicit token detected in URL hash');
        const hashParams = new URLSearchParams(hash.substring(1));
        const supabaseToken = hashParams.get('access_token');
        
        if (supabaseToken) {
            try {
                const verifyRes = await fetch('/api/auth/magic-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ access_token: supabaseToken })
                });
                
                if (verifyRes.ok) {
                    const data = await verifyRes.json();
                    document.cookie = `auth_token=${data.token}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
                    localStorage.setItem('auth_token', data.token);
                    state.sellerId = data.sellerId;
                    magicLinkProcessed = true;
                    console.log('Magic link auth success, sellerId:', data.sellerId);
                } else {
                    console.error('Magic link verify failed:', await verifyRes.text());
                }
            } catch (e) {
                console.error('Magic link verify error:', e);
            }
        }
        // Clean hash
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check for token in multiple places
    const cookieToken = document.cookie.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
    const localToken = localStorage.getItem('auth_token');
    const activeToken = urlToken || cookieToken || localToken;
    
    // Clean up URL if token was present in query
    if (urlToken) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const isTelegram = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData;
    
    if (!activeToken && !magicLinkProcessed && !isTelegram) {
        showView('login');
        return; // Skip API check
    }

    // 1. Check Auth (Web or Mini App)
    if (!magicLinkProcessed) {
        await checkAuth();
    }

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
        const cookieToken = document.cookie.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
        const localToken = localStorage.getItem('auth_token');
        const token = cookieToken || localToken;
        
        console.log('Checking auth with token:', !!token);

        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/auth/me', { headers });
        
        if (res.ok) {
            const data = await res.json();
            state.sellerId = data.sellerId;
            console.log('Auth success, sellerId:', state.sellerId);
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
        const adminId = '68cfdf5a-25fb-43f5-8672-c03d1bddc29b';
        const requests = [
            fetch(`/api/settings`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/matrix`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/stats`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/reviews`).then(r => r.status === 200 ? r.json() : null),
            fetch(`/api/support`).then(r => r.status === 200 ? r.json() : null)
        ];

        if (state.sellerId.toString() === adminId) {
            requests.push(fetch(`/api/admin/stats`).then(r => r.status === 200 ? r.json() : null));
            // Removed admin/users fetch to keep it simple, or kept if needed
            requests.push(fetch(`/api/admin/support`).then(r => r.status === 200 ? r.json() : null));
            
            // Show Admin tab in UI if not visible
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
        }

        const [settings, matrix, stats, reviews, tickets, adminStats, adminTickets] = await Promise.all(requests);

        if (settings) state.settings = { ...state.settings, ...settings };
        if (matrix) state.matrix = matrix;
        if (stats) state.stats = stats;
        if (reviews) state.reviews = reviews;
        if (tickets) state.tickets = tickets;
        if (adminStats) state.adminStats = adminStats;
        if (adminTickets) state.adminTickets = adminTickets;
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

    // Google Analytics Virtual Page View
    if (typeof gtag === 'function') {
        gtag('event', 'page_view', { page_path: '/' + view });
        if (view === 'login') {
            gtag('event', 'view_login_page');
        }
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
    } else if (view === 'admin') {
        content.innerHTML = renderAdmin();
    } else if (view === 'login') {
        content.innerHTML = renderLogin();
    }
}

function handleTelegramLogin() {
    window.open('https://t.me/WBReplyAIbot?start=login', '_blank');
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
                    <button onclick="handleGoogleLogin()" class="w-full h-14 flex items-center justify-center gap-4 bg-white hover:bg-gray-100 active:scale-[0.97] transition-all rounded-[12px] shadow-sm border border-gray-200">
                        <svg style="width: 20px; height: 20px;" viewBox="0 0 48 48">
                            <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                            <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                            <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                            <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                        </svg>
                        <span class="text-sm font-bold text-gray-900">Войти через Google</span>
                    </button>

                    <!-- VK Button -->
                    <button onclick="handleVkLogin()" class="w-full h-14 flex items-center justify-center gap-4 bg-[#0077FF] hover:bg-[#0066DD] active:scale-[0.97] transition-all rounded-[12px] shadow-sm">
                        <svg style="width: 24px; height: 24px;" viewBox="0 0 28 28" fill="none"><path d="M4.54 4.54C3 6.08 3 8.52 3 13.4v1.2c0 4.88 0 7.32 1.54 8.86C6.08 25 8.52 25 13.4 25h1.2c4.88 0 7.32 0 8.86-1.54C25 21.92 25 19.48 25 14.6v-1.2c0-4.88 0-7.32-1.54-8.86C21.92 3 19.48 3 14.6 3h-1.2C8.52 3 6.08 3 4.54 4.54z" fill="#0077FF"/><path d="M7.56 9.85h1.58c.25 0 .41.16.49.48.73 2.7 2.01 5.06 2.52 5.06.18 0 .26-.08.26-.54v-2.78c-.05-1-.58-1.08-.58-1.44 0-.18.15-.35.39-.35h2.49c.21 0 .29.11.29.46v3.74c0 .21.09.29.15.29.18 0 .33-.08.67-.43a14.22 14.22 0 001.94-3.31c.09-.21.24-.4.51-.4h1.58c.33 0 .41.17.33.46-.14.54-1.54 3.03-2.44 4.31-.14.21-.19.32 0 .57.14.18.59.57.89.91.56.63 1 1.16 1.11 1.53.12.37-.07.56-.44.56h-1.58c-.34 0-.5-.14-.75-.44-.61-.67-1.13-1.31-1.35-1.31-.13 0-.19.05-.19.31v1.01c0 .34-.11.43-.39.43-1.18 0-3.76-.07-5.63-2.72a19.7 19.7 0 01-2.47-5.17c-.09-.25 0-.42.33-.42z" fill="white"/></svg>
                        <span class="text-sm font-bold text-white">Войти через VK ID</span>
                    </button>

    <div class="relative py-2">
                        <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-outline-variant/20"></div></div>
                        <div class="relative flex justify-center text-[9px] uppercase tracking-[0.2em] font-black"><span class="bg-bg-main px-4 text-on-surface-variant/30">Или по почте</span></div>
                    </div>

                    <!-- Magic Link Section -->
                    <div class="space-y-4">
                        <input id="magic-email" type="email" placeholder="email@example.com" class="w-full h-14 bg-bg-main border border-outline-variant/30 focus:border-primary outline-none px-5 rounded-[12px] text-sm transition-all text-center">
                        <button id="magic-btn" onclick="handleMagicLogin()" class="w-full h-14 flex items-center justify-center gap-3 bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] transition-all rounded-[12px] border border-outline-variant/20">
                            <span class="material-symbols-outlined text-primary text-lg">magic_button</span>
                            <span class="text-xs font-bold text-on-surface uppercase tracking-widest">Войти по ссылке</span>
                        </button>
                    </div>
                </div>

                <div class="flex flex-col items-center gap-6 pt-8 opacity-30">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">verified_user</span>
                        <p class="text-[9px] font-bold uppercase tracking-[0.3em]">Secure Auth System</p>
                    </div>
                    <p class="text-[10px] font-medium tracking-[0.1em]">© 2026 WBREPLY AI</p>
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
    if (typeof gtag === 'function') gtag('event', 'login_google');
    window.location.href = '/api/auth/google';
}

async function handleVkLogin() {
    if (typeof gtag === 'function') gtag('event', 'login_vk');
    window.location.href = '/api/auth/vk';
}

async function handleMagicLogin() {
    if (typeof gtag === 'function') gtag('event', 'login_magic');
    const email = document.getElementById('magic-email').value;
    if (!email || !email.includes('@')) {
        return showToast('Введите корректный email', true);
    }

    const btn = document.getElementById('magic-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="animate-spin material-symbols-outlined">sync</span><span>Отправка...</span>';

    try {
        const res = await fetch('/api/auth/magic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        const data = await res.json();
        if (res.ok) {
            showToast('Ссылка отправлена на почту!');
            btn.innerHTML = '<span>Проверьте почту ✉️</span>';
        } else {
            showToast(data.error || 'Ошибка отправки', true);
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    } catch (e) {
        showToast('Ошибка сети', true);
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

function initTelegramWidget() {
    const container = document.getElementById('tg-login-container');
    if (!container) return;

    // Optional: inject official widget if preferred over redirect button
    /*
    const script = document.createElement('script');
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute('data-telegram-login', 'WBReplyAIbot');
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    container.innerHTML = '';
    container.appendChild(script);
    */
}

function initVkOneTap() {
    if (!window.VKIDSDK) return;
    
    const VKID = window.VKIDSDK;
    const container = document.getElementById('vk-onetap-container');
    if (!container) return;
    
    // Clean up previous instance if any
    container.innerHTML = '';

    const redirectUri = window.location.origin + '/api/auth/vk/callback';

    VKID.Config.init({
        app: 54569358,
        redirectUrl: redirectUri,
        responseMode: VKID.ConfigResponseMode.Callback,
        source: VKID.ConfigSource.LOWCODE,
    });

    const oneTap = new VKID.OneTap();
    
    oneTap.render({
        container: container,
        showAlternativeLogin: true
    })
    .on(VKID.WidgetEvents.ERROR, (err) => {
        console.error('VK OneTap Error:', err);
    })
    .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, function (payload) {
        console.log('VK OneTap payload:', JSON.stringify(payload));
        const code = payload.code;
        const deviceId = payload.device_id || '';
        const state = payload.state || '';
        const codeVerifier = payload.code_verifier || '';
        if (code) {
            const params = new URLSearchParams({
                code, device_id: deviceId, state, code_verifier: codeVerifier, source: 'sdk'
            });
            window.location.href = `/api/auth/vk/callback?${params.toString()}`;
        }
    });
}

function initVkFloatingOneTap() {
    // Disabled to avoid UI clutter as requested
    return;
}

function initVkOAuthList() {
    if (!window.VKIDSDK) return;
    
    const VKID = window.VKIDSDK;
    const container = document.getElementById('vk-oauth-list-container');
    if (!container) return;
    
    container.innerHTML = '';

    const oAuth = new VKID.OAuthList();
    oAuth.render({
        container: container,
        oauthList: ['vkid']
    })
    .on(VKID.WidgetEvents.ERROR, (err) => console.error('VK OAuthList Error:', err))
    .on(VKID.OAuthListInternalEvents.LOGIN_SUCCESS, function (payload) {
        console.log('VK OAuthList payload:', JSON.stringify(payload));
        const code = payload.code;
        const deviceId = payload.device_id || '';
        const state = payload.state || '';
        const codeVerifier = payload.code_verifier || '';
        if (code) {
            const params = new URLSearchParams({
                code, device_id: deviceId, state, code_verifier: codeVerifier, source: 'sdk'
            });
            window.location.href = `/api/auth/vk/callback?${params.toString()}`;
        }
    });
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
        <div class="max-w-2xl mx-auto space-y-10 animate-in pb-20">
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
        <div class="w-full space-y-8 animate-in pb-20">
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
        <div class="max-w-2xl mx-auto space-y-8 animate-in pb-20">
            <header>
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Финансы и показатели</p>
                <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">Обзор аккаунта</h2>
            </header>

            <!-- User Profile Card -->
            <section class="premium-card p-5 sm:p-8 flex items-center gap-5">
                <img src="${state.settings.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + state.sellerId}" alt="Avatar" class="w-16 h-16 rounded-full border border-outline-variant object-cover bg-surface/50">
                <div class="space-y-1 min-w-0">
                    <h3 class="text-text-main font-bold text-lg truncate">${state.settings.display_name || 'Пользователь'}</h3>
                    <p class="text-xs text-on-surface-variant truncate">${state.settings.email || 'Нет Email'}</p>
                </div>
            </section>

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
    if (typeof gtag === 'function') gtag('event', 'save_settings');
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
        <div class="max-w-2xl mx-auto space-y-8 animate-in pb-20">
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

                <section class="premium-card overflow-hidden divide-y divide-outline-variant/30">
                    <div class="p-5 sm:p-6 flex items-center justify-between gap-4">
                        <div class="flex items-center gap-4">
                            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                                <span class="material-symbols-outlined text-primary text-xl">support_agent</span>
                            </div>
                            <div>
                                <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Поддержка</h4>
                                <p class="text-[10px] sm:text-[11px] text-on-surface-variant mt-0.5 leading-tight">Помощь и вопросы</p>
                            </div>
                        </div>
                        <button onclick="openSupportModal('support')" class="shrink-0 bg-bg-main border border-outline-variant hover:border-primary text-text-main px-5 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 whitespace-nowrap shadow-sm flex items-center justify-center">
                            Написать
                        </button>
                    </div>

                    <div class="p-5 sm:p-6 flex items-center justify-between gap-4">
                        <div class="flex items-center gap-4">
                            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                                <span class="material-symbols-outlined text-primary text-xl">rate_review</span>
                            </div>
                            <div>
                                <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Отзыв</h4>
                                <p class="text-[10px] sm:text-[11px] text-on-surface-variant mt-0.5 leading-tight">Оценить сервис</p>
                            </div>
                        </div>
                        <button onclick="openSupportModal('feedback')" class="shrink-0 bg-primary text-white dark:text-black px-6 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:brightness-110 active:scale-95 shadow-lg shadow-primary/20 whitespace-nowrap flex items-center justify-center">
                            Оценить
                        </button>
                    </div>
                </section>



                <section class="premium-card p-5 sm:p-8 border-primary/20 bg-primary/5">
                    <div class="flex items-start gap-4">
                        <span class="material-symbols-outlined text-primary">info</span>
                        <div class="space-y-1">
                            <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Версия ПО</h4>
                            <p class="text-xs text-on-surface-variant">WBREPLY AI v2.4.0 (Стабильная сборка). Система готова к работе.</p>
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
    if (typeof gtag === 'function') gtag('event', 'click_payment');
    showToast('Обработка...');
    try {
        const res = await fetch('/api/payments/create', { method: 'POST' });
        const data = await res.json();
        if (data.url) {
            window.location.href = data.url;
        } else { showToast('Ошибка платежа', true); }
    } catch (e) { showToast('Ошибка сети', true); }
}

// Support Modal Logic
function openSupportModal(type) {
    if (typeof gtag === 'function') gtag('event', 'click_' + type);
    const existing = document.getElementById('support-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'support-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm animate-in';
    modal.onclick = () => modal.remove();

    if (type === 'support') {
        const supportTickets = (state.tickets || [])
            .filter(t => t.type === 'support')
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        let messagesHtml = '';
        if (supportTickets.length === 0) {
            messagesHtml = `
                <div class="flex flex-col items-center justify-center h-full text-center opacity-50 space-y-2 pb-10">
                    <span class="material-symbols-outlined text-5xl mb-2">support_agent</span>
                    <p class="text-xs font-bold uppercase tracking-widest">Напишите нам</p>
                    <p class="text-[10px]">Мы ответим в ближайшее время</p>
                </div>
            `;
        } else {
            supportTickets.forEach(t => {
                const time = new Date(t.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                messagesHtml += `
                    <div class="flex justify-end mb-4 animate-in">
                        <div class="bg-primary text-white px-4 py-3 rounded-2xl rounded-tr-none max-w-[80%] min-w-[70px] text-sm shadow-lg shadow-primary/10 relative" style="overflow-wrap: anywhere; word-break: break-word;">
                            <div class="leading-relaxed">${t.message}</div>
                            <div class="text-[9px] text-white/80 text-right mt-1.5 font-bold tabular-nums">${time}</div>
                        </div>
                    </div>
                `;
                if (t.admin_reply) {
                    messagesHtml += `
                        <div class="flex justify-start mb-5 animate-in">
                            <div class="bg-surface-container-highest border border-outline-variant/30 text-text-main px-4 py-3 rounded-2xl rounded-tl-none max-w-[80%] min-w-[70px] text-sm shadow-sm relative mt-3 break-words leading-relaxed" style="overflow-wrap: anywhere; word-break: break-word;">
                                <span class="absolute -top-3 left-2 text-[8px] font-black uppercase tracking-widest text-primary bg-bg-main px-2 py-0.5 rounded border border-outline-variant/30 z-10 shadow-sm">Поддержка</span>
                                <div class="mt-1">${t.admin_reply}</div>
                            </div>
                        </div>
                    `;
                }
            });
        }

        modal.innerHTML = `
            <div class="bg-bg-main w-full h-[100dvh] sm:h-[85vh] sm:max-h-[700px] sm:rounded-2xl flex flex-col relative overflow-hidden shadow-2xl" style="max-width: 480px;" onclick="event.stopPropagation()">
                <!-- Header -->
                <div class="flex justify-between items-center border-b border-outline-variant/30 p-4 shrink-0 bg-surface">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-primary text-3xl">support_agent</span>
                        <div>
                            <h3 class="font-headline text-sm font-bold tracking-tight text-text-main uppercase tracking-widest">Чат с поддержкой</h3>
                            <p class="text-[9px] text-green-500 font-bold uppercase tracking-widest flex items-center gap-1 mt-0.5">
                                <span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span> Online
                            </p>
                        </div>
                    </div>
                    <button onclick="document.getElementById('support-modal').remove()" class="text-on-surface-variant hover:text-text-main transition-colors p-2 rounded-lg bg-bg-main border border-outline-variant/30 flex items-center justify-center">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                
                <!-- Chat Area -->
                <div id="chat-messages-area" class="flex-1 overflow-y-auto p-4 bg-bg-main/50 relative">
                    ${messagesHtml}
                </div>
                
                <!-- Input Area -->
                <div class="p-3 sm:p-4 border-t border-outline-variant/30 shrink-0 bg-surface">
                    <div class="flex gap-2">
                        <input id="support-message" type="text" class="flex-1 bg-bg-main border border-outline-variant outline-none px-4 py-3 text-text-main text-sm rounded-xl focus:border-primary transition-colors" placeholder="Сообщение..." onkeypress="if(event.key === 'Enter') submitSupport('support')">
                        <button onclick="submitSupport('support')" class="bg-primary text-white w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
                            <span class="material-symbols-outlined">send</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    } else {
        const title = 'Оставить отзыв';
        const placeholder = 'Что вам нравится в сервисе? Чего не хватает?';
        modal.innerHTML = `
            <div class="premium-card w-full p-6 sm:p-8 space-y-5 relative mx-4 sm:mx-auto" style="max-width: 480px;" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center border-b border-outline-variant/30 pb-4 mb-2">
                    <h3 class="font-headline text-lg font-bold tracking-tight text-text-main uppercase tracking-widest">${title}</h3>
                    <button onclick="document.getElementById('support-modal').remove()" class="text-on-surface-variant hover:text-text-main transition-colors -mr-2 p-2">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <textarea id="support-message" class="w-full h-36 bg-bg-main border border-outline-variant outline-none p-4 text-text-main text-sm rounded-xl focus:border-primary resize-none transition-colors" placeholder="${placeholder}"></textarea>
                <div class="pt-2">
                    <button onclick="submitSupport('${type}')" class="primary-btn w-full py-4 text-[11px] font-black uppercase tracking-[0.2em] rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all">Отправить</button>
                </div>
            </div>
        `;
    }

    document.body.appendChild(modal);
    
    if (type === 'support') {
        const chatArea = document.getElementById('chat-messages-area');
        if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
        setTimeout(() => document.getElementById('support-message').focus(), 100);
    }
}

async function submitSupport(type) {
    const inputEl = document.getElementById('support-message');
    const msg = inputEl.value.trim();
    if (!msg) return showToast('Введите сообщение', true);

    inputEl.disabled = true;

    try {
        const res = await fetch('/api/support', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, message: msg })
        });
        if (res.ok) {
            await refreshData();
            if (type === 'support') {
                openSupportModal('support');
            } else {
                showToast('Сообщение отправлено!');
                document.getElementById('support-modal').remove();
            }
            if (state.currentView === 'admin') showView('admin');
        } else {
            showToast('Ошибка отправки', true);
            inputEl.disabled = false;
        }
    } catch (e) { 
        showToast('Ошибка сети', true); 
        inputEl.disabled = false;
    }
}

async function adminReply(ticketId) {
    const replyText = prompt('Ответ пользователю:');
    if (!replyText) return;

    try {
        const res = await fetch(`/api/admin/support/${ticketId}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply: replyText })
        });
        if (res.ok) {
            showToast('Ответ сохранен');
            await refreshData();
            showView('admin');
        }
    } catch (e) { showToast('Ошибка сети', true); }
}

function renderAdmin() {
    const s = state.adminStats || {};
    const tkts = state.adminTickets || [];
    
    return `
        <div class="max-w-4xl mx-auto space-y-10 animate-in pb-20">
            <header>
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Админ-панель</p>
                <h2 class="font-headline text-3xl font-bold text-text-main tracking-tight">Управление</h2>
            </header>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div class="premium-card p-5">
                    <p class="text-[9px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Юзеры</p>
                    <p class="text-3xl font-bold text-text-main">${s.totalSellers || 0}</p>
                </div>
                <div class="premium-card p-5">
                    <p class="text-[9px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Ответов</p>
                    <p class="text-3xl font-bold text-text-main">${s.totalApproved || 0}</p>
                </div>
                <div class="premium-card p-5">
                    <p class="text-[9px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Без токена</p>
                    <p class="text-3xl font-bold text-red-500">${s.withoutToken || 0}</p>
                </div>
                <div class="premium-card p-5">
                    <p class="text-[9px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Тикеты</p>
                    <p class="text-3xl font-bold text-primary">${tkts.filter(t => t.status === 'open').length}</p>
                </div>
            </div>

            <section class="premium-card overflow-hidden">
                <div class="p-5 border-b border-outline-variant bg-surface/50">
                    <h3 class="font-bold text-sm uppercase tracking-widest">Обращения и Отзывы</h3>
                </div>
                <div class="divide-y divide-outline-variant">
                    ${tkts.length === 0 ? '<div class="p-8 text-center text-on-surface-variant text-sm">Нет обращений</div>' : 
                    tkts.map(t => `
                        <div class="p-5 space-y-3 ${t.status === 'open' ? 'bg-primary/5' : ''}">
                            <div class="flex justify-between items-start">
                                <div>
                                    <span class="text-[10px] font-black uppercase tracking-widest ${t.type === 'support' ? 'text-blue-500' : 'text-purple-500'}">${t.type}</span>
                                    <span class="text-xs text-on-surface-variant ml-3">${new Date(t.created_at).toLocaleString()}</span>
                                    <p class="text-xs font-bold text-text-main mt-1">${t.sellers?.display_name || t.sellers?.email || 'Юзер'}</p>
                                </div>
                                ${t.status === 'open' ? 
                                  `<button onclick="adminReply('${t.id}')" class="text-xs bg-primary text-white px-3 py-1 rounded font-bold">Ответить</button>` : 
                                  `<span class="text-[10px] font-black uppercase text-green-500">Отвечено</span>`
                                }
                            </div>
                            <p class="text-sm text-text-main bg-bg-main p-3 rounded border border-outline-variant/30">${t.message}</p>
                            ${t.admin_reply ? `<div class="ml-4 pl-4 border-l-2 border-primary space-y-1"><p class="text-[10px] font-black uppercase text-primary">Ваш ответ</p><p class="text-sm text-text-main">${t.admin_reply}</p></div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </section>
        </div>
    `;
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
