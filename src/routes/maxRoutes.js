const express = require('express');
const router = express.Router();

// Webhook endpoint for Max Platform
router.post('/webhook', (req, res) => {
  const event = req.body;
  
  console.log('Received Max event:', JSON.stringify(event, null, 2));

  // Basic message handling logic
  if (event.type === 'message' && event.payload?.text) {
    const userId = event.payload.user_id;
    const text = event.payload.text;

    if (text.toLowerCase() === '/start') {
      // In a real app, we'd handle registration here
      console.log(`User ${userId} started the bot`);
    }
  }

  // Always respond with 200 to acknowledge receipt
  res.status(200).send('OK');
});

module.exports = router;
