// index.js - Main Bot File
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const fs = require('fs');

// Konfigurasi
const CONFIG = {
    botName: 'MAX 1',
    adminNumber: '6287847295204@s.whatsapp.net', // Ganti dengan nomor Anda
    geminiApiKey: 'AIzaSyBBLbjo_Se1S3t-NfAfXGbVJJP8wD15-is', // Ganti dengan API key Gemini Anda
    reminderTime: '07:00', // Waktu reminder harian (format 24 jam)
    scheduleFile: './jadwal.json'
};

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(CONFIG.geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Database jadwal (simple JSON file)
let scheduleData = {};

// Load jadwal dari file
function loadSchedule() {
    try {
        if (fs.existsSync(CONFIG.scheduleFile)) {
            const data = fs.readFileSync(CONFIG.scheduleFile, 'utf8');
            scheduleData = JSON.parse(data);
        }
    } catch (error) {
        console.log('Error loading schedule:', error);
        scheduleData = {};
    }
}

// Save jadwal ke file
function saveSchedule() {
    try {
        fs.writeFileSync(CONFIG.scheduleFile, JSON.stringify(scheduleData, null, 2));
    } catch (error) {
        console.log('Error saving schedule:', error);
    }
}

// Generate AI response dengan Gemini
async function generateAIResponse(message, senderName = 'User') {
    try {
        const prompt = `Kamu adalah MAX 1, chatbot WhatsApp yang friendly dan membantu. 
        Kamu bisa menjawab pertanyaan apapun dengan gaya casual dan informatif.
        Gunakan emoji yang sesuai dan bahasa Indonesia yang santai.
        
        Pertanyaan dari ${senderName}: ${message}
        
        Jawab dengan ramah dan helpful:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.log('Error generating AI response:', error);
        return 'Maaf, lagi ada gangguan nih. Coba tanya lagi nanti ya! 😅';
    }
}

// Get current day schedule
function getTodaySchedule() {
    const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    const today = days[new Date().getDay()];
    
    if (scheduleData[today] && scheduleData[today].length > 0) {
        let message = `🔔 *Reminder Hari Ini (${today.charAt(0).toUpperCase() + today.slice(1)})*\n\n`;
        
        scheduleData[today].forEach((item, index) => {
            message += `${index + 1}. ${item}\n`;
        });
        
        message += '\nSemangat hari ini! 💪';
        return message;
    }
    
    return `Tidak ada jadwal untuk hari ${today}. Santai aja hari ini! 😎`;
}

// Parse jadwal input
function parseScheduleInput(text) {
    const lines = text.split('\n');
    const newSchedule = {};
    let currentDay = '';
    
    lines.forEach(line => {
        line = line.trim();
        if (line.toLowerCase().includes('senin') || 
            line.toLowerCase().includes('selasa') ||
            line.toLowerCase().includes('rabu') ||
            line.toLowerCase().includes('kamis') ||
            line.toLowerCase().includes('jumat') ||
            line.toLowerCase().includes('sabtu') ||
            line.toLowerCase().includes('minggu')) {
            
            currentDay = line.toLowerCase().replace(':', '').trim();
            newSchedule[currentDay] = [];
        } else if (line.startsWith('-') && currentDay) {
            newSchedule[currentDay].push(line.substring(1).trim());
        }
    });
    
    return newSchedule;
}

// Main bot function
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('🤖 MAX 1 Bot berhasil terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message) return;
            
            const messageContent = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || '';
            
            const from = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const senderName = msg.pushName || 'User';
            const isGroup = from.endsWith('@g.us');
            const isAdmin = sender === CONFIG.adminNumber;
            
            // Ignore messages from bot itself
            if (msg.key.fromMe) return;
            
            console.log(`📨 Pesan dari ${senderName}: ${messageContent}`);
            
            // Handle admin commands
            if (isAdmin && messageContent.startsWith('/')) {
                const command = messageContent.toLowerCase();
                
                if (command.startsWith('/jadwal')) {
                    await sock.sendMessage(from, {
                        text: '📅 Silakan kirim jadwal mingguan Anda dengan format:\n\n' +
                              'Senin:\n- E-learning Matematika 09:00\n- Tugas Essay deadline 23:59\n\n' +
                              'Selasa:\n- Zoom meeting 13:00\n- Quiz Fisika 15:30\n\n' +
                              'Dan seterusnya...'
                    });
                    return;
                }
                
                if (command.startsWith('/lihat')) {
                    const scheduleText = JSON.stringify(scheduleData, null, 2);
                    await sock.sendMessage(from, {
                        text: scheduleText ? `📋 Jadwal saat ini:\n\`\`\`${scheduleText}\`\`\`` : 'Belum ada jadwal yang tersimpan.'
                    });
                    return;
                }
                
                if (command.startsWith('/reminder')) {
                    const today = getTodaySchedule();
                    await sock.sendMessage(from, { text: today });
                    return;
                }
            }
            
            // Handle schedule input (from admin, contains day names)
            if (isAdmin && (messageContent.toLowerCase().includes('senin') || 
                           messageContent.toLowerCase().includes('selasa') ||
                           messageContent.toLowerCase().includes('rabu'))) {
                
                const newSchedule = parseScheduleInput(messageContent);
                if (Object.keys(newSchedule).length > 0) {
                    scheduleData = { ...scheduleData, ...newSchedule };
                    saveSchedule();
                    
                    await sock.sendMessage(from, {
                        text: '✅ Jadwal berhasil diupdate!\n\nKetik /lihat untuk melihat jadwal lengkap.'
                    });
                    return;
                }
            }
            
            // Handle mentions and AI responses
            const isMentioned = messageContent.toLowerCase().includes('max1') || 
                               messageContent.toLowerCase().includes('@max1');
            
            if (isMentioned || (!isGroup && !messageContent.startsWith('/'))) {
                // Remove mention text for cleaner AI input
                let cleanMessage = messageContent.replace(/@\w+/g, '').replace(/max1/gi, '').trim();
                
                // Special commands
                if (cleanMessage.toLowerCase().includes('jadwal hari ini')) {
                    const today = getTodaySchedule();
                    await sock.sendMessage(from, { text: today });
                    return;
                }
                
                if (cleanMessage.toLowerCase().includes('bantuan') || cleanMessage.toLowerCase().includes('help')) {
                    const helpText = `🤖 *MAX 1 - Bantuan*\n\n` +
                                   `Mention saya dengan "@max1" atau "max1" untuk:\n` +
                                   `• Tanya apapun\n` +
                                   `• "jadwal hari ini" - Lihat jadwal hari ini\n` +
                                   `• "bantuan" - Lihat pesan ini\n\n` +
                                   `Saya juga kirim reminder jadwal setiap hari jam ${CONFIG.reminderTime} 📅`;
                    
                    await sock.sendMessage(from, { text: helpText });
                    return;
                }
                
                // Generate AI response
                if (cleanMessage) {
                    const aiResponse = await generateAIResponse(cleanMessage, senderName);
                    await sock.sendMessage(from, { text: aiResponse });
                }
            }
            
        } catch (error) {
            console.log('Error handling message:', error);
        }
    });

    // Daily reminder cron job
    cron.schedule(`0 ${CONFIG.reminderTime.split(':')[1]} ${CONFIG.reminderTime.split(':')[0]} * * *`, async () => {
        try {
            const todaySchedule = getTodaySchedule();
            
            // Send to admin
            await sock.sendMessage(CONFIG.adminNumber, { text: todaySchedule });
            
            console.log('📅 Daily reminder sent!');
        } catch (error) {
            console.log('Error sending daily reminder:', error);
        }
    });

    return sock;
}

// Initialize
loadSchedule();
startBot().catch(console.error);