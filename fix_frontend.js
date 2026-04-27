const fs = require('fs');
const path = require('path');

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    let content = fs.readFileSync(filePath, 'utf8');

    // Replacements
    content = content.replace(/telegramChatId/g, 'sellerId');
    content = content.replace(/data\.user\.id/g, 'data.sellerId');
    content = content.replace(/telegram_chat_id: state\.sellerId, /g, '');
    
    // UI specific fixes in renderSubscription
    content = content.replace(/\$\{state\.sellerId\.toString\(\)\.slice\(0, 2\)\}/g, '${(state.settings?.display_name || "US").slice(0, 2).toUpperCase()}');
    content = content.replace(/Telegram User/g, 'Аккаунт');
    content = content.replace(/ID: \$\{state\.sellerId\}/g, 'ID: ${state.sellerId ? state.sellerId.toString().slice(0, 8) : "demo"}');

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
}

processFile(path.join(__dirname, 'public', 'ui.js'));
processFile(path.join(__dirname, 'public', 'app.js'));
