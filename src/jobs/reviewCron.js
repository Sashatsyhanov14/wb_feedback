const cron = require('node-cron');
const reviewService = require('../services/reviewService');

/**
 * The core logic to process all sellers
 */
async function processAll() {
  console.log('--- Starting review processing ---');
  try {
    await reviewService.processAllSellers();
    console.log('--- Finished review processing ---');
  } catch (error) {
    console.error('CRON ERROR in review processing:', error.message);
  }
}

/**
 * Initializes local periodic jobs (for dev/VPS)
 */
function initJobs() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await processAll();
  });

  console.log('Scheduled jobs initialized (Every 15m)');
}

module.exports = { initJobs, processAll };
