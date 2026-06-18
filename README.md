# WBReply AI - Автоматические ответы на отзывы Wildberries

AI-платформа для автоматизации работы с отзывами на маркетплейсе Wildberries. Система использует искусственный интеллект для генерации персонализированных ответов на отзывы покупателей.

## Возможности

- **Автоматическая обработка отзывов** - система автоматически получает новые отзывы через API Wildberries
- **AI-генерация ответов** - умные ответы с учетом контекста, тональности и категории отзыва
- **Мультимагазинная архитектура** - управление несколькими магазинами WB из одного аккаунта
- **Гибкие настройки** - кастомные инструкции для ИИ, стоп-слова, фильтры по рейтингу
- **Система подписок** - различные тарифные планы (Starter, Agency, Corporation)
- **Аналитика отзывов** - категоризация и анализ sentiment'а
- **Telegram-бот** - управление и уведомления через Telegram
- **AI-консультант** - чат-помощник для селлеров

## Технологический стек

### Backend
- **Node.js** + Express.js
- **Supabase** (PostgreSQL) - база данных
- **Telegraf** - Telegram Bot API
- **node-cron** - планировщик задач
- **JWT** - аутентификация

### Frontend
- **Tailwind CSS** - стилизация
- **Vanilla JavaScript** - интерактивность
- **Vercel Analytics** - аналитика

### Интеграции
- **Wildberries API** - получение отзывов и публикация ответов
- **OpenAI/Anthropic API** - генерация ответов
- **OAuth** - авторизация через Google, VK

## Структура базы данных

### Основные таблицы:
- **sellers** - пользователи и их подписки
- **shops** - магазины WB с токенами и настройками
- **review_logs** - история отзывов и AI-ответов
- **support_tickets** - обращения в поддержку
- **chat_history** - история чата с AI-консультантом

## Установка и запуск

### Требования
- Node.js 16+
- PostgreSQL (или Supabase аккаунт)
- Wildberries API токен
- OpenAI/Anthropic API ключ

### Шаги установки

1. Клонируйте репозиторий:
```bash
git clone https://github.com/Sashatsyhanov14/wb_feedback.git
cd wb_feedback
```

2. Установите зависимости:
```bash
npm install
```

3. Создайте файл `.env` на основе `.env.example`:
```bash
cp .env.example .env
```

4. Настройте переменные окружения в `.env`:
```env
# Database
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_key

# AI
OPENAI_API_KEY=your_openai_key

# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_token

# Auth
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Wildberries
WB_API_URL=https://feedbacks-api.wildberries.ru

# Cron
CRON_SECRET=your_cron_secret
```

5. Инициализируйте базу данных:
```bash
# Выполните schema.sql в вашей PostgreSQL/Supabase
psql -d your_database -f schema.sql
```

6. Соберите CSS:
```bash
npm run build
```

7. Запустите сервер:
```bash
# Development
npm run dev

# Production
npm start
```

Приложение будет доступно по адресу `http://localhost:3000`

## Deployment

### Vercel (рекомендуется)
1. Подключите репозиторий к Vercel
2. Настройте переменные окружения
3. Добавьте Vercel Cron для `/api/cron` endpoint

### VPS
Смотрите подробную инструкцию в `vps_guide.md`

## Использование

1. **Регистрация** - войдите через Google/VK или гостевой режим
2. **Добавьте магазин** - введите название и WB API токен
3. **Настройте AI** - укажите название бренда, инструкции, стоп-слова
4. **Активируйте автоответы** - включите автоматическую обработку
5. **Мониторинг** - отслеживайте статистику и историю ответов

## Архитектура

```
wb_feedback/
├── index.js              # Entry point
├── src/
│   ├── config/          # Конфигурация
│   ├── routes/          # API маршруты
│   │   ├── authRoutes.js
│   │   ├── apiRoutes.js
│   │   └── paymentRoutes.js
│   ├── jobs/            # Cron задачи
│   │   └── reviewCron.js
│   ├── services/        # Бизнес-логика
│   └── utils/           # Вспомогательные функции
├── public/              # Frontend статика
├── schema.sql           # Database schema
└── package.json
```

## API Endpoints

### Аутентификация
- `POST /api/auth/login` - вход
- `POST /api/auth/logout` - выход
- `GET /api/auth/me` - текущий пользователь

### Магазины
- `GET /api/shops` - список магазинов
- `POST /api/shops` - создать магазин
- `PUT /api/shops/:id` - обновить магазин
- `DELETE /api/shops/:id` - удалить магазин

### Отзывы
- `GET /api/reviews` - история отзывов
- `POST /api/reviews/approve` - одобрить ответ
- `POST /api/reviews/reject` - отклонить ответ

### Cron
- `GET /api/cron` - триггер обработки (защищен CRON_SECRET)

## Лицензия

Proprietary - все права защищены

## Контакты

- Email: alexandertsyhanov@gmail.com
- GitHub: [@Sashatsyhanov14](https://github.com/Sashatsyhanov14)
