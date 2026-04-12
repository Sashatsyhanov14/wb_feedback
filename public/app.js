/**
 * WB AI Responder - Main Frontend Logic
 */

const state = {
    currentView: 'dashboard',
    theme: 'light',
    reviews: [],
    stats: { total: 0, pending: 0, approved: 0 },
    settings: { is_auto_reply_enabled: false, auto_reply_min_rating: 4 },
    matrix: [],
    analytics: { ratings: {}, categories: {}, sentiments: {} },
    telegramChatId: null,
    isAuthorized: false,
    subscriptionStatus: 'free'
};

// Initialize Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    state.telegramChatId = tg.initDataUnsafe?.user?.id || 'mock_user_123';
} else {
    state.telegramChatId = 'mock_user_123'; // Fallback for browser testing
}

// --- API Calls ---

async function fetchAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        state.analytics = await res.json();
    } catch (e) { console.error('Analytics fetch error:', e); }
}

async function fetchMatrix() {
    try {
        const res = await fetch('/api/matrix');
        state.matrix = await res.json();
    } catch (e) { console.error('Matrix fetch error:', e); }
}

async function saveMatrixEntry(entry) {
    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
        });
        if (res.ok) {
            showToast('✅ Товар добавлен в матрицу');
            await fetchMatrix();
            showView('products');
        }
    } catch (e) { showToast('❌ Ошибка сохранения', true); }
}

async function fetchSettings() {
    try {
        const res = await fetch(`/api/settings/${state.telegramChatId}`);
        if (res.status === 404) return null;
        state.settings = await res.json();
        
        // Sync header token
        if (state.settings.wb_token) {
            document.getElementById('header-wb-token').value = state.settings.wb_token;
        }
        
        return state.settings;
    } catch (e) { console.error('Settings fetch error:', e); return null; }
}

async function updateTokenFromHeader(val) {
    state.settings.wb_token = val;
    await saveSettings();
}

async function saveSettings() {
    try {
        const res = await fetch(`/api/settings/${state.telegramChatId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.settings)
        });
        const result = await res.json();
        if (result.success) showToast('✅ Настройки сохранены');
    } catch (e) { showToast('❌ Ошибка сохранения', true); }
}

async function registerSeller(data) {
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramChatId: state.telegramChatId,
                ...data
            })
        });
        const result = await res.json();
        if (result.success) {
            state.isAuthorized = true;
            showToast('✅ Регистрация успешна!');
            await refreshData();
        } else {
            showToast(`❌ Ошибка: ${result.error}`, true);
        }
    } catch (e) { showToast('❌ Ошибка сети', true); }
}

async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        state.stats = await res.json();
    } catch (e) { console.error('Stats fetch error:', e); }
}

async function fetchReviews(status) {
    try {
        let url = '/api/reviews';
        if (status) url += `?status=${status}`;
        const res = await fetch(url);
        state.reviews = await res.json();
    } catch (e) { console.error('Reviews fetch error:', e); }
}

async function approveReview(id, text) {
    try {
        const res = await fetch(`/api/reviews/${id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const result = await res.json();
        if (result.success) {
            showToast('✅ Ответ успешно отправлен!');
            await refreshData();
        } else {
            showToast('❌ Ошибка при отправке :(', true);
        }
    } catch (e) { 
        console.error('Approve error:', e);
        showToast('❌ Ошибка сети', true);
    }
}

async function refreshData() {
    await fetchStats();
    await fetchReviews();
    showView(state.currentView);
}

// --- View Rendering ---

function renderDashboard() {
    return `
        <div class="animate-in">
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                <div class="card">
                    <div style="color: var(--text-muted); font-size: 14px; margin-bottom: 8px;">Всего отзывов</div>
                    <div style="font-size: 32px; font-weight: 700;">${state.stats.total || 0}</div>
                    <div style="color: #30d158; font-size: 12px; margin-top: 8px;">За все время</div>
                </div>
                <div class="card">
                    <div style="color: var(--text-muted); font-size: 14px; margin-bottom: 8px;">Ожидают проверки</div>
                    <div style="font-size: 32px; font-weight: 700;">${state.stats.pending || 0}</div>
                    <div style="color: #ff9f0a; font-size: 12px; margin-top: 8px;">Нужно ваше внимание</div>
                </div>
                <div class="card" style="background: var(--accent-gradient); color: white;">
                    <div style="opacity: 0.8; font-size: 14px; margin-bottom: 8px;">Автоответы</div>
                    <div style="font-size: 32px; font-weight: 700;">Работают</div>
                    <div style="opacity: 0.9; font-size: 12px; margin-top: 8px;">Фоновый режим активен</div>
                </div>
            </div>

            <div class="card" style="margin-top: 24px;">
                <h3>Последняя активность</h3>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-radius: 12px; background: var(--glass-border);">
                        <span>Система мониторинга отзывов активна</span>
                        <span style="font-size: 12px; color: var(--text-muted);">В реальном времени</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderReviews() {
    if (state.reviews.length === 0) {
        return `<div class="card"><p>Все отзывы обработаны! 🎉</p></div>`;
    }
    return `
        <div class="review-list animate-in">
            ${state.reviews.map(review => `
                <div class="card review-item">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div>
                            <div class="rating">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</div>
                            <p style="margin: 8px 0; font-size: 15px;">${review.text || 'Нет текста'}</p>
                            <div style="font-size: 12px; color: var(--text-muted);">Артикул: ${review.nm_id}</div>
                        </div>
                        <span class="badge badge-pending">Ожидает</span>
                    </div>
                    
                    <div class="draft-area">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
                            <i data-lucide="sparkles" style="width: 12px;"></i> Черновик от AI
                        </div>
                        <textarea id="text-${review.id}">${review.ai_response_draft || ''}</textarea>
                    </div>

                    <div style="display: flex; gap: 12px; margin-top: 12px;">
                        <button class="btn btn-primary" onclick="handleApprove('${review.id}')">Отправить на WB</button>
                        <button class="btn" style="background: var(--glass-border);">Игнорировать</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderRegistration() {
    return `
        <div class="card animate-in" style="max-width: 500px; margin: 40px auto;">
            <div style="text-align: center; margin-bottom: 24px;">
                <i data-lucide="zap" style="width: 48px; height: 48px; color: var(--primary); margin-bottom: 12px;"></i>
                <h2 style="margin: 0">Добро пожаловать в WB Responder</h2>
                <p style="color: var(--text-muted); font-size: 14px; margin-top: 8px;">Для начала работы подключите ваш Wildberries API токен</p>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div>
                    <label style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; display: block;">API Токен Wildberries (Статистика/Контент)</label>
                    <input type="password" id="reg-token" placeholder="Введите ваш токен..." style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);">
                </div>
                <div>
                    <label style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; display: block;">Название вашего бренда</label>
                    <input type="text" id="reg-brand" placeholder="Например: MyBrand" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);">
                </div>
                <div>
                    <label style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; display: block;">Краткое описание магазина (для ИИ)</label>
                    <textarea id="reg-desc" placeholder="Мы продаем аксессуары для дома..." style="width: 100%; height: 80px; padding: 12px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);"></textarea>
                </div>
                
                <button class="btn btn-primary" style="margin-top: 12px; padding: 14px;" onclick="handleRegister()">Зарегистрироваться</button>
            </div>
        </div>
    `;
}

function renderAccount() {
    return `
        <div class="card animate-in" style="max-width: 600px; margin: 0 auto;">
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--glass-border);">
                <div style="width: 80px; height: 80px; border-radius: 50%; background: var(--accent-gradient); display: flex; align-items: center; justify-content: center; border: 4px solid var(--glass-border);">
                    <i data-lucide="user" style="color: white; width: 40px; height: 40px;"></i>
                </div>
                <div>
                    <h2 style="margin: 0">Ваш профиль</h2>
                    <p style="color: var(--text-muted); font-size: 14px;">Управление аккаунтом и подпиской</p>
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600;">Telegram ID</div>
                        <div style="font-size: 14px; color: var(--text-muted);">${state.telegramChatId}</div>
                    </div>
                    <i data-lucide="copy" style="width: 18px; color: var(--primary); cursor: pointer;"></i>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border-radius: 16px; background: var(--glass-border);">
                    <div>
                        <div style="font-weight: 600;">Статус подписки</div>
                        <div style="font-size: 14px; color: var(--primary); text-transform: uppercase; letter-spacing: 1px;">${state.settings.subscription_status || 'FREE'}</div>
                    </div>
                    ${state.settings.subscription_status === 'premium' ? 
                        `<span class="badge badge-approved">Активна</span>` : 
                        `<button class="btn btn-primary" style="padding: 8px 16px; font-size: 13px;">Продлить/Купить</button>`
                    }
                </div>
                
                <div style="font-size: 12px; color: var(--text-muted); text-align: center;">
                    Премиум дает доступ к расширенной аналитике и неограниченным автоответам.
                </div>
            </div>
        </div>
    `;
}

function renderSettings() {
    return `
        <div class="animate-in">
            <div class="card">
                <h3 style="margin-top: 0; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="cpu" style="width: 20px; color: var(--primary);"></i>
                    Control Center
                </h3>
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 600;">Глобальный автоответчик</div>
                            <div style="font-size: 12px; color: var(--text-muted);">Автоматическая отправка ответов на WB</div>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="auto-reply-toggle" ${state.settings.is_auto_reply_enabled ? 'checked' : ''} onchange="state.settings.is_auto_reply_enabled = this.checked; saveSettings();">
                            <span class="slider round"></span>
                        </label>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 600;">Обработка плохих отзывов (1-3★)</div>
                            <div style="font-size: 12px; color: var(--text-muted);">Безопасно отвечать на негатив с помощью ИИ</div>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="bad-reviews-toggle" ${state.settings.respond_to_bad_reviews ? 'checked' : ''} onchange="state.settings.respond_to_bad_reviews = this.checked; saveSettings();">
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-top: 24px;">
                <h3 style="display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="sparkles" style="width: 20px; color: var(--primary);"></i>
                    AI Persona (Инструкции)
                </h3>
                <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
                    Опишите характер ответов. Например: "Пиши кратко, на Вы, в конце добавляй 'С любовью, бренд X'".
                </p>
                <textarea id="ai-instructions" style="width: 100%; height: 120px; padding: 12px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text); margin-bottom: 16px;">${state.settings.custom_instructions || ''}</textarea>
                <button class="btn btn-primary" style="width: 100%" onclick="state.settings.custom_instructions = document.getElementById('ai-instructions').value; saveSettings();">Сохранить инструкции для ИИ</button>
            </div>
        </div>
    `;
}

function renderProducts() {
    return `
        <div class="animate-in">
            <div class="card" style="margin-bottom: 24px;">
                <h3 style="margin-top: 0">Связи для доп. продаж</h3>
                <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">Добавляйте неограниченное количество связок артикулов.</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div style="font-size: 12px; color: var(--text-muted);">Артикул WB (nmId)</div>
                    <div style="font-size: 12px; color: var(--text-muted);">Рекомендация (nmId)</div>
                    <input type="text" id="m-nm-id" placeholder="1234567..." style="padding: 10px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);">
                    <input type="text" id="m-cross-id" placeholder="7654321..." style="padding: 10px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);">
                </div>
                <button class="btn btn-primary" style="margin-top: 16px; width: 100%" onclick="handleAddMatrix()">
                    <i data-lucide="plus" style="width: 14px; margin-right: 4px;"></i>
                    Добавить связку
                </button>
            </div>

            <div class="review-list">
                ${state.matrix.length === 0 ? '<p style="text-align: center; color: var(--text-muted);">Список пуст</p>' : ''}
                ${state.matrix.map(item => `
                    <div class="card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="background: var(--glass-border); padding: 8px; border-radius: 8px;">
                                <i data-lucide="link" style="width: 14px; color: var(--primary);"></i>
                            </div>
                            <div>
                                <div style="font-weight: 600; font-size: 14px;">${item.nm_id}</div>
                                <div style="font-size: 12px; color: var(--text-muted);">Ваш товар</div>
                            </div>
                        </div>
                        <div style="font-size: 18px; color: var(--glass-border);">→</div>
                        <div style="text-align: right;">
                            <div style="font-weight: 600; font-size: 14px; color: var(--primary);">${item.cross_sell_article || '—'}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">Рекомендация</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

async function handleAddMatrix() {
    const entry = {
        nm_id: document.getElementById('m-nm-id').value,
        product_name: document.getElementById('m-name').value,
        cross_sell_article: document.getElementById('m-cross-id').value,
        cross_sell_description: document.getElementById('m-cross-desc').value
    };
    if (!entry.nm_id || !entry.product_name) return showToast('Заполните артикул и имя', true);
    await saveMatrixEntry(entry);
}

function renderAnalytics() {
    const total = Object.values(state.analytics.ratings).reduce((a, b) => a + b, 0);
    
    const renderBar = (label, value, color) => {
        const percent = total > 0 ? (value / total * 100) : 0;
        return `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                    <span>${label}</span>
                    <span>${value} (${percent.toFixed(0)}%)</span>
                </div>
                <div style="height: 8px; background: var(--glass-border); border-radius: 4px; overflow: hidden;">
                    <div style="width: ${percent}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
                </div>
            </div>
        `;
    };

    return `
        <div class="animate-in">
            <div class="card" style="margin-bottom: 24px;">
                <h3>Распределение оценок</h3>
                ${[5, 4, 3, 2, 1].map(star => renderBar(`${star} звезд`, state.analytics.ratings[star] || 0, '#ff9f0a')).join('')}
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="card">
                    <h3>Тональность</h3>
                    ${renderBar('Позитив', state.analytics.sentiments.positive || 0, '#30d158')}
                    ${renderBar('Нейтраль', state.analytics.sentiments.neutral || 0, '#8e8e93')}
                    ${renderBar('Негатив', state.analytics.sentiments.negative || 0, '#ff3b30')}
                </div>
                <div class="card">
                    <h3>Категории</h3>
                    ${Object.entries(state.analytics.categories).map(([cat, val]) => renderBar(cat, val, 'var(--primary)')).join('')}
                    ${Object.keys(state.analytics.categories).length === 0 ? '<p style="font-size: 12px; color: var(--text-muted);">Нет данных</p>' : ''}
                </div>
            </div>
        </div>
    `;
}

function showView(view) {
    state.currentView = view;
    const content = document.getElementById('content-view');
    const headerTitle = document.getElementById('header-text');

    // Update navigation active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('onclick')?.includes(`'${view}'`)) {
            item.classList.add('active');
        }
    });

    if (view === 'dashboard') {
        content.innerHTML = renderDashboard();
        headerTitle.innerText = 'Дашборд';
    } else if (view === 'reviews') {
        content.innerHTML = renderReviews();
        headerTitle.innerText = 'Управление отзывами';
    } else if (view === 'products') {
        content.innerHTML = renderProducts();
        headerTitle.innerText = 'Матрица товаров (Контекст)';
    } else if (view === 'analytics') {
        content.innerHTML = renderAnalytics();
        headerTitle.innerText = 'Аналитика и Инсайты';
    } else if (view === 'settings') {
        content.innerHTML = renderSettings();
        headerTitle.innerText = 'Настройки и ИИ';
    } else if (view === 'account') {
        content.innerHTML = renderAccount();
        headerTitle.innerText = 'Аккаунт';
    } else if (view === 'registration') {
        content.innerHTML = renderRegistration();
        headerTitle.innerText = 'Регистрация';
        document.querySelector('.sidebar').style.display = 'none';
        document.querySelector('.main-content').style.marginLeft = '0';
    } else {
        content.innerHTML = `<div class="card"><p>Раздел ${view} находится в разработке.</p></div>`;
        headerTitle.innerText = view.charAt(0).toUpperCase() + view.slice(1);
    }

    lucide.createIcons();
}

function toggleAutoReply(enabled) {
    state.settings.is_auto_reply_enabled = enabled;
}

function setMinRating(rating) {
    state.settings.auto_reply_min_rating = parseInt(rating);
}

// --- Toast ---
function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; padding: 14px 24px; 
        border-radius: 16px; background: ${isError ? 'rgba(239, 68, 68, 0.9)' : 'rgba(139, 92, 246, 0.9)'}; 
        color: white; font-size: 14px; font-weight: 600; 
        backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);
        box-shadow: 0 10px 30px rgba(0,0,0,0.4); z-index: 1000;
        animation: fadeIn 0.3s ease forwards;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// --- Interactions ---

async function handleApprove(id) {
    const text = document.getElementById(`text-${id}`).value;
    await approveReview(id, text);
}

// Theme Toggle
document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', state.theme);
    const icon = document.querySelector('#theme-toggle i');
    icon.setAttribute('data-lucide', state.theme === 'light' ? 'moon' : 'sun');
    document.getElementById('theme-toggle').lastChild.textContent = state.theme === 'light' ? ' Темная тема' : ' Светлая тема';
    lucide.createIcons();
});

async function handleRegister() {
    const data = {
        wbToken: document.getElementById('reg-token').value,
        brandName: document.getElementById('reg-brand').value,
        sellerDescription: document.getElementById('reg-desc').value
    };
    if (!data.wbToken || !data.brandName) return showToast('Заполните токен и название бренда', true);
    await registerSeller(data);
}

async function checkAuth() {
    const settings = await fetchSettings();
    if (settings) {
        state.isAuthorized = true;
        await refreshData();
    } else {
        state.isAuthorized = false;
        showView('registration');
    }
}

// Init
window.onload = async () => {
    await checkAuth();
};
