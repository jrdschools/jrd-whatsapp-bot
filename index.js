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

// 🎯 व्हाट्सएप LID / डिवाइस ID हटाकर गार्जियन का असली 10-अंकों का नंबर निकालने का फ़ंक्शन
function extractGuardianPhone(jid, msg) {
    try {
        let sources = [];
        if (msg?.key?.participant) sources.push(msg.key.participant);
        if (msg?.key?.remoteJid) sources.push(msg.key.remoteJid);
        if (jid) sources.push(jid);

        for (let src of sources) {
            let clean = src.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            
            // 91 से शुरू होने वाला 12-अंकों का भारतीय नंबर
            if (clean.length === 12 && clean.startsWith('91')) {
                let p = clean.substring(2);
                if (/^[6-9]\d{9}$/.test(p)) return p;
            }

            // शुद्ध 10 अंकों का नंबर (6,7,8,9 से शुरू)
            if (clean.length === 10 && /^[6-9]\d{9}$/.test(clean)) {
                return clean;
            }

            // स्ट्रिंग में मौजूद 10 अंकों का मोबाइल नंबर
            let match = clean.match(/[6-9]\d{9}/);
            if (match && match[0]) {
                return match[0];
            }
        }

        let fallback = jid.split('@')[0].replace(/[^0-9]/g, '');
        return fallback.slice(-10);
    } catch (e) {
        return jid.split('@')[0].replace(/[^0-9]/g, '').slice(-10);
    }
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
                console.log('✅ 🔥 नया QR Code तैयार है!');
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
                console.log(' 🎉 JRD Baileys Bot Active & Ready on Railway! ');
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

            // 🎯 असली 10-अंकों का गार्जियन मोबाइल नंबर
            const senderPhone = extractGuardianPhone(jid, msg);
            const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const lowerText = rawText.toLowerCase();

            console.log(`📱 मैसेज आया | निष्पादित मोबाइल नंबर: [${senderPhone}] | टेक्स्ट: "${rawText}"`);

            // 1. मेन्यू व स्टैटिक उत्तर
            if (['hi', 'hello', 'नमस्ते', 'menu', 'start'].includes(lowerText)) {
                const menuText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *अभिभावक डिजिटल सेवा केंद्र*\n\nसूचना प्राप्त करने के लिए संबंधित **नंबर** भेजें:\n\n1️⃣ *नया एडमिशन (सत्र 2026-27)*\n2️⃣ *स्कूल टाइमिंग एवं शेड्यूल*\n3️⃣ *प्रबंधकीय एवं संस्थापक संदेश*\n4️⃣ *विद्यालय का पता व लोकेशन*\n\n🔎 *अपने बच्चे की फीस / प्रोफाइल देखने के लिए:*\nबस अपने बच्चे का **नाम** (उदा: *Aditya* या *Ritesh*) सीधे लिखकर भेजें।\n\n_नोट: आपका मोबाइल नंबर पंजीकृत होना अनिवार्य है।_`;
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

            // 2. गूगल शीट में नाम/नंबर सर्च
            if (rawText.length >= 2) {
                try {
                    const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(rawText)}`;
                    const response = await axios.get(apiUrl, { timeout: 12000 });
                    const resData = response.data || {};

                    if (resData.status === 'success') {
                        await sendStudentProfileCard(jid, resData.data);
                    } else if (resData.status === 'unregistered_number') {
                        await sendReply(jid, `🛑 *अनधिकृत पहुँच (Access Denied)*\n\nआपका मोबाइल नंबर (*${senderPhone}*) विद्यालय के आधिकारिक डेटाबेस में पंजीकृत नहीं है।\n\nसुरक्षा कारणों से छात्र विवरण केवल पंजीकृत अभिभावक के नंबर पर ही भेजा जाता है।`);
                    } else if (resData.status === 'student_not_associated_with_number' || resData.status === 'not_found') {
                        await sendReply(jid, `❌ *रिकॉर्ड नहीं मिला!*\n\nछात्र का नाम *"${rawText}"* आपके पंजीकृत मोबाइल नंबर (*${senderPhone}*) से जुड़ा हुआ नहीं पाया गया।`);
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

async function sendStudentProfileCard(jid, s) {
    const replyMsg = `🎓 *STUDENT OFFICIAL PROFILE*\n🏫 *JRD Public School, Marui*\n📅 *सत्र (Session):* ${s.session || '2026-27'}\n━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Enrolment No:* \`${s.enrolment || 'N/A'}\` \n📜 *Scholar/Reg No:* ${s.scholar_no || 'N/A'}\n🔢 *Roll No:* ${s.roll_no || 'N/A'}\n\n👤 *छात्र का नाम:* *${s.name}*\n👨‍👦 *पिता का नाम:* ${s.father}\n👩‍👦 *माता का नाम:* ${s.mother}\n🏫 *कक्षा:* ${s.class} (${s.type || 'REGULAR'})\n\n💰 *कुल जमा शुल्क (Paid):* ₹${s.total_paid || 0}\n\n📊 *भुगतान/जमा विवरण:*\n${s.paid_list || 'कोई जमा फीस दर्ज नहीं है'}\n\n⚠️ *बकाया शुल्क विवरण:*\n${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n🧾 *बहीखाता कुल बकाया ब्रेकडाउन (DUE SUMMARY):*\n• *चालू सत्र बकाया (2026-27):* ₹${s.current_due || 0}\n• *पिछला बकाया (Old Due):* ₹${s.old_due || 0}\n---------------------------------------\n🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${s.grand_due || 0}*\n━━━━━━━━━━━━━━━━━━━━━━━\n_यदि फ़ीस अथवा विवरण में कोई त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);
}

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
            <p><a href="/reset-qr" style="color:red; font-weight:bold;">🔄 Force Reset QR Code</a></p>
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
app.listen(PORT, () => console.log(`Baileys Bot running on port ${PORT}`));
startBot();
