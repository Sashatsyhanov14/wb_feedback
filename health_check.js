require('dotenv').config();
const config = require('./src/config');
const supabase = require('./src/db/supabase');
const axios = require('axios');

async function runHealthCheck() {
    console.log('--- SYSTEM HEALTH CHECK ---');
    
    let errors = 0;

    // 1. Dependency Check
    console.log('[1/4] Checking Dependencies...');
    try {
        require('express');
        require('jsonwebtoken');
        require('@supabase/supabase-js');
        require('axios');
        require('telegraf');
        console.log('✅ All core dependencies are installed.');
    } catch (e) {
        console.error('❌ Missing dependency:', e.message);
        errors++;
    }

    // 2. Environment Variables Check
    console.log('[2/4] Checking Environment Variables...');
    const criticalVars = ['supabaseUrl', 'supabaseServiceRoleKey', 'jwtSecret', 'telegramBotToken'];
    for (const v of criticalVars) {
        if (!config[v]) {
            console.error(`❌ Missing critical config: ${v}`);
            errors++;
        }
    }
    if (errors === 0) console.log('✅ All critical environment variables are present.');

    // 3. Database Connection Check
    console.log('[3/4] Checking Database Connection...');
    try {
        const { data, error } = await supabase.from('sellers').select('id').limit(1);
        if (error) throw error;
        console.log('✅ Database connection successful.');
    } catch (e) {
        console.error('❌ Database connection failed:', e.message);
        errors++;
    }

    // 4. YooKassa Config Check (Optional but recommended)
    console.log('[4/4] Checking Payment Config...');
    if (!config.yookassaShopId || !config.yookassaSecretKey) {
        console.warn('⚠️ YooKassa keys are missing (Expected if pending approval).');
    } else {
        console.log('✅ YooKassa keys are present.');
    }

    console.log('---------------------------');
    if (errors === 0) {
        console.log('🚀 ALL SYSTEMS GREEN. The application is healthy.');
        process.exit(0);
    } else {
        console.error(`💥 Found ${errors} critical issue(s).`);
        process.exit(1);
    }
}

runHealthCheck();
