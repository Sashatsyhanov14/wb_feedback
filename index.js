const express = require('express');
const path = require('path');
const config = require('./src/config');
const apiRoutes = require('./src/routes/apiRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
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
