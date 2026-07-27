const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1CPviWaISRLeTB6wgSPKSjep78v7a48cHjs5-n9q4sPGUM_jqlWA2aUd2qbhUXKBC/exec";

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

let sock = null;
let currentQrCode = '';
let isBotReady = false;
let isConnecting = false;

// 🧹 ऑथ फ़ोल्डर क्लीनर
function forceClearAuthFolder() {
    try {
        if (sock) {
            try { sock.ev.removeAllListeners(); } catch (e) {}
            try { sock.ws?.close(); } catch (e) {}
            sock = null;
        }
        if (fs.existsSync(AUTH_FOLDER)) {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
            console.log('🧹 Auth Folder साफ़ कर दिया गया!');
        }
    } catch (e) {
        console.error('❌ Error clearing Auth Folder:', e.message);
    }
}

// 🎯 आपके कोड वाला शुद्ध 10-अंकों का नंबर एक्सट्रैक्टर (Baileys Adaptation)
function extractClean10DigitPhone(jid, msg) {
    let senderPhone = "";
    try {
        let rawSender = msg.key.participant || msg.key.remoteJid || jid || "";
        senderPhone = rawSender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    } catch (err) {
        console.error("Contact resolve error:", err.message);
    }

    if (!senderPhone || senderPhone.length < 10) {
        let rawSender = msg.key.remoteJid || jid || "";
        senderPhone = rawSender.replace(/[^0-9]/g, '');
    }

    if (senderPhone.length >= 10) {
        senderPhone = senderPhone.slice(-10);
    }

    return senderPhone;
}

async function startBot() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        console.log('⚡ WhatsApp Bot स्टार्ट हो रहा है...');
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

        let latestVersion = [2, 3000, 1017531287];
        try {
            const fetched = await fetchLatestBaileysVersion();
            if (fetched && fetched.version) latestVersion = fetched.version;
        } catch (e) {}

        sock = makeWASocket({
            auth: state,
            version: latestVersion,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            browser: Browsers.ubuntu('Chrome')
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQrCode = qr;
                isConnecting = false;
                console.log('✅ 🔥 नया QR Code जनरेट हो गया!');
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === 'close') {
                isBotReady = false;
                isConnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('❌ सेशन लॉगआउट हुआ। नया QR जनरेट हो रहा है...');
                    forceClearAuthFolder();
                    setTimeout(() => startBot(), 1500);
                } else {
                    setTimeout(() => startBot(), 2500);
                }
            } else if (connection === 'open') {
                isConnecting = false;
                currentQrCode = '';
                isBotReady = true;
                console.log('\n=============================================');
                console.log(' JRD Enterprise VIP Bot Active & Secured! ');
                console.log('=============================================\n');
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const jid = msg.key.remoteJid;
            if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return;

            try { await sock.readMessages([msg.key]); } catch (e) {}

            // 🎯 शुद्ध 10-अंकों का नंबर एक्सट्रैक्टर
            const senderPhone = extractClean10DigitPhone(jid, msg);
            const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const lowerText = rawText.toLowerCase();

            console.log(`📱 मैसेज प्राप्त हुआ | शुद्ध 10-अंकों का नंबर : [${senderPhone}] | टेक्स्ट : "${rawText}"`);

            // 🎯 1. हेल्प एवं वेलकम मेन्यू
            if (['hi', 'hello', 'नमस्ते', 'menu', 'start'].includes(lowerText)) {
                const menuText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *अभिभावक डिजिटल सेवा केंद्र*\n\nसूचना प्राप्त करने के लिए संबंधित **नंबर** भेजें:\n\n1️⃣ *नया एडमिशन (सत्र 2026-27)*\n2️⃣ *स्कूल टाइमिंग एवं शेड्यूल*\n3️⃣ *प्रबंधकीय एवं संस्थापक संदेश*\n4️⃣ *विद्यालय का पता व लोकेशन*\n\n🔎 *अपने बच्चे की फीस / प्रोफाइल देखने के लिए:*\nबस अपने बच्चे का **नाम** (उदा: *Aditya* या *Ritesh*) सीधे लिखकर भेजें。\n\n_नोट: जानकारी केवल पंजीकृत (Registered) मोबाइल नंबर पर ही उपलब्ध होगी।_\n━━━━━━━━━━━━━━━━━━━━━━━`;
                await sendReply(jid, menuText);
                return;
            }

            if (lowerText === '1') {
                await sendReply(jid, `📝 *प्रवेश प्रारंभ (सत्र 2026-27)*\n🏫 *JRD Public School, मरुई, वाराणसी*\n━━━━━━━━━━━━━━━━━━━━━━━\n• संस्कारयुक्त एवं उच्च स्तरीय शिक्षा\n• आधुनिक कंप्यूटर लैब व योग्य शिक्षक\n\n📞 *प्रवेश हेतु विद्यालय कार्यालय में संपर्क करें।*`);
                return;
            }
            if (lowerText === '2') {
                await sendReply(jid, `⏰ *स्कूल समय एवं नियम*\n🏫 *JRD Public School*\n━━━━━━━━━━━━━━━━━━━━━━━\n⏱ *समय:* सुबह 07:30 AM से दोपहर 01:30 PM तक\n📅 *दिन:* सोमवार से शनिवार\n\n_नोट: कृपया बच्चों को पूर्ण गणवेश (Uniform) में समय से भेजें।_`);
                return;
            }
            if (lowerText === '3') {
                await sendReply(jid, `👑 *प्रबंधकीय संदेश*\n🏫 *JRD Public School Management*\n━━━━━━━━━━━━━━━━━━━━━━━\n✨ *संस्थापक:* श्री बंशगोपाल वर्मा जी\n✨ *प्रबंधक:* डॉ. बंशलाल जी\n\n> *"हम प्रत्येक बच्चे के सर्वांगीण विकास एवं उज्ज्वल भविष्य के लिए पूर्णतः समर्पित हैं।"*`);
                return;
            }
            if (lowerText === '4') {
                await sendReply(jid, `📍 *विद्यालय लोकेशन:*\nJRD Public School, ग्राम व पोस्ट - मरुई, जिला - वाराणसी (उ.प्र.)\n\n🗺 *गूगल मैप्स पर ढूँढें:*\nGoogle Maps पर खोजें: *JRD Public School Marui Varanasi*`);
                return;
            }

            // 💬 2. आम बातचीत (Casual Talk)
            const casualWords = ['कैसे हो', 'कैसे हैं', 'kaise ho', 'kaise hain', 'good morning', 'good afternoon', 'thanks', 'thank you', 'धन्यवाद', 'ok', 'okay', 'ठीक है', 'जय हिंद', 'राम राम', 'सुप्रभात', 'thik hai', 'kya hal hai'];
            if (casualWords.some(word => lowerText.includes(word))) {
                await sendReply(jid, `🙏 *JRD Public School, मरुई* में आपका स्वागत है!\n\nअपने बच्चे का फ़ीस बहीखाता देखने के लिए सीधे उसका **नाम** लिखकर भेजें। मुख्य मेन्यू के लिए **Menu** लिखें।`);
                return;
            }

            // 🔍 3. DOUBLE FILTER SEARCH ENGINE
            if (rawText.length >= 2) {
                try {
                    const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(rawText)}`;
                    const response = await axios.get(apiUrl, { timeout: 15000 });

                    if (response.data && response.data.status === 'success') {
                        await sendStudentProfileCard(jid, response.data.data);
                    } 
                    else if (response.data && response.data.status === 'unregistered_number') {
                        await sendReply(jid, `🛑 *अनधिकृत पहुँच (Access Denied)*\n\nआपका मोबाइल नंबर (*${senderPhone}*) विद्यालय के आधिकारिक डेटाबेस में पंजीकृत नहीं है。\n\nसुरक्षा कारणों से छात्र विवरण केवल पंजीकृत (Registered) अभिभावक के नंबर पर ही भेजा जाता है。\n_यदि आपने नया नंबर लिया है, तो कृपया विद्यालय कार्यालय में संपर्क करें।_`);
                    } 
                    else if (response.data && (response.data.status === 'student_not_associated_with_number' || response.data.status === 'not_found')) {
                        await sendReply(jid, `❌ *रिकॉर्ड नहीं मिला!*\n\nछात्र का नाम *"${rawText}"* आपके पंजीकृत मोबाइल नंबर (*${senderPhone}*) से जुड़ा हुआ नहीं पाया गया。\n\nकृपया सही नाम अथवा Enrolment No लिखकर भेजें।`);
                    }
                } catch (error) {
                    console.error('Database Search Error:', error.message);
                }
            }
        });

    } catch (err) {
        isConnecting = false;
        console.error('❌ startBot error:', err.message);
    }
}

async function sendReply(jid, text) {
    try {
        if (sock && isBotReady) {
            await sock.sendMessage(jid, { text });
        }
    } catch (err) {
        console.error('❌ रिप्लाई भेजने में त्रुटि:', err.message);
    }
}

// 🎨 VIP प्रोफाइल कार्ड फ़ंक्शन (FULL BREAKDOWN ACTIVE)
async function sendStudentProfileCard(jid, s) {
    const replyMsg = `🎓 *STUDENT OFFICIAL PROFILE*\n🏫 *JRD Public School, Marui*\n📅 *सत्र (Session):* ${s.session || '2026-27'}\n━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Enrolment No:* \`${s.enrolment || 'N/A'}\` \n📜 *Scholar/Reg No:* ${s.scholar_no || 'N/A'}\n🔢 *Roll No:* ${s.roll_no || 'N/A'}\n\n👤 *छात्र का नाम:* *${s.name}*\n👨‍👦 *पिता का नाम:* ${s.father}\n👩‍👦 *माता का नाम:* ${s.mother}\n🏫 *कक्षा:* ${s.class} (${s.type || 'REGULAR'})\n\n💰 *भुगतान एवं जमा विवरण:*\n• *कुल जमा शुल्क (Paid):* ₹${s.total_paid || 0}\n\n📊 *मदवार जमा स्थिति:*\n${s.paid_list || 'कोई जमा फीस दर्ज नहीं है'}\n\n⚠️ *चालू माह तक बकाया स्थिति:*\n${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n🧾 *बहीखाता कुल बकाया ब्रेकडाउन (DUE SUMMARY):*\n• *चालू सत्र बकाया (2026-27):* ₹${s.current_due || 0}\n• *पिछला बकाया (Old Due):* ₹${s.old_due || 0}\n---------------------------------------\n🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${s.grand_due || 0}*\n━━━━━━━━━━━━━━━━━━━━━━━\n_यदि फ़ीस अथवा विवरण में कोई त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);
}

// 🛡️ ANTI-BAN SAFE MESSAGE QUEUE ENGINE
let messageQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;

    let processedCount = 0;

    while (messageQueue.length > 0) {
        const item = messageQueue.shift();
        try {
            let formattedNumber = item.number.toString().replace(/[^0-9]/g, '');
            if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
            const targetJid = formattedNumber + '@s.whatsapp.net';

            if (sock && isBotReady) {
                await sock.sendMessage(targetJid, { text: item.message });
                console.log(`✅ [${item.type}] मैसेज भेजा गया -> ${formattedNumber}`);
                processedCount++;

                const randomDelay = Math.floor(Math.random() * 4000) + 4000;
                await new Promise(res => setTimeout(res, randomDelay));

                if (processedCount % 20 === 0) {
                    console.log('⏸️ व्हाट्सएप सुरक्षा: 15 सेकंड का ब्रेक लिया जा रहा है...');
                    await new Promise(res => setTimeout(res, 15000));
                }
            }
        } catch (err) {
            console.error(`❌ संदेश भेजने में त्रुटि (${item.number}):`, err.message);
        }
    }

    isProcessingQueue = false;
}

// 📩 ऐप्स स्क्रिप्ट से आने वाले बल्क/ऑटो मैसेज क्यू में जोड़ना
app.post('/enqueue-message', (req, res) => {
    const { number, message, type } = req.body;
    if (!number || !message) return res.status(400).json({ status: 'error', message: 'Missing fields' });

    messageQueue.push({ number, message, type: type || 'GENERAL' });
    console.log(`📥 नया मैसेज क्यू में जुड़ा -> ${number} (कुल कतार: ${messageQueue.length})`);

    processQueue();

    return res.status(200).json({ status: 'queued', queue_length: messageQueue.length });
});

// 📩 डायरेक्ट सिंगल मैसेज सेंड API
app.post('/send-whatsapp', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ status: 'error' });

    try {
        if (!sock || !isBotReady) return res.status(503).json({ status: 'error', message: 'Bot not ready' });

        let formattedNumber = number.toString().replace(/[^0-9]/g, '');
        if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
        await sock.sendMessage(formattedNumber + '@s.whatsapp.net', { text: message });
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.toString() });
    }
});

// 🌐 QR Code और वेब रूट्स
app.get('/qr', (req, res) => {
    if (isBotReady) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">✅ बॉट कनेक्टेड है!</h2>');
    }
    if (!currentQrCode) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">QR Code तैयार हो रहा है... कृपया 3 सेकंड बाद Refresh करें।</h2>');
    }
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQrCode)}`;
    res.send(`
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
            <h2>🏫 JRD Public School WhatsApp Bot</h2>
            <p>अपने व्हाट्सएप से इस QR कोड को स्कैन करें:</p>
            <img src="${qrImageUrl}" alt="WhatsApp QR Code" style="border: 2px solid #333; padding: 10px; border-radius: 10px; width: 300px; height: 300px;"/>
            <br>
            <p><a href="/reset-qr" style="color:red; font-weight:bold;">🔄 Force Clean & Regenerate QR Code</a></p>
        </div>
    `);
});

app.get('/reset-qr', (req, res) => {
    forceClearAuthFolder();
    isBotReady = false;
    isConnecting = false;
    currentQrCode = '';
    setTimeout(() => startBot(), 1000);
    res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">🧹 सेशन साफ़ कर दिया गया है! 3 सेकंड बाद <a href="/qr">/qr पेज खोलें</a>।</h2>');
});

app.get('/', (req, res) => {
    res.send(`JRD WhatsApp Bot Status: ${isBotReady ? 'Connected ✅' : 'Waiting for QR scan ⏳'}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Secure VIP Bot running on port ${PORT}`));
startBot();
