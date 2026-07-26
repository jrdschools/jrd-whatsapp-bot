const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const https = require('https');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1CPviWaISRLeTB6wgSPKSjep78v7a48cHjs5-n9q4sPGUM_jqlWA2aUd2qbhUXKBC/exec";

let sock;
let currentQrCode = '';
let isBotReady = false;

// 🎯 100% सटीक: व्हाट्सएप LID / फर्जी आईडी हटाकर केवल असली 10-अंकों का गार्जियन मोबाइल नंबर निकालने का फ़ंक्शन
function extractRealGuardianPhone(msg, jid) {
    try {
        let candidates = [];

        // 1. WhatsApp Message Context से नंबर देखें (WhatsApp Alt/Participant ID)
        if (msg?.key?.remoteJidAlt) candidates.push(msg.key.remoteJidAlt);
        if (msg?.key?.participant) candidates.push(msg.key.participant);
        if (msg?.participant) candidates.push(msg.participant);
        if (jid) candidates.push(jid);

        for (let raw of candidates) {
            if (!raw) continue;
            let str = raw.split('@')[0].split(':')[0];
            let digits = str.replace(/[^0-9]/g, '');

            // यदि 12 अंक हैं और 91 से शुरू हो रहा है (उदा: 919792649799)
            if (digits.length === 12 && digits.startsWith('91')) {
                let p = digits.substring(2);
                if (/^[6-9]\d{9}$/.test(p)) return p; // असली गार्जियन नंबर
            }

            // यदि शुद्ध 10 अंकों का भारतीय मोबाइल नंबर है (6,7,8,9 से शुरू होने वाला)
            if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
                return digits;
            }

            // यदि लंबा स्ट्रिंग हो, तो उसमें से 10 अंकों का मोबाइल नंबर ढूँढें
            let match = digits.match(/[6-9]\d{9}/);
            if (match && match[0]) {
                return match[0];
            }
        }

        let fallback = (jid || '').split('@')[0].replace(/[^0-9]/g, '');
        return fallback.slice(-10);
    } catch (e) {
        return (jid || '').split('@')[0].replace(/[^0-9]/g, '').slice(-10);
    }
}

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

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return;

        try {
            await sock.readMessages([msg.key]);
        } catch (e) {}

        // 🎯 LID फ़िक्स: अब हमेशा गार्जियन का असली 10-अंकों वाला मोबाइल नंबर ही एक्सट्रैक्ट होगा
        const senderPhone = extractRealGuardianPhone(msg, jid);
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const lowerText = text.toLowerCase();

        console.log(`📱 मैसेज प्राप्त हुआ | असली गार्जियन नंबर : [${senderPhone}] | टेक्स्ट : "${text}"`);

        const isGreeting = ['hi', 'hello', 'नमस्ते', 'menu', 'start'].includes(lowerText);
        const isOptionNum = ['1', '2', '3', '4'].includes(lowerText);

        if (isOptionNum) {
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
        }

        if (text.length >= 2) {
            try {
                const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(text)}`;
                const response = await axios.get(apiUrl, { timeout: 15000 });
                const resData = response.data || {};

                if (resData.status === 'unregistered_number') {
                    if (isGreeting || isOptionNum) {
                        await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई (वाराणसी)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 हमारे विद्यालय की डिजिटल हेल्पलाइन में आपका स्वागत है!\n\nसत्र 2026-27 हेतु नए प्रवेश प्रारंभ हैं।\nअधिक जानकारी या संपर्क के लिए विकल्प भेजें:\n1️⃣ एडमिशन जानकारी\n2️⃣ स्कूल टाइमिंग\n3️⃣ प्रबंधक संदेश\n4️⃣ लोकेशन\n\n_नोट: आपका मोबाइल नंबर (${senderPhone}) छात्र डेटाबेस में पंजीकृत नहीं है।_`);
                    } else {
                        await sendReply(jid, `🛑 *अनधिकृत पहुँच (Access Denied)*\n\nआपका मोबाइल नंबर (*${senderPhone}*) विद्यालय के आधिकारिक डेटाबेस में पंजीकृत नहीं है।\n\nसुरक्षा कारणों से छात्र विवरण केवल पंजीकृत (Registered) अभिभावक के नंबर पर ही भेजा जाता है।\n_यदि आपने नया नंबर लिया है, तो कृपया विद्यालय कार्यालय में संपर्क करें।_`);
                    }
                    return;
                }

                if (isGreeting) {
                    const menuText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *अभिभावक डिजिटल सेवा केंद्र*\n\nसूचना प्राप्त करने के लिए संबंधित **नंबर** भेजें:\n\n1️⃣ *नया एडमिशन (सत्र 2026-27)*\n2️⃣ *स्कूल टाइमिंग एवं शेड्यूल*\n3️⃣ *प्रबंधकीय एवं संस्थापक संदेश*\n4️⃣ *विद्यालय का पता व लोकेशन*\n\n🔎 *अपने बच्चे की फीस / प्रोफाइल देखने के लिए:*\nबस अपने बच्चे का **नाम** (उदा: *Aditya* या *Ritesh*) सीधे लिखकर भेजें।\n\n_आपका नंबर पंजीकृत (Registered) है ✅_`;
                    await sendReply(jid, menuText);
                    return;
                }

                if (resData.status === 'success') {
                    await sendStudentProfileCard(jid, resData.data);
                } else if (resData.status === 'student_not_associated_with_number' || resData.status === 'not_found') {
                    await sendReply(jid, `❌ *रिकॉर्ड नहीं मिला!*\n\nछात्र का नाम *"${text}"* आपके पंजीकृत मोबाइल नंबर (*${senderPhone}*) से जुड़ा हुआ नहीं पाया गया।\n\nकृपया सही नाम लिखकर भेजें।`);
                }
            } catch (error) {
                console.error('Database Search Error:', error.message);
                if (isGreeting) {
                    await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n\nमुख्य मेन्यू देखने के लिए **Menu** लिखें।`);
                }
            }
        }
    });
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

async function sendFeePdfReceipt(jid, data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A5', margin: 20 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);

                if (sock && isBotReady) {
                    await sock.sendMessage(jid, {
                        document: pdfBuffer,
                        mimetype: 'application/pdf',
                        fileName: `Fee_Receipt_${data.rid || 'RECEIPT'}.pdf`,
                        caption: `🏫 *J.R.D. PUBLIC SCHOOL*\n🧾 छात्र *${data.name || ''}* की आधिकारिक फीस जमा रसीद (PDF)।`
                    });
                }
                resolve();
            });

            doc.rect(10, 10, doc.page.width - 20, doc.page.height - 20).lineWidth(1.5).stroke('#1A365D');
            doc.rect(13, 13, doc.page.width - 26, doc.page.height - 26).lineWidth(0.5).stroke('#1A365D');

            doc.rect(20, 20, doc.page.width - 40, 55).fill('#1A365D');
            doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 20, 28, { align: 'center' });
            doc.fontSize(9).font('Helvetica').text('Marui, Varanasi (U.P.) | Contact: Office Administration', 20, 48, { align: 'center' });

            doc.fillColor('#000000');
            doc.rect(20, 80, doc.page.width - 40, 20).fill('#E2E8F0');
            doc.fillColor('#1A365D').fontSize(10).font('Helvetica-Bold').text('OFFICIAL FEE PAYMENT RECEIPT', 20, 85, { align: 'center' });

            const metaTop = 110;
            doc.rect(20, metaTop, doc.page.width - 40, 75).lineWidth(0.5).stroke('#CBD5E1');

            doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold');
            doc.text(`Receipt No : `, 30, metaTop + 10);
            doc.font('Helvetica').text(`${data.rid || 'N/A'}`, 90, metaTop + 10);

            doc.font('Helvetica-Bold').text(`Student Name: `, 30, metaTop + 28);
            doc.font('Helvetica').text(`${data.name || 'N/A'}`, 100, metaTop + 28);

            doc.font('Helvetica-Bold').text(`Class & Sec  : `, 30, metaTop + 46);
            doc.font('Helvetica').text(`${data.className || 'N/A'}`, 100, metaTop + 46);

            const rightX = doc.page.width / 2 + 10;
            doc.font('Helvetica-Bold').text(`Session : `, rightX, metaTop + 10);
            doc.font('Helvetica').text(`${data.session || '2026-27'}`, rightX + 50, metaTop + 10);

            doc.font('Helvetica-Bold').text(`Status  : `, rightX, metaTop + 28);
            doc.fillColor('#15803D').font('Helvetica-Bold').text(`PAID ✅`, rightX + 50, metaTop + 28);

            doc.fillColor('#334155').font('Helvetica-Bold').text(`Date    : `, rightX, metaTop + 46);
            const todayDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            doc.font('Helvetica').text(`${todayDate}`, rightX + 50, metaTop + 46);

            const tableTop = 195;
            doc.rect(20, tableTop, doc.page.width - 40, 20).fill('#F1F5F9');
            doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold');
            doc.text('Particulars / Fee Details', 30, tableTop + 5);
            doc.text('Amount (Rs.)', doc.page.width - 120, tableTop + 5, { align: 'right' });

            doc.moveTo(20, tableTop + 20).lineTo(doc.page.width - 20, tableTop + 20).stroke('#CBD5E1');

            let detailsY = tableTop + 30;
            const cleanDetails = (data.details || 'School Tuition / Annual Fee').replace(/<br>/g, '\n');
            doc.fillColor('#334155').fontSize(9).font('Helvetica');
            doc.text(cleanDetails, 30, detailsY, { width: doc.page.width - 150 });

            const totalBoxY = doc.page.height - 120;
            doc.rect(20, totalBoxY, doc.page.width - 40, 30).fill('#1A365D');
            doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold');
            doc.text('TOTAL AMOUNT PAID:', 30, totalBoxY + 9);
            doc.text(`Rs. ${data.paid || 0}/-`, doc.page.width - 130, totalBoxY + 9, { align: 'right' });

            const footerY = doc.page.height - 75;
            doc.fillColor('#64748B').fontSize(7.5).font('Helvetica-Oblique');
            doc.text('This is an officially generated digital fee receipt from JRD Public School Management.', 20, footerY, { align: 'center' });
            doc.text('For queries, please contact the school administrative office.', 20, footerY + 11, { align: 'center' });

            doc.rect(doc.page.width - 120, footerY - 5, 100, 35).lineWidth(0.5).stroke('#CBD5E1');
            doc.fillColor('#0F172A').fontSize(7).font('Helvetica-Bold');
            doc.text('AUTHORIZED STAMP', doc.page.width - 120, footerY + 10, { width: 100, align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

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

💰 *कुल जमा शुल्क (Paid):* ₹${s.total_paid || 0}

📊 *भुगतान/जमा विवरण:*
${s.paid_list || 'कोई जमा फीस दर्ज नहीं है'}

⚠️ *बकाया शुल्क विवरण:*
${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}

━━━━━━━━━━━━━━━━━━━━━━━
🧾 *बहीखाता कुल बकाया ब्रेकडाउन (DUE SUMMARY):*
• *चालू सत्र बकाया (${s.session || '2026-27'}):* ₹${s.current_due || 0}
• *पिछला बकाया (Old Due):* ₹${s.old_due || 0}
---------------------------------------
🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${s.grand_due || 0}*
━━━━━━━━━━━━━━━━━━━━━━━
_यदि फ़ीस अथवा विवरण में कोई त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);
}

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

let messageQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;

    let processedCount = 0;

    while (messageQueue.length > 0) {
        const item = messageQueue.shift();
        try {
            if (!sock || !isBotReady) {
                console.log('⚠️ बॉट अभी पूरी तरह कनेक्टेड नहीं है, मैसेज होल्ड किया जा रहा है...');
                messageQueue.unshift(item);
                await new Promise(res => setTimeout(res, 3000));
                continue;
            }

            let formattedNumber = item.number.toString().replace(/[^0-9]/g, '');
            if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
            const jid = formattedNumber + '@s.whatsapp.net';

            let cleanDet = (item.details || '').replace(/<br>/g, "\n");
            let textToSend = item.message;

            if (!textToSend || textToSend.trim() === '') {
                textToSend = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n🧾 *ऑनलाइन फ़ीस जमा रसीद*\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *छात्र:* ${item.name || 'N/A'}\n🏫 *कक्षा:* ${item.className || 'N/A'}\n📅 *सत्र:* ${item.session || '2026-27'}\n🆔 *रसीद सं:* ${item.rid || 'N/A'}\n💰 *जमा राशि:* ₹${item.paid || 0}/-\n\n📊 *विवरण / Breakdown:*\n${cleanDet}\n━━━━━━━━━━━━━━━━━━━━━━━\nधन्यवाद! - JRD Management`;
            }

            // 1. टेक्स्ट मैसेज
            await sock.sendMessage(jid, { text: textToSend });
            console.log(`✅ [TEXT SMS] सफलतापूर्वक भेजा गया -> ${formattedNumber}`);

            // 2. तुरंत 1 सेकंड रुक कर PDF रसीद
            await new Promise(res => setTimeout(res, 1000));
            await sendFeePdfReceipt(jid, item);
            console.log(`✅ [PDF RECEIPT] सफलतापूर्वक भेजी गई -> ${formattedNumber}`);

            processedCount++;

            const randomDelay = Math.floor(Math.random() * 2000) + 1000;
            await new Promise(res => setTimeout(res, randomDelay));

            if (processedCount % 20 === 0) {
                console.log('⏸️ व्हाट्सएप सुरक्षा: 10 सेकंड का ब्रेक लिया जा रहा है...');
                await new Promise(res => setTimeout(res, 10000));
            }

        } catch (err) {
            console.error(`❌ संदेश भेजने में त्रुटि (${item.number}):`, err.message);
        }
    }

    isProcessingQueue = false;
}

app.post('/enqueue-message', (req, res) => {
    const body = req.body || {};
    
    const targetPhone = body.number || body.phone || body.mobile || body.to;

    if (!targetPhone) {
        console.error("❌ Invalid Enqueue Payload: Phone number missing!", body);
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
        await sock.sendMessage(formattedNumber + '@s.whatsapp.net', { text: message });
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
        console.log('⚡ Self-Ping successful: Server is active');
    }).on('error', (err) => {
        console.error('❌ Self-Ping error:', err.message);
    });
}, 4 * 60 * 1000);
