const { spawn } = require('child_process');
const http = require('http');

console.log('Starting server...');
const server = spawn('node', ['index.js'], { stdio: 'pipe' });

let output = '';
server.stdout.on('data', (data) => {
    output += data.toString();
    console.log('[SERVER]', data.toString().trim());
});

server.stderr.on('data', (data) => {
    console.error('[SERVER ERROR]', data.toString().trim());
});

setTimeout(() => {
    // Check if server is running on port 3000
    http.get('http://localhost:3000/api/auth/vk', (res) => {
        console.log(`Server responded with status: ${res.statusCode}`);
        if (res.statusCode === 302 || res.statusCode === 200) {
            console.log('✅ SERVER STARTUP TEST PASSED.');
        } else {
            console.error('❌ SERVER STARTUP TEST FAILED.');
        }
        server.kill();
        process.exit(0);
    }).on('error', (e) => {
        console.error('❌ Could not connect to server:', e.message);
        server.kill();
        process.exit(1);
    });
}, 3000);
