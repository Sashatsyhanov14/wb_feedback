const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(
  config.supabaseUrl, 
  config.supabaseServiceRoleKey || config.supabaseKey,
  {
    auth: {
      flowType: 'implicit',
      autoRefreshToken: false,
      persistSession: false,
    }
  }
);

module.exports = supabase;
