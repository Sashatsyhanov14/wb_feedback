const cron = require('node-cron');
const reviewService = require('../services/reviewService');
const supabase = require('../db/supabase');

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
 * Cleanup abandoned guest accounts (no token, older than 7 days)
 */
async function cleanupGuests() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    // Find old guest accounts
    const { data: staleGuests, error } = await supabase
      .from('sellers')
      .select('id')
      .eq('auth_provider', 'guest')
      .lt('created_at', sevenDaysAgo);

    if (error) throw error;
    if (!staleGuests || staleGuests.length === 0) return;

    // Filter: only delete guests who have no shops with a real WB token
    const idsToDelete = [];
    for (const guest of staleGuests) {
      const { data: shops } = await supabase
        .from('shops')
        .select('id, wb_token')
        .eq('seller_id', guest.id);
      
      const hasRealToken = (shops || []).some(s => s.wb_token && s.wb_token !== '' && s.wb_token !== 'pending');
      if (!hasRealToken) {
        idsToDelete.push(guest.id);
      }
    }

    if (idsToDelete.length === 0) return;

    const { error: delError } = await supabase
      .from('sellers')
      .delete()
      .in('id', idsToDelete);

    if (delError) throw delError;
    console.log(`[Cleanup] Deleted ${idsToDelete.length} abandoned guest accounts`);
  } catch (err) {
    console.error('[Cleanup] Guest cleanup error:', err.message);
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

  // Cleanup old guests daily at 4:00 AM
  cron.schedule('0 4 * * *', async () => {
    await cleanupGuests();
  });

  console.log('Scheduled jobs initialized (Every 15m + daily cleanup)');
}

module.exports = { initJobs, processAll };
