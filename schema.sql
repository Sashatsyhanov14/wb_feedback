-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Sellers table
create table sellers (
    id uuid default uuid_generate_v4() primary key,
    telegram_chat_id text not null unique,
    wb_token text not null, -- Store encrypted if requested by logic later
    is_auto_reply_enabled boolean default false,
    auto_reply_min_rating integer default 4,
    brand_name text,
    seller_description text,
    custom_instructions text,
    subscription_status text default 'free',
    subscription_expires_at timestamp,
    respond_to_bad_reviews boolean default false,
    created_at timestamp with time zone default now()
);

-- 2. Product matrix table
create table product_matrix (
    id uuid default uuid_generate_v4() primary key,
    seller_id uuid references sellers(id) on delete cascade,
    nm_id bigint not null, -- WB Article
    product_name text not null,
    cross_sell_article bigint,
    cross_sell_description text,
    unique(seller_id, nm_id)
);

-- 3. Review status enum
create type review_status as enum ('pending', 'approved', 'rejected');

-- 4. Review logs table
create table review_logs (
    id uuid default uuid_generate_v4() primary key,
    seller_id uuid references sellers(id) on delete cascade,
    review_id text not null,
    text text,
    rating integer check (rating >= 1 and rating <= 5),
    nm_id bigint not null,
    ai_response_draft text,
    status review_status default 'pending',
    created_at timestamp with time zone default now(),
    unique(seller_id, review_id)
);
