const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkUser(email) {
    const { data, error } = await supabase
        .from('sellers')
        .select('*')
        .eq('email', email);

    if (error) {
        console.error('Error fetching user:', error);
    } else {
        console.log(`User(s) with email ${email}:`, JSON.stringify(data, null, 2));
    }
}

checkUser('alexandertsyhanov@gmail.com');
