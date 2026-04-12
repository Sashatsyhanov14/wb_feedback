const cron = require('node-cron');
const reviewService = require('../services/reviewService');

/**
 * Initializes all periodic jobs
 */
function initJobs() {
  // Run every 15 minutes
  // Format: second minute hour dayMonth month dayWeek
  cron.schedule('*/15 * * * *', async () => {
    console.log('--- Starting scheduled review processing ---');
    try {
      await reviewService.processNewReviews();
      console.log('--- Finished scheduled review processing ---');
    } catch (error) {
      console.error('CRON ERROR in review processing:', error.message);
    }
  });

  console.log('Scheduled jobs initialized (Review processing: Every 15m)');
}

module.exports = { initJobs };
