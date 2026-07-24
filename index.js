const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const https = require('https');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1CPviWaISRLeTB6wgSPKSjep78v7a48cHjs5-n9q4sPGUM_jqlWA2aUd2qbhUXKBC/exec";

let sock;
let currentQrCode = '';
let isBotReady = false;

// 🚀 Baileys के साथ WhatsApp कनेक्शन शुरू करना
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    console.log('ℹ️ WhatsApp Web version इस्तेमाल हो रहा है:', version.join('.'));

    sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: false,
        browser: ['JRD School Bot', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQrCode = qr;
            console.log('👉 QR Code जनरेट हो गया है! /qr लिंक पर जाकर स्कैन करें।');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isBotReady = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ कनेक्शन बंद हुआ, कारण:', lastDisconnect?.error?.message || 'unknown', '(status:', statusCode, ') | दोबारा कनेक्ट करें:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            } else {
                console.log('❌ Logged out. auth_info_baileys फ़ोल्डर हटाकर दोबारा QR स्कैन करना होगा।');
            }
        } else if (connection === 'open') {
            isBotReady = true;
            currentQrCode = '';
            console.log('\n=============================================');
            console.log(' JRD Enterprise VIP Bot Active & Secured! ');
            console.log('=============================================\n');
        }
    });

    // 📩 आने वाले मैसेज हैंडल करना
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return;

        try {
            await sock.readMessages([msg.key]);
        } catch (e) {}

        const senderPhone = jid.split('@')[0].replace(/[^0-9]/g, '').slice(-10);
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const lowerText = text.toLowerCase();

        console.log(`📱 मैसेज प्राप्त हुआ | शुद्ध 10-अंकों का नंबर : [${senderPhone}] | टेक्स्ट : "${text}"`);

        // 🎯 1. हेल्प एवं वेलकम मेन्यू
        if (['hi', 'hello', 'नमस्ते', 'menu', 'start'].includes(lowerText)) {
            const menuText = `🏫 *J.R.D. PUBLIC SCHOOL*
📍 *मरुई, वाराणसी (उ.प्र.)*
━━━━━━━━━━━━━━━━━━━━━━━
🙏 *अभिभावक डिजिटल सेवा केंद्र*

सूचना प्राप्त करने के लिए संबंधित **नंबर** भेजें:

1️⃣ *नया एडमिशन (सत्र 2026-27)*
2️⃣ *स्कूल टाइमिंग एवं शेड्यूल*
3️⃣ *प्रबंधकीय एवं संस्थापक संदेश*
4️⃣ *विद्यालय का पता व लोकेशन*

🔎 *अपने बच्चे की फीस / प्रोफाइल देखने के लिए:*
बस अपने बच्चे का **नाम** (उदा: *Aditya* या *Ritesh*) सीधे लिखकर भेजें।

_नोट: जानकारी केवल पंजीकृत (Registered) मोबाइल नंबर पर ही उपलब्ध होगी।_
━━━━━━━━━━━━━━━━━━━━━━━`;
            await sendReply(jid, menuText);
            return;
        }

        if (lowerText === '1') {
            await sendReply(jid, `📝 *प्रवेश प्रारंभ (सत्र 2026-27)*\n🏫 *JRD Public School, मरुई, वाराणसी*\n━━━━━━━━━━━━━━━━━━━━━━━\n• संस्कारयुक्त एवं उच्च स्तरीय शिक्षा\n• आधुनिक कंप्यूटर लैब व योग्य शिक्षक\n\n📞 *प्रवेश हेतु विद्यालय कार्यालय में संपर्क करें। *`);
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
            await sendReply(jid, `📍 *विद्यालय लोकेशन:*
JRD Public School, ग्राम व पोस्ट - मरुई, जिला - वाराणसी (उ.प्र.)

🗺 *गूगल मैप्स पर ढूँढें:*
Google Maps पर खोजें: *JRD Public School Marui Varanasi*`);
            return;
        }

        // 💬 2. आम बातचीत (Casual Talk)
        const casualWords = ['कैसे हो', 'कैसे हैं', 'kaise ho', 'kaise hain', 'good morning', 'good afternoon', 'thanks', 'thank you', 'धन्यवाद', 'ok', 'okay', 'ठीक है', 'जय हिंद', 'राम राम', 'सुप्रभात', 'thik hai', 'kya hal hai'];
        if (casualWords.some(word => lowerText.includes(word))) {
            await sendReply(jid, `🙏 *JRD Public School, मरुई* में आपका स्वागत है!\n\nअपने बच्चे का फ़ीस बहीखाता देखने के लिए सीधे उसका **नाम** लिखकर भेजें। मुख्य मेन्यू के लिए **Menu** लिखें।`);
            return;
        }

        // 🔍 3. DOUBLE FILTER SEARCH ENGINE
        if (text.length >= 2) {
            try {
                const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(text)}`;
                const response = await axios.get(apiUrl, { timeout: 15000 });

                if (response.data && response.data.status === 'success') {
                    await sendStudentProfileCard(jid, response.data.data);
                }
                else if (response.data && response.data.status === 'unregistered_number') {
                    await sendReply(jid, `🛑 *अनधिकृत पहुँच (Access Denied)*

आपका मोबाइल नंबर (*${senderPhone}*) विद्यालय के आधिकारिक डेटाबेस में पंजीकृत नहीं है।

सुरक्षा कारणों से छात्र विवरण केवल पंजीकृत (Registered) अभिभावक के नंबर पर ही भेजा जाता है।
_यदि आपने नया नंबर लिया है, तो कृपया विद्यालय कार्यालय में संपर्क करें।_`);
                }
                else if (response.data && (response.data.status === 'student_not_associated_with_number' || response.data.status === 'not_found')) {
                    await sendReply(jid, `❌ *रिकॉर्ड नहीं मिला!*

छात्र का नाम *"${text}"* आपके पंजीकृत मोबाइल नंबर (*${senderPhone}*) से जुड़ा हुआ नहीं पाया गया।

कृपया सही नाम अथवा Enrolment No लिखकर भेजें।`);
                }
            } catch (error) {
                console.error('Database Search Error:', error.message);
            }
        }
    });
}

// ✉️ सामान्य रिप्लाई भेजने का हेल्पर
async function sendReply(jid, text) {
    try {
        await sock.sendMessage(jid, { text });
    } catch (err) {
        console.error('❌ रिप्लाई भेजने में त्रुटि:', err.message);
    }
}

// 📄 PDF रसीद जनरेट करके WhatsApp पर भेजने वाला फ़ंक्शन
async function sendFeePdfReceipt(jid, data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A6', margin: 20 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);

                await sock.sendMessage(jid, {
                    document: pdfBuffer,
                    mimetype: 'application/pdf',
                    fileName: `Fee_Receipt_${data.rid || 'RECEIPT'}.pdf`,
                    caption: `🏫 *J.R.D. PUBLIC SCHOOL*\n🧾 छात्र *${data.name || ''}* की फीस जमा रसीद।`
                });
                resolve();
            });

            // 🎨 PDF डिज़ाइन
            doc.fontSize(14).text('J.R.D. PUBLIC SCHOOL', { align: 'center', bold: true });
            doc.fontSize(9).text('Marui, Varanasi (U.P.)', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(10).text('-------------------------------------------', { align: 'center' });
            doc.fontSize(11).text('OFFICIAL FEE RECEIPT', { align: 'center' });
            doc.text('-------------------------------------------', { align: 'center' });
            doc.moveDown(0.5);

            doc.fontSize(9);
            doc.text(`Receipt No : ${data.rid || 'N/A'}`);
            doc.text(`Student    : ${data.name || 'N/A'}`);
            doc.text(`Class      : ${data.className || 'N/A'}`);
            doc.text(`Session    : ${data.session || '2026-27'}`);
            doc.moveDown(0.5);
            
            doc.text('-------------------------------------------');
            doc.text(`Amount Paid: Rs. ${data.paid || 0}/-`, { bold: true });
            doc.text('-------------------------------------------');
            doc.moveDown(0.5);

            doc.text('Details / Breakdown:');
            const cleanDetails = (data.details || '').replace(/<br>/g, '\n');
            doc.fontSize(8).text(cleanDetails);

            doc.moveDown(1);
            doc.fontSize(8).text('Thank you! JRD Public School Management.', { align: 'center', italic: true });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

// 🎨 VIP प्रोफाइल कार्ड फ़ंक्शन
async function sendStudentProfileCard(jid, s) {
    const replyMsg = `🎓 *STUDENT OFFICIAL PROFILE*
🏫 *JRD Public School, Marui*
📅 *सत्र (Session):* ${s.session || '2026-27'}
━━━━━━━━━━━━━━━━━━━━━━━
🆔 *Enrolment No:* \`${s.enrolment || 'N/A'}\`
📜 *Scholar/Reg No:* ${s.scholar_no || 'N/A'}
🔢 *Roll No:* ${s.roll_no || 'N/A'}

👤 *छात्र का नाम:* *${s.name}*
👨‍👦 *पिता का नाम:* ${s.father}
👩‍👦 *माता का नाम:* ${s.mother}
🏫 *कक्षा:* ${s.class} (${s.type || 'REGULAR'})

💰 *भुगतान एवं जमा विवरण:*
• *कुल जमा शुल्क (Paid):* ₹${s.total_paid || 0}

📊 *मदवार जमा स्थिति:*
${s.paid_list || 'कोई जमा फीस दर्ज नहीं है'}

⚠️ *चालू माह तक बकाया स्थिति:*
${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}

━━━━━━━━━━━━━━━━━━━━━━━
🧾 *बहीखाता कुल बकाया ब्रेकडाउन (DUE SUMMARY):*
• *चालू सत्र बकाया (2026-27):* ₹${s.current_due || 0}
• *पिछला बकाया (Old Due):* ₹${s.old_due || 0}
---------------------------------------
🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${s.grand_due || 0}*
━━━━━━━━━━━━━━━━━━━━━━━
_यदि फ़ीस अथवा विवरण में कोई त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);
}

// 🌐 QR कोड Endpoint
app.get('/qr', (req, res) => {
    if (isBotReady) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">✅ बॉट पहले से कनेक्टेड है, QR की ज़रूरत नहीं।</h2>');
    }
    if (!currentQrCode) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">QR Code तैयार हो रहा है... कृपया 10 सेकंड बाद Refresh (F5) करें।</h2>');
    }
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQrCode)}`;
    res.send(`
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
            <h2>🏫 JRD Public School WhatsApp Bot</h2>
            <p>अपने व्हाट्सएप से इस QR कोड को स्कैन करें:</p>
            <img src="${qrImageUrl}" alt="WhatsApp QR Code" style="border: 2px solid #333; padding: 10px; border-radius: 10px; width: 300px; height: 300px;"/>
            <p><i>स्कैन करने के बाद इस पेज को बंद कर सकते हैं।</i></p>
        </div>
    `);
});

app.get('/', (req, res) => {
    res.send(`JRD WhatsApp Bot is Running! Status: ${isBotReady ? 'Connected ✅' : 'Waiting for QR scan ⏳'}`);
});

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
            const jid = formattedNumber + '@s.whatsapp.net';

            if (item.type === 'FEE_RECEIPT') {
                await sendFeePdfReceipt(jid, item);
                console.log(`✅ [PDF RECEIPT] भेजी गई -> ${formattedNumber}`);
            } else {
                await sock.sendMessage(jid, { text: item.message });
                console.log(`✅ [${item.type}] मैसेज भेजा गया -> ${formattedNumber}`);
            }

            processedCount++;

            const randomDelay = Math.floor(Math.random() * 4000) + 4000;
            await new Promise(res => setTimeout(res, randomDelay));

            if (processedCount % 20 === 0) {
                console.log('⏸️ व्हाट्सएप सुरक्षा: 15 सेकंड का ब्रेक लिया जा रहा है...');
                await new Promise(res => setTimeout(res, 15000));
            }

        } catch (err) {
            console.error(`❌ संदेश भेजने में त्रुटि (${item.number}):`, err.message);
        }
    }

    isProcessingQueue = false;
}

app.post('/enqueue-message', (req, res) => {
    const { number, message, type, name, className, session, rid, paid, details } = req.body;
    if (!number) return res.status(400).json({ status: 'error', message: 'Missing fields' });

    messageQueue.push({ number, message, type: type || 'GENERAL', name, className, session, rid, paid, details });
    console.log(`📥 नया मैसेज/PDF क्यू में जुड़ा -> ${number} (कुल कतार: ${messageQueue.length})`);

    processQueue();

    return res.status(200).json({ status: 'queued', queue_length: messageQueue.length });
});

app.post('/send-whatsapp', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ status: 'error' });

    try {
        let formattedNumber = number.toString().replace(/[^0-9]/g, '');
        if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
        await sock.sendMessage(formattedNumber + '@s.whatsapp.net', { text: message });
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        return res.status(500).json({ status: 'error' });
    }
});

app.listen(3000, () => console.log('Secure VIP Bot running on port 3000'));
startBot();

// 🔄 Keep-Alive Self Ping (Railway को 24/7 एक्टिव रखने के लिए)
setInterval(() => {
    https.get('https://jrd-whatsapp-bot-production.up.railway.app/', (res) => {
        console.log('⚡ Self-Ping successful: Server is active');
    }).on('error', (err) => {
        console.error('❌ Self-Ping error:', err.message);
    });
}, 4 * 60 * 1000);
