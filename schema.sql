-- ============================================
-- Полная структура БД для WBReply AI v3.0
-- (Чистая архитектура: sellers + shops)
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Sellers (Пользователи / Аккаунты)
-- Хранит ТОЛЬКО данные аутентификации и подписку (уровень аккаунта)
CREATE TABLE IF NOT EXISTS sellers (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    auth_provider text NOT NULL,          -- 'google', 'vk', 'guest', 'email'
    auth_provider_id text NOT NULL,       -- ID от провайдера
    email text,
    display_name text,
    avatar_url text,
    subscription_status text DEFAULT 'free',  -- 'free', 'trial', 'active', 'expired'
    subscription_plan text DEFAULT 'none',    -- 'none', 'starter', 'agency', 'corporation'
    max_shops integer DEFAULT 1,              -- Лимит магазинов по тарифу
    subscription_expires_at timestamp with time zone,
    joined_at timestamp with time zone DEFAULT now(),
    last_active_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(auth_provider, auth_provider_id)
);

-- 2. Shops (Магазины)
-- Хранит ВСЕ настройки конкретного магазина (токен, ИИ-инструкции и т.д.)
CREATE TABLE IF NOT EXISTS shops (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE,
    name text NOT NULL,
    wb_token text DEFAULT '',
    wb_token_valid boolean DEFAULT false,
    is_auto_reply_enabled boolean DEFAULT true,
    brand_name text,
    custom_instructions text,
    stop_words text DEFAULT '',
    respond_to_bad_reviews boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- 3. Review Logs (Отзывы и ответы ИИ)
CREATE TABLE IF NOT EXISTS review_logs (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE,
    shop_id uuid REFERENCES shops(id) ON DELETE CASCADE,
    review_id text NOT NULL,
    review_text text,
    product_name text DEFAULT '',
    rating integer CHECK (rating >= 1 AND rating <= 5),
    nm_id bigint NOT NULL,
    ai_response_draft text,
    status text DEFAULT 'pending',  -- 'pending', 'approved', 'auto_posted', 'rejected'
    category text,                  -- 'Quality', 'Delivery', 'Price', 'Other'
    sentiment text,                 -- 'positive', 'neutral', 'negative'
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(shop_id, review_id)
);

-- 4. Support Tickets (Обращения в поддержку)
CREATE TABLE IF NOT EXISTS support_tickets (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE,
    type text NOT NULL,             -- 'support', 'feedback', 'analytics'
    message text NOT NULL,
    admin_reply text,
    status text DEFAULT 'open',     -- 'open', 'replied', 'closed'
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- 5. Chat History (ИИ-консультант в вебе)
CREATE TABLE IF NOT EXISTS chat_history (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE,
    role text CHECK (role IN ('user', 'assistant')),
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- Отключение RLS (работаем через Service Role Key)
ALTER TABLE sellers DISABLE ROW LEVEL SECURITY;
ALTER TABLE shops DISABLE ROW LEVEL SECURITY;
ALTER TABLE review_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets DISABLE ROW LEVEL SECURITY;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_shops_seller_id ON shops(seller_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_seller_id ON review_logs(seller_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_shop_id ON review_logs(shop_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_seller_id ON chat_history(seller_id);
CREATE INDEX IF NOT EXISTS idx_sellers_auth ON sellers(auth_provider, auth_provider_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_seller_id ON support_tickets(seller_id);
