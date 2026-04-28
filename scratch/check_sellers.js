const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkSellers() {
    const { data, error } = await supabase
        .from('sellers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error fetching sellers:', error);
    } else {
        console.log('Last 5 sellers:', JSON.stringify(data, null, 2));
    }
}

checkSellers();
