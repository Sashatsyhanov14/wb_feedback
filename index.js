const express = require('express');
const path = require('path');
const config = require('./src/config');
const apiRoutes = require('./src/routes/apiRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const telegramService = require('./src/services/telegramService');
const { initJobs, processAll } = require('./src/jobs/reviewCron');
require('dotenv').config();

const app = express();
app.set('trust proxy', true);
const cookieParser = require('cookie-parser');
const authRoutes = require('./src/routes/authRoutes');

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Vercel Cron Trigger
app.get('/api/cron', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (config.nodeEnv === 'production' && authHeader !== `Bearer ${config.cronSecret}`) {
    return res.status(401).end();
  }
  await processAll();
  res.json({ success: true, timestamp: new Date() });
});

// Telegram Webhook setup (Manual trigger)
app.get('/api/setup', async (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const webhookUrl = `${protocol}://${host}/api/bot`;
    
    console.log(`Manual setup triggered. Setting webhook to: ${webhookUrl}`);
    await telegramService.bot.telegram.setWebhook(webhookUrl);
    
    res.json({ 
      success: true, 
      webhookUrl, 
      message: 'Бот успешно привязан к этому серверу! Теперь он должен отвечать на /start.' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Telegram Webhook recipient
app.post('/api/bot', (req, res) => telegramService.handleUpdate(req, res));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/payments', paymentRoutes);

// Page Routing
app.get('/', (req, res) => {
  if (req.cookies.auth_token) {
    res.redirect('/app');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/app', (req, res) => {
  // We check for token, but the UI will handle the actual view redirect if missing
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize background jobs
initJobs();

// Launch Bot
telegramService.launch();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = config.port;
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
