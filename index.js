const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const https = require('https');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

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

const messageCache = new Map();
const msgRetryCounterCache = new Map();

let sock = null;
let currentQrCode = '';
let isBotReady = false;
let isConnecting = false;

// 📦 बैकग्राउंड बैकअप (बिना बोट को रोके)
async function backupAuthFolderToCloud() {
    try {
        if (!fs.existsSync(AUTH_FOLDER) || fs.readdirSync(AUTH_FOLDER).length === 0) return;
        const zipPath = path.join(__dirname, 'auth_backup.zip');

        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(AUTH_FOLDER, false);
            archive.finalize();
        });

        if (fs.existsSync(zipPath)) {
            const zipBuffer = fs.readFileSync(zipPath);
            const base64Zip = zipBuffer.toString('base64');

            await axios.post(GOOGLE_SCRIPT_URL, {
                action: 'save_auth_zip',
                key: 'SESSION_ZIP_DATA',
                value: base64Zip
            }, { timeout: 15000 });

            console.log('☁️ Auth Folder Backup Saved to Cloud');
            try { fs.unlinkSync(zipPath); } catch (e) {}
        }
    } catch (err) {
        console.error('⚠️ Backup error:', err.message);
    }
}

// 🚀 WhatsApp Bot Engine (instant startup)
async function startBot() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        if (sock) {
            try { sock.ev.removeAllListeners(); } catch (e) {}
            sock = null;
        }

        console.log('⚡ WhatsApp Bot स्टार्ट हो रहा है...');
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

        sock = makeWASocket({
            auth: state,
            version: [2, 3000, 1017531287], // WhatsApp Web Latest Stable Version
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            browser: Browsers.macOS('Desktop'),
            msgRetryCounterCache,
            retryRequestDelayMs: 500,
            maxMsgRetryCount: 5,
            getMessage: async (key) => {
                if (messageCache.has(key.id)) return messageCache.get(key.id);
                return { conversation: 'JRD Public School' };
            }
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            backupAuthFolderToCloud();
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQrCode = qr;
                isConnecting = false;
                console.log('✅ 🔥 नया QR Code जनरेट हो गया! /qr पर जाकर तुरंत स्कैन करें।');
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === 'close') {
                isBotReady = false;
                isConnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('⚠️ कनेक्शन बंद हुआ | StatusCode:', statusCode, '| Reconnect:', shouldReconnect);

                if (shouldReconnect) {
                    setTimeout(() => startBot(), 3000);
                } else {
                    console.log('❌ Session Logged Out. Clearing Auth Folder...');
                    try {
                        if (fs.existsSync(AUTH_FOLDER)) {
                            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
                        }
                    } catch (e) {}
                    setTimeout(() => startBot(), 3000);
                }
            } else if (connection === 'open') {
                isConnecting = false;
                currentQrCode = '';
                isBotReady = true;
                backupAuthFolderToCloud();
                console.log('\n=============================================');
                console.log(' 🎉 JRD VIP Bot Active & Connected! ');
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

            const senderPhone = jid.split('@')[0].replace(/[^0-9]/g, '').slice(-10);
            const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const lowerText = rawText.toLowerCase();

            console.log(`📱 मैसेज आया | [${senderPhone}] : "${rawText}"`);

            if (['hi', 'hello', 'नमस्ते', 'menu', 'start'].includes(lowerText)) {
                const menuText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *अभिभावक डिजिटल सेवा केंद्र*\n\nसूचना प्राप्त करने के लिए संबंधित **नंबर** भेजें:\n\n1️⃣ *नया एडमिशन (सत्र 2026-27)*\n2️⃣ *स्कूल टाइमिंग एवं शेड्यूल*\n3️⃣ *प्रबंधकीय एवं संस्थापक संदेश*\n4️⃣ *विद्यालय का पता व लोकेशन*\n\n🔎 *अपने बच्चे की फीस / प्रोफाइल देखने के लिए:*\nबस अपने बच्चे का **नाम** (उदा: *Aditya* या *Ritesh*) सीधे लिखकर भेजें।\n\n_नोट: जानकारी केवल पंजीकृत (Registered) मोबाइल नंबर पर ही उपलब्ध होगी।_\n━━━━━━━━━━━━━━━━━━━━━━━`;
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

            const query = rawText.replace(/#/g, '').trim();
            if (query.length >= 2) {
                try {
                    const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(query)}`;
                    const response = await axios.get(apiUrl, { timeout: 15000 });

                    if (response.data && response.data.status === 'success') {
                        await sendStudentProfileCard(jid, response.data.data);
                    } else if (response.data && response.data.status === 'unregistered_number') {
                        await sendReply(jid, `🛑 *अनधिकृत पहुँच (Access Denied)*\n\nआपका मोबाइल नंबर (*${senderPhone}*) विद्यालय के आधिकारिक डेटाबेस में पंजीकृत नहीं है।`);
                    } else if (response.data && (response.data.status === 'student_not_associated_with_number' || response.data.status === 'not_found')) {
                        await sendReply(jid, `❌ *रिकॉर्ड नहीं मिला!*\n\nछात्र का नाम *"${query}"* आपके पंजीकृत मोबाइल नंबर से जुड़ा हुआ नहीं पाया गया।`);
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
            const sent = await sock.sendMessage(jid, { text });
            if (sent?.key?.id) messageCache.set(sent.key.id, { conversation: text });
        }
    } catch (err) {
        console.error('❌ रिप्लाई भेजने में त्रुटि:', err.message);
    }
}

async function sendFeePdfReceipt(jid, data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A6', margin: 20 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);
                if (sock && isBotReady) {
                    const captionText = `🏫 *J.R.D. PUBLIC SCHOOL*\n🧾 छात्र *${data.name || ''}* की फीस जमा रसीद (PDF)।`;
                    const sent = await sock.sendMessage(jid, {
                        document: pdfBuffer,
                        mimetype: 'application/pdf',
                        fileName: `Fee_Receipt_${data.rid || 'RECEIPT'}.pdf`,
                        caption: captionText
                    });
                    if (sent?.key?.id) {
                        messageCache.set(sent.key.id, { documentMessage: { caption: captionText, fileName: `Fee_Receipt_${data.rid || 'RECEIPT'}.pdf` } });
                    }
                }
                resolve();
            });

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

async function sendStudentProfileCard(jid, s) {
    const replyMsg = `🎓 *STUDENT OFFICIAL PROFILE*\n🏫 *JRD Public School, Marui*\n📅 *सत्र (Session):* ${s.session || '2026-27'}\n━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Enrolment No:* \`${s.enrolment || 'N/A'}\` \n📜 *Scholar/Reg No:* ${s.scholar_no || 'N/A'}\n🔢 *Roll No:* ${s.roll_no || 'N/A'}\n\n👤 *छात्र का नाम:* *${s.name}*\n👨‍👦 *पिता का नाम:* ${s.father}\n👩‍👦 *माता का नाम:* ${s.mother}\n🏫 *कक्षा:* ${s.class} (${s.type || 'REGULAR'})\n\n💰 *कुल जमा शुल्क (Paid):* ₹${s.total_paid || 0}\n\n📊 *भुगतान/जमा विवरण:*\n${s.paid_list || 'कोई जमा फीस दर्ज नहीं है'}\n\n⚠️ *बकाया शुल्क विवरण:*\n${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n🧾 *बहीखाता कुल बकाया ब्रेकडाउन (DUE SUMMARY):*\n• *चालू सत्र बकाया (${s.session || '2026-27'}):* ₹${s.current_due || 0}\n• *पिछला बकाया (Old Due):* ₹${s.old_due || 0}\n---------------------------------------\n🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${s.grand_due || 0}*\n━━━━━━━━━━━━━━━━━━━━━━━\n_यदि फ़ीस अथवा विवरण में कोई त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);
}

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
        </div>
    `);
});

app.get('/', (req, res) => {
    res.send(`JRD WhatsApp Bot Status: ${isBotReady ? 'Connected ✅' : 'Waiting for QR scan ⏳'}`);
});

let messageQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const item = messageQueue[0];
        try {
            let formattedNumber = item.number.toString().replace(/[^0-9]/g, '');
            if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
            const jid = formattedNumber + '@s.whatsapp.net';

            if (sock && (isBotReady || sock.user)) {
                let cleanDet = (item.details || '').replace(/<br>/g, "\n");
                let textToSend = item.message;

                if (!textToSend || textToSend.trim() === '') {
                    textToSend = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n🧾 *ऑनलाइन फ़ीस जमा रसीद*\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *छात्र:* ${item.name || 'N/A'}\n🏫 *कक्षा:* ${item.className || 'N/A'}\n📅 *सत्र:* ${item.session || '2026-27'}\n🆔 *रसीद सं:* ${item.rid || 'N/A'}\n💰 *जमा राशि:* ₹${item.paid || 0}/-\n\n📊 *विवरण / Breakdown:*\n${cleanDet}\n━━━━━━━━━━━━━━━━━━━━━━━\nधन्यवाद! - JRD Management`;
                }

                // 🎯 1. पूरा टेक्स्ट मैसेज जाएगा
                const sent = await sock.sendMessage(jid, { text: textToSend });
                if (sent?.key?.id) messageCache.set(sent.key.id, { conversation: textToSend });
                console.log(`✅ [TEXT MSG] भेजा गया -> ${formattedNumber}`);

                // 🎯 2. साथ ही PDF रसीद भी जाएगी
                await sendFeePdfReceipt(jid, item);
                console.log(`✅ [PDF RECEIPT] भेजी गई -> ${formattedNumber}`);

                messageQueue.shift();
            } else {
                console.log('⚠️ बॉट सिंक हो रहा है, 2 सेकंड बाद पुनः प्रयास करेगा...');
                await new Promise(res => setTimeout(res, 2000));
                break;
            }

            await new Promise(res => setTimeout(res, 2000));

        } catch (err) {
            console.error(`❌ संदेश भेजने में त्रुटि (${item.number}):`, err.message);
            messageQueue.shift();
        }
    }

    isProcessingQueue = false;
}

app.post('/enqueue-message', (req, res) => {
    const body = req.body || {};
    const targetPhone = body.number || body.phone || body.mobile || body.to;

    if (!targetPhone) {
        return res.status(400).json({ status: 'error', message: 'Missing phone/number field' });
    }

    messageQueue.push({
        number: targetPhone.toString(),
        message: body.message || "",
        type: body.type || 'GENERAL',
        name: body.name || body.student_name || '',
        className: body.className || body.class || '',
        session: body.session || '2026-27',
        rid: body.rid || body.receipt_no || '',
        paid: body.paid || body.amount || 0,
        details: body.details || ''
    });

    console.log(`📥 नया संदेश क्यू में दर्ज हुआ -> ${targetPhone} (कुल क्यू: ${messageQueue.length})`);
    processQueue();

    return res.status(200).json({ status: 'queued', queue_length: messageQueue.length });
});

app.post('/send-whatsapp', async (req, res) => {
    const body = req.body || {};
    const targetPhone = body.number || body.phone || body.mobile;
    const message = body.message;

    if (!targetPhone || !message) return res.status(400).json({ status: 'error', message: 'Missing params' });

    try {
        if (!sock || !isBotReady) return res.status(503).json({ status: 'error', message: 'Bot not ready' });

        let formattedNumber = targetPhone.toString().replace(/[^0-9]/g, '');
        if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
        const sent = await sock.sendMessage(formattedNumber + '@s.whatsapp.net', { text: message });
        if (sent?.key?.id) messageCache.set(sent.key.id, { conversation: message });
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.toString() });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Secure VIP Bot running on port ${PORT}`));
startBot();

setInterval(() => {
    https.get('https://jrd-whatsapp-bot-production.up.railway.app/', (res) => {
        console.log('⚡ Self-Ping successful');
    }).on('error', (err) => {
        console.error('❌ Self-Ping error:', err.message);
    });
}, 4 * 60 * 1000);
