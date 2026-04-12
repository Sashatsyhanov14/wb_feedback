const express = require('express');
const config = require('./src/config');
const maxRoutes = require('./src/routes/maxRoutes');
const { initJobs, processAll } = require('./src/jobs/reviewCron');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Vercel Cron Trigger
app.get('/api/cron', async (req, res) => {
  // Simple protection with header or query param
  const authHeader = req.headers.authorization;
  if (config.nodeEnv === 'production' && authHeader !== `Bearer ${config.cronSecret}`) {
    return res.status(401).end();
  }
  
  await processAll();
  res.json({ success: true, timestamp: new Date() });
});

// Routes
app.use('/max', maxRoutes);
app.use('/api', apiRoutes);

// Initialize background jobs
initJobs();

// Basic route for testing
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`AI Review Responder server running on port ${PORT}`);
});

module.exports = app;
