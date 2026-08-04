const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
ffmpeg.setFfmpegPath(ffmpegPath);

// 🗄️ Database Import
let updateAttendanceSmsStatus, testDbConnection;
try {
    const db = require('./db');
    updateAttendanceSmsStatus = db.updateAttendanceSmsStatus;
    testDbConnection = db.testDbConnection;
    if (testDbConnection) testDbConnection();
} catch (e) {
    console.log('⚠️ db.js उपलब्ध नहीं है या स्किप किया गया।');
}

const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1CPviWaISRLeTB6wgSPKSjep78v7a48cHjs5-n9q4sPGUM_jqlWA2aUd2qbhUXKBC/exec";

// 🎙️ Indian Hindi Female Voice (Microsoft Edge Neural TTS) — नॉन-रोबोटिक
const HINDI_FEMALE_VOICE = "hi-IN-SwaraNeural";

// 📇 PDF Safe Text Helper (PDFKit क्रैश रोकने के लिए)
function safePdfText(str, fallback = 'N/A') {
    if (!str) return fallback;
    let clean = String(str).replace(/[^\x00-\x7F]/g, '').trim();
    return clean.length > 0 ? clean : fallback;
}

// 📊 On-Demand Dynamic Fee Calculator (Till Month Logic)
function calculateDynamicDue(student) {
    const monthlyFee = parseFloat(student.monthly_fee || student.tuition_fee || 0);
    const studentType = String(student.type || student.student_type || 'REGULAR').toUpperCase();
    const oldDue = parseFloat(student.old_due || 0);
    const totalPaid = parseFloat(student.total_paid || student.paid || 0);

    const currentMonth = new Date().getMonth() + 1;
    let elapsedMonths = 0;
    if (currentMonth >= 4) {
        elapsedMonths = currentMonth - 3;
    } else {
        elapsedMonths = currentMonth + 9;
    }

    let actualMonthlyFee = (studentType === 'RTE') ? 0 : monthlyFee;
    let expectedTillMonth = actualMonthlyFee * elapsedMonths;
    let currentDue = Math.max(0, expectedTillMonth - totalPaid);
    let grandTotalDue = currentDue + oldDue;

    return {
        elapsedMonths,
        expectedTillMonth,
        currentDue,
        oldDue,
        grandTotalDue
    };
}

// 📇 LID (WhatsApp Privacy ID) Mapping
const LID_MAP_FILE = path.join(__dirname, 'lid_phone_map.json');
let lidPhoneMap = {};

function loadLidPhoneMap() {
    try {
        if (fs.existsSync(LID_MAP_FILE)) {
            lidPhoneMap = JSON.parse(fs.readFileSync(LID_MAP_FILE, 'utf8')) || {};
            console.log(`📇 LID मैपिंग कैश लोड हुआ (${Object.keys(lidPhoneMap).length} एंट्री)`);
        }
    } catch (e) {
        lidPhoneMap = {};
    }
}

function saveLidPhoneMapping(lidJid, phone) {
    try {
        if (!lidJid || !phone || lidPhoneMap[lidJid] === phone) return;
        lidPhoneMap[lidJid] = phone;
        fs.writeFileSync(LID_MAP_FILE, JSON.stringify(lidPhoneMap, null, 2));
        console.log(`📇 नई LID मैपिंग याद रखी: ${lidJid} → ${phone}`);
    } catch (e) {}
}

loadLidPhoneMap();

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

function forceClearAuthFolder() {
    try {
        if (sock) {
            try { sock.ev.removeAllListeners(); } catch (e) {}
            try { sock.ws?.close(); } catch (e) {}
            sock = null;
        }
        if (fs.existsSync(AUTH_FOLDER)) {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
            console.log('🧹 Auth Folder पूरी तरह से साफ़ कर दिया गया!');
        }
    } catch (e) {
        console.error('❌ Error clearing Auth Folder:', e.message);
    }
}

function pnJidToIndianMobile(candidate) {
    if (!candidate || typeof candidate !== 'string') return null;
    if (candidate.includes('@lid')) return null;

    let digits = candidate.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    if (digits.length === 12 && digits.startsWith('91')) {
        const p = digits.substring(2);
        if (/^[6-9]\d{9}$/.test(p)) return p;
    }

    if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return digits;

    if (digits.length > 0 && digits.length <= 13) {
        const match = digits.match(/[6-9]\d{9}/);
        if (match && match[0]) return match[0];
    }
    return null;
}

async function extractGuardianPhone(jid, msg) {
    try {
        const directCandidates = [];

        if (msg?.key?.remoteJidAlt) directCandidates.push(msg.key.remoteJidAlt);
        if (msg?.key?.participantAlt) directCandidates.push(msg.key.participantAlt);
        if (msg?.key?.participant) directCandidates.push(msg.key.participant);
        if (msg?.key?.remoteJid) directCandidates.push(msg.key.remoteJid);
        if (jid) directCandidates.push(jid);

        const ctx = msg?.message?.extendedTextMessage?.contextInfo;
        if (ctx?.participant) directCandidates.push(ctx.participant);

        const lidCandidates = [...new Set(directCandidates.filter(c => typeof c === 'string' && c.includes('@lid')))];

        for (const candidate of directCandidates) {
            const phone = pnJidToIndianMobile(candidate);
            if (phone) {
                lidCandidates.forEach(lidJid => saveLidPhoneMapping(lidJid, phone));
                return phone;
            }
        }

        for (const lidJid of lidCandidates) {
            try {
                const resolved = await sock?.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
                const phone = pnJidToIndianMobile(resolved);
                if (phone) {
                    saveLidPhoneMapping(lidJid, phone);
                    return phone;
                }
            } catch (e) {}
        }

        for (const lidJid of lidCandidates) {
            if (lidPhoneMap[lidJid]) return lidPhoneMap[lidJid];
        }

        console.log(`⚠️ [LID-UNRESOLVED] गार्जियन का असली मोबाइल नंबर नहीं निकल पाया। Raw JID: ${jid}`);
        return null;
    } catch (e) {
        console.error('❌ extractGuardianPhone में त्रुटि:', e.message);
        return null;
    }
}

async function startBot() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        console.log('⚡ JRD VIP WhatsApp Bot स्टार्ट हो रहा है...');
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
            browser: Browsers.ubuntu('Chrome'),
            msgRetryCounterCache,
            retryRequestDelayMs: 1000,
            maxMsgRetryCount: 5,
            getMessage: async (key) => {
                if (messageCache.has(key.id)) return messageCache.get(key.id);
                return { conversation: 'JRD Public School' };
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQrCode = qr;
                isConnecting = false;
                console.log('✅ 🔥 नया QR Code तैयार है! /qr खोलें।');
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === 'close') {
                isBotReady = false;
                isConnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('❌ सेशन समाप्त। नया QR कोड जनरेट हो रहा है...');
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
                console.log(' 🎉 JRD VIP ERP Bot Active & Ready on Railway! ');
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

            const senderPhone = await extractGuardianPhone(jid, msg);
            const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const lowerText = rawText.toLowerCase();

            console.log(`📱 मैसेज आया | निष्पादित गार्जियन नंबर: [${senderPhone}] | टेक्स्ट: "${rawText}"`);

            if (!senderPhone) {
                const possiblePhone = rawText.replace(/[^0-9]/g, '');

                if (possiblePhone.length === 10 && /^[6-9]\d{9}$/.test(possiblePhone)) {
                    try {
                        const verifyUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${possiblePhone}&query=CHECK_USER`;
                        const verifyRes = await axios.get(verifyUrl, { timeout: 12000 });

                        if (verifyRes.data?.status !== 'unregistered_number') {
                            saveLidPhoneMapping(jid, possiblePhone);
                            await sendReply(jid, `✅ *आपका नंबर सफलतापूर्वक जुड़ गया है!*\n\nकृपया दोबारा *Hi* लिखें और मेन्यू देखें।`);
                        } else {
                            await sendReply(jid, `❌ यह नंबर (*${possiblePhone}*) विद्यालय डेटाबेस में पंजीकृत नहीं है।\n\nकृपया अपना सही पंजीकृत नंबर दोबारा भेजें।`);
                        }
                    } catch (e) {
                        await sendReply(jid, `⚠️ सत्यापन में त्रुटि हुई। कृपया कुछ देर बाद पुनः प्रयास करें।`);
                    }
                    return;
                }

                await sendReply(jid, `👋 *नमस्ते!*\nWhatsApp की नई प्राइवेसी सेटिंग के कारण आपका नंबर स्वतः नहीं पहचाना जा सका।\n\n📱 कृपया अपना वही *10 अंकों का मोबाइल नंबर* भेजें जो विद्यालय में पंजीकृत है (उदाहरण: 9792649799)।`);
                return;
            }

            const isGreeting = ['hi', 'hello', 'नमस्ते', 'menu', 'start', 'good morning', 'suprabhat', 'जय हिंद'].includes(lowerText);
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

            const searchQuery = rawText.replace(/#/g, '').trim();

            try {
                const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(searchQuery || 'CHECK_USER')}`;
                const response = await axios.get(apiUrl, { timeout: 12000 });
                const resData = response.data || {};

                if (resData.status === 'unregistered_number') {
                    if (isGreeting || isOptionNum || !rawText.includes('#')) {
                        await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई (वाराणसी)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 हमारे विद्यालय की डिजिटल हेल्पलाइन में आपका स्वागत है!\n\nसत्र 2026-27 हेतु नए प्रवेश प्रारंभ हैं।\nअधिक जानकारी या संपर्क के लिए विकल्प भेजें:\n1️⃣ एडमिशन जानकारी\n2️⃣ स्कूल टाइमिंग\n3️⃣ प्रबंधक संदेश\n4️⃣ लोकेशन\n\n_नोट: आपका मोबाइल नंबर (${senderPhone}) छात्र डेटाबेस में पंजीकृत नहीं है।_`);
                    } else {
                        await sendReply(jid, `🛑 *अनधिकृत पहुँच (Access Denied)*\n\nआपका मोबाइल नंबर (*${senderPhone}*) विद्यालय के आधिकारिक डेटाबेस में पंजीकृत नहीं है।\n\nसुरक्षा कारणों से छात्र विवरण केवल पंजीकृत अभिभावक को ही दिखाया जाता है।`);
                    }
                    return;
                }

                if (isGreeting) {
                    const menuText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *अभिभावक डिजिटल सेवा केंद्र*\n\nसूचना प्राप्त करने के लिए संबंधित **नंबर** भेजें:\n\n1️⃣ *नया एडमिशन (सत्र 2026-27)*\n2️⃣ *स्कूल टाइमिंग एवं शेड्यूल*\n3️⃣ *प्रबंधकीय एवं संस्थापक संदेश*\n4️⃣ *विद्यालय का पता व लोकेशन*\n\n🔎 *अपने बच्चे की फीस / प्रोफाइल देखने के लिए:*\nबच्चे का **नाम** या **Enrolment No.** लिखकर भेजें (उदा: *#Aditya* या *1024*)\n\n_आपका नंबर पंजीकृत है ✅_`;
                    await sendReply(jid, menuText);
                    return;
                }

                if (rawText.includes('#') || searchQuery.length >= 2) {
                    if (resData.status === 'success') {
                        await sendStudentProfileCard(jid, resData.data);
                    } else if (resData.status === 'student_not_associated_with_number' || resData.status === 'not_found') {
                        await sendReply(jid, `❌ *रिकॉर्ड नहीं मिला!*\n\nछात्र का नाम/विवरण *"${searchQuery}"* आपके पंजीकृत मोबाइल नंबर से जुड़ा हुआ नहीं पाया गया।\n\nकृपया सही नाम # के साथ लिखें (उदा: *#Aditya*) या सही Enrolment No भेजें।`);
                    }
                    return;
                }

                await sendReply(jid, `🙏 *JRD Public School, मरुई* में आपका स्वागत है!\n\nअपने बच्चे की फीस या प्रोफाइल देखने के लिए उसका **नाम** (# के साथ) या **Enrolment No** भेजें (उदा: *#Aditya*)।\n\nमुख्य मेन्यू के लिए **Menu** लिखें।`);

            } catch (error) {
                console.error('Database Search Error:', error.message);
                if (isGreeting) {
                    await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n\nमुख्य मेन्यू देखने के लिए **Menu** लिखें।`);
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

async function sendStudentProfileCard(jid, s) {
    const calc = calculateDynamicDue(s);
    const replyMsg = `🎓 *STUDENT OFFICIAL PROFILE*\n🏫 *JRD Public School, Marui*\n📅 *सत्र (Session):* ${s.session || '2026-27'}\n━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Enrolment No:* \`${s.enrolment || 'N/A'}\` \n📜 *Scholar/Reg No:* ${s.scholar_no || 'N/A'}\n🔢 *Roll No:* ${s.roll_no || 'N/A'}\n\n👤 *छात्र का नाम:* *${s.name}*\n👨‍👦 *पिता का नाम:* ${s.father}\n👩‍👦 *माता का नाम:* ${s.mother}\n🏫 *कक्षा:* ${s.class} (${s.type || 'REGULAR'})\n\n💰 *कुल जमा शुल्क (Paid):* ₹${s.total_paid || 0}\n\n📊 *भुगतान/जमा विवरण:*\n${s.paid_list || 'कोई जमा फीस दर्ज नहीं है'}\n\n⚠️ *बकाया शुल्क विवरण:*\n${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n🧾 *बहीखाता कुल बकाया ब्रेकडाउन (DUE SUMMARY):*\n• *चालू सत्र बकाया (टिल मन्थ):* ₹${calc.currentDue}\n• *पिछला बकाया (Old Due):* ₹${calc.oldDue}\n---------------------------------------\n🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${calc.grandTotalDue}*\n━━━━━━━━━━━━━━━━━━━━━━━\n_यदि फ़ीस अथवा विवरण में कोई त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);
}

// 📄 BRANDED OFFICIAL PDF RECEIPT (FOR PAID FEES)
async function sendFeePdfReceipt(jid, data) {
    return new Promise((resolve) => {
        try {
            const doc = new PDFDocument({ size: 'A5', margin: 20 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(buffers);
                    if (sock && isBotReady) {
                        const captionText = `🏫 *J.R.D. PUBLIC SCHOOL (MARUI, VARANASI)*\n🧾 छात्र *${data.name || data.studentName || ''}* की आधिकारिक डिजिटल फीस जमा रसीद।`;
                        const sent = await sock.sendMessage(jid, {
                            document: pdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `Fee_Receipt_${safePdfText(data.rid, 'RECEIPT')}.pdf`,
                            caption: captionText
                        });
                        if (sent?.key?.id) {
                            messageCache.set(sent.key.id, { documentMessage: { caption: captionText, fileName: `Fee_Receipt_${safePdfText(data.rid, 'RECEIPT')}.pdf` } });
                        }
                    }
                    resolve();
                } catch (e) {
                    console.error('PDF Send Error:', e.message);
                    resolve();
                }
            });

            doc.rect(10, 10, doc.page.width - 20, doc.page.height - 20).lineWidth(1.5).stroke('#1A365D');
            doc.rect(13, 13, doc.page.width - 26, doc.page.height - 26).lineWidth(0.5).stroke('#1A365D');

            doc.rect(20, 20, doc.page.width - 40, 55).fill('#1A365D');
            doc.fillColor('#FFFFFF').fontSize(15).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 20, 28, { align: 'center' });
            doc.fontSize(8.5).font('Helvetica').text('Marui, Varanasi (U.P.) - 221208 | UDISE: 09670804504', 20, 48, { align: 'center' });

            doc.fillColor('#000000');
            doc.rect(20, 80, doc.page.width - 40, 20).fill('#E2E8F0');
            doc.fillColor('#1A365D').fontSize(9.5).font('Helvetica-Bold').text('OFFICIAL FEE PAYMENT RECEIPT', 20, 85, { align: 'center' });

            const metaTop = 108;
            doc.rect(20, metaTop, doc.page.width - 40, 70).lineWidth(0.5).stroke('#CBD5E1');

            doc.fillColor('#334155').fontSize(8.5).font('Helvetica-Bold');
            doc.text(`Receipt No : `, 28, metaTop + 8);
            doc.font('Helvetica').text(`${safePdfText(data.rid, 'N/A')}`, 90, metaTop + 8);

            doc.font('Helvetica-Bold').text(`Student Name: `, 28, metaTop + 25);
            doc.font('Helvetica').text(`${safePdfText(data.name || data.studentName, 'STUDENT')}`, 95, metaTop + 25);

            doc.font('Helvetica-Bold').text(`Class & Sec  : `, 28, metaTop + 42);
            doc.font('Helvetica').text(`${safePdfText(data.className, 'N/A')}`, 95, metaTop + 42);

            const rightX = doc.page.width / 2 + 10;
            doc.font('Helvetica-Bold').text(`Session : `, rightX, metaTop + 8);
            doc.font('Helvetica').text(`${safePdfText(data.session, '2026-27')}`, rightX + 45, metaTop + 8);

            doc.font('Helvetica-Bold').text(`Status  : `, rightX, metaTop + 25);
            doc.fillColor('#15803D').font('Helvetica-Bold').text(`PAID OK`, rightX + 45, metaTop + 25);

            doc.fillColor('#334155').font('Helvetica-Bold').text(`Date    : `, rightX, metaTop + 42);
            const todayDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            doc.font('Helvetica').text(`${todayDate}`, rightX + 45, metaTop + 42);

            const tableTop = 188;
            doc.rect(20, tableTop, doc.page.width - 40, 18).fill('#F1F5F9');
            doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold');
            doc.text('Particulars / Fee Details', 28, tableTop + 4);
            doc.text('Amount (Rs.)', doc.page.width - 120, tableTop + 4, { align: 'right' });

            doc.moveTo(20, tableTop + 18).lineTo(doc.page.width - 20, tableTop + 18).stroke('#CBD5E1');

            let detailsY = tableTop + 26;
            const cleanDetails = safePdfText((data.details || '').replace(/<br>/g, '\n'), 'School Tuition / Fee Payment');
            doc.fillColor('#334155').fontSize(8.5).font('Helvetica');
            doc.text(cleanDetails, 28, detailsY, { width: doc.page.width - 150 });

            const totalBoxY = doc.page.height - 110;
            doc.rect(20, totalBoxY, doc.page.width - 40, 26).fill('#1A365D');
            doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold');
            doc.text('TOTAL AMOUNT RECEIVED:', 28, totalBoxY + 8);
            doc.text(`Rs. ${data.paid || 0}/-`, doc.page.width - 130, totalBoxY + 8, { align: 'right' });

            const footerY = doc.page.height - 70;
            doc.fillColor('#64748B').fontSize(7).font('Helvetica-Oblique');
            doc.text('This is an officially generated digital fee receipt from J.R.D. Public School Administration.', 20, footerY, { align: 'center' });

            doc.rect(doc.page.width - 115, footerY - 5, 95, 30).lineWidth(0.5).stroke('#CBD5E1');
            doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold');
            doc.text('OFFICIAL SEAL & STAMP', doc.page.width - 115, footerY + 8, { width: 95, align: 'center' });

            doc.end();
        } catch (err) {
            console.error('PDF Receipt Build Error:', err.message);
            resolve();
        }
    });
}

// 📄 BRANDED OFFICIAL FEE REMINDER NOTICE PDF
async function sendFeeReminderPdf(jid, data) {
    return new Promise((resolve) => {
        try {
            const doc = new PDFDocument({ size: 'A5', margin: 20 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(buffers);
                    if (sock && isBotReady) {
                        const captionText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📄 छात्र *${data.studentName || data.name || ''}* का आधिकारिक बहीखाता विवरण PDF।`;
                        await sock.sendMessage(jid, {
                            document: pdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `Fee_Reminder_${safePdfText(data.studentName || data.name, 'Notice')}.pdf`,
                            caption: captionText
                        });
                    }
                    resolve();
                } catch (e) {
                    console.error('PDF Reminder Send Error:', e.message);
                    resolve();
                }
            });

            doc.rect(10, 10, doc.page.width - 20, doc.page.height - 20).lineWidth(1.5).stroke('#B91C1C');

            doc.rect(20, 20, doc.page.width - 40, 50).fill('#B91C1C');
            doc.fillColor('#FFFFFF').fontSize(15).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 20, 26, { align: 'center' });
            doc.fontSize(8.5).font('Helvetica').text('Marui, Varanasi (U.P.) | Official Fee Reminder Statement', 20, 44, { align: 'center' });

            const metaTop = 80;
            doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
            doc.text(`Student Name: ${safePdfText(data.studentName || data.name, 'STUDENT')}`, 25, metaTop);
            doc.text(`Class: ${safePdfText(data.className, 'N/A')}`, 25, metaTop + 15);
            doc.text(`Enrolment: ${safePdfText(data.scholarNo, 'N/A')}`, doc.page.width - 160, metaTop);

            doc.moveTo(20, metaTop + 30).lineTo(doc.page.width - 20, metaTop + 30).stroke('#E5E7EB');

            doc.fillColor('#1F2937').fontSize(8.5).font('Helvetica');
            doc.text(`You are hereby requested to clear the outstanding school fee dues at the earliest. Detailed fee breakdown is attached below.`, 25, metaTop + 38, { width: doc.page.width - 50 });

            const dueY = doc.page.height - 90;
            doc.rect(20, dueY, doc.page.width - 40, 26).fill('#FEF2F2');
            doc.rect(20, dueY, doc.page.width - 40, 26).lineWidth(1).stroke('#EF4444');
            doc.fillColor('#991B1B').fontSize(10).font('Helvetica-Bold');
            doc.text('TOTAL OUTSTANDING DUES:', 28, dueY + 8);
            doc.text(`Rs. ${data.totalAmount || 0}/-`, doc.page.width - 130, dueY + 8, { align: 'right' });

            doc.fillColor('#6B7280').fontSize(7.5).font('Helvetica-Oblique');
            doc.text('Principal / Accounts Administration -- J.R.D. Public School', 20, doc.page.height - 40, { align: 'center' });

            doc.end();
        } catch (err) {
            console.error('PDF Reminder Build Error:', err.message);
            resolve();
        }
    });
}

// 🎙️ Indian Hindi Female Voice Engine (Microsoft Edge Neural TTS — नॉन-रोबोटिक, नेचुरल आवाज़)
async function generateHindiVoiceNote(text) {
    const stamp = Date.now() + '_' + Math.floor(Math.random() * 100000);
    const mp3Path = path.join(os.tmpdir(), `voice_${stamp}.mp3`);
    const oggPath = path.join(os.tmpdir(), `voice_${stamp}.ogg`);

    try {
        // 1️⃣ Primary Engine: Microsoft Edge Neural TTS (hi-IN-SwaraNeural — Indian girl voice)
        const tts = new MsEdgeTTS();
        await tts.setMetadata(HINDI_FEMALE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = await tts.toStream(text);

        const writer = fs.createWriteStream(mp3Path);
        await new Promise((resolve, reject) => {
            audioStream.pipe(writer);
            audioStream.on('error', reject);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        return await new Promise((resolve) => {
            ffmpeg(mp3Path)
                .audioCodec('libopus')
                .audioBitrate('32k')
                .audioChannels(1)
                .format('ogg')
                .on('end', () => {
                    try {
                        const buffer = fs.readFileSync(oggPath);
                        try { fs.unlinkSync(mp3Path); } catch (e) {}
                        try { fs.unlinkSync(oggPath); } catch (e) {}
                        resolve(buffer);
                    } catch (readErr) {
                        resolve(null);
                    }
                })
                .on('error', (ffErr) => {
                    try { fs.unlinkSync(mp3Path); } catch (e) {}
                    resolve(null);
                })
                .save(oggPath);
        });
    } catch (err) {
        console.error('❌ Edge TTS Engine Error, फॉलबैक इस्तेमाल हो रहा है:', err.message);
        // 2️⃣ Fallback Engine: अगर Edge TTS fail हो जाए तो पुराना Google TTS बैकअप के रूप में चलेगा
        try {
            const encodedText = encodeURIComponent(text);
            const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=hi&client=tw-ob`;

            const response = await axios({
                method: 'get',
                url: ttsUrl,
                responseType: 'stream',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            const writer = fs.createWriteStream(mp3Path);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            return await new Promise((resolve) => {
                ffmpeg(mp3Path)
                    .audioCodec('libopus')
                    .audioBitrate('32k')
                    .audioChannels(1)
                    .format('ogg')
                    .on('end', () => {
                        try {
                            const buffer = fs.readFileSync(oggPath);
                            try { fs.unlinkSync(mp3Path); } catch (e) {}
                            try { fs.unlinkSync(oggPath); } catch (e) {}
                            resolve(buffer);
                        } catch (readErr) {
                            resolve(null);
                        }
                    })
                    .on('error', (ffErr) => {
                        try { fs.unlinkSync(mp3Path); } catch (e) {}
                        resolve(null);
                    })
                    .save(oggPath);
            });
        } catch (fallbackErr) {
            console.error('❌ Fallback Voice Engine भी विफल:', fallbackErr.message);
            try { if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path); } catch (e) {}
            return null;
        }
    }
}

// 🔊 फीस जमा होने पर गार्जियन को हिंदी वॉइस नोट भेजना
async function sendFeeVoiceNote(jid, data) {
    try {
        const spokenText = `नमस्ते! प्रिय अभिभावक, जे आर डी पब्लिक स्कूल मड़ुई से सूचित किया जाता है कि छात्र ${data.name || data.studentName || ''} की फीस ${data.paid || 0} रुपये सफलतापूर्वक जमा हो गई है। डिजिटल रसीद और विवरण हेतु संदेश देखें। धन्यवाद!`;
        const audioBuffer = await generateHindiVoiceNote(spokenText);

        if (audioBuffer && sock && isBotReady) {
            await sock.sendMessage(jid, {
                audio: audioBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            });
        }
    } catch (err) {
        console.error('❌ वॉइस नोट भेजने में त्रुटि:', err.message);
    }
}

// 🛡️ ANTI-BAN SAFE MESSAGE QUEUE ENGINE
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

                if (item.type === 'FEE_REMINDER_COMBO' || item.type === 'FEE_STRUCTURE_COMBO') {
                    const voiceScript = item.voiceText || `नमस्कार! प्रिय अभिभावक, जे आर डी पब्लिक स्कूल मड़ुई से सूचित किया जाता है कि आपके बच्चे ${item.studentName || ''} की विद्यालय में कुल ${item.totalAmount || 0} रुपये फीस बकाया है। विवरण हेतु संदेश देखें। धन्यवाद!`;
                    const audioBuffer = await generateHindiVoiceNote(voiceScript);

                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    }

                    await sock.sendMessage(jid, { text: item.message });

                    await new Promise(res => setTimeout(res, 2000));

                    if (item.qrUrl) {
                        await sock.sendMessage(jid, {
                            image: { url: item.qrUrl },
                            caption: `📲 *1-Click Direct Fee Payment Link:*\n${item.upiLink || ''}\n\n*(स्कैन करने हेतु इस QR कोड को गैलरी में सेव कर सकते हैं)*`
                        });
                    }

                    await new Promise(res => setTimeout(res, 1500));
                    await sendFeeReminderPdf(jid, item);
                }
                else if (item.type === 'ADMISSION_CONFIRMATION') {
                    await sock.sendMessage(jid, { text: item.message });
                }
                else {
                    let cleanDet = (item.details || '').replace(/<br>/g, "\n");
                    let textToSend = item.message;

                    if (!textToSend || textToSend.trim() === '') {
                        textToSend = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n🧾 *आधिकारिक फीस जमा रसीद*\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *छात्र का नाम:* ${item.name || 'N/A'}\n🏫 *कक्षा:* ${item.className || 'N/A'}\n📅 *सत्र:* ${item.session || '2026-27'}\n🆔 *रसीद संख्या:* ${item.rid || 'N/A'}\n💰 *कुल जमा राशि:* ₹${item.paid || 0}/-\n\n📊 *मदवार विवरण / Breakdown:*\n${cleanDet}\n━━━━━━━━━━━━━━━━━━━━━━━\n_आपकी जमा फीस की पीडीएफ (PDF) रसीद नीचे संलग्न है।_\nधन्यवाद! - JRD Management`;
                    }

                    await sock.sendMessage(jid, { text: textToSend });
                    await new Promise(res => setTimeout(res, 1500));
                    await sendFeePdfReceipt(jid, item);
                    await new Promise(res => setTimeout(res, 1500));
                    await sendFeeVoiceNote(jid, item);
                }

                messageQueue.shift();
            } else {
                await new Promise(res => setTimeout(res, 2000));
                break;
            }

            await new Promise(res => setTimeout(res, 2500));

        } catch (err) {
            console.error(`❌ ऑटो संदेश भेजने में त्रुटि (${item.number}):`, err.message);
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
        name: body.name || body.student_name || body.studentName || '',
        studentName: body.studentName || body.name || '',
        className: body.className || body.class || '',
        session: body.session || '2026-27',
        rid: body.rid || body.receipt_no || '',
        paid: body.paid || body.amount || 0,
        totalAmount: body.totalAmount || 0,
        voiceText: body.voiceText || '',
        upiLink: body.upiLink || '',
        qrUrl: body.qrUrl || '',
        details: body.details || ''
    });

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

app.get('/qr', (req, res) => {
    if (isBotReady) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px; color:green;">✅ JRD VIP ERP बोट व्हाट्सएप से कनेक्टेड है!</h2>');
    }
    if (!currentQrCode) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">QR Code तैयार हो रहा है... कृपया 3 सेकंड बाद Refresh करें।</h2>');
    }
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQrCode)}`;
    res.send(`
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
            <h2>🏫 JRD Public School VIP ERP Bot</h2>
            <p>अपने व्हाट्सएप से इस QR कोड को स्कैन करें:</p>
            <img src="${qrImageUrl}" alt="WhatsApp QR Code" style="border: 2px solid #333; padding: 10px; border-radius: 10px; width: 300px; height: 300px;"/>
            <br>
            <p><a href="/reset-qr" style="color:red; font-weight:bold;">🔄 नया QR Code बनाएँ (Force Reset)</a></p>
        </div>
    `);
});

app.get('/reset-qr', (req, res) => {
    forceClearAuthFolder();
    isBotReady = false;
    isConnecting = false;
    currentQrCode = '';
    setTimeout(() => startBot(), 1000);
    res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">🧹 पुराना सेशन साफ़ कर दिया गया है! 3 सेकंड बाद <a href="/qr">/qr पेज खोलें</a>।</h2>');
});

app.get('/clear-lid-cache', (req, res) => {
    try {
        if (fs.existsSync(LID_MAP_FILE)) {
            fs.unlinkSync(LID_MAP_FILE);
            lidPhoneMap = {};
            return res.send('✅ LID cache cleared. Purani galat mappings hat gayi.');
        }
        res.send('ℹ️ Cache file already khali/absent hai.');
    } catch (e) {
        res.status(500).send('❌ Error: ' + e.message);
    }
});

app.get('/', (req, res) => {
    res.send(`JRD WhatsApp Bot Status: ${isBotReady ? 'Connected ✅' : 'Waiting for QR scan ⏳'}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`JRD VIP ERP Bot running on port ${PORT}`));
startBot();

setInterval(() => {
    https.get('https://jrd-whatsapp-bot-production.up.railway.app/', (res) => {
        console.log('⚡ Self-Ping successful');
    }).on('error', (err) => {
        console.error('❌ Self-Ping error:', err.message);
    });
}, 4 * 60 * 1000);

app.post('/send-attendance', async (req, res) => {
    const body = req.body || {};
    const targetPhone = body.number || body.phone || body.mobile;
    const name = body.name || 'शिक्षक';
    const status = body.status || 'PRESENT';
    const className = body.class || '';
    const type = body.type || 'STUDENT_ATTENDANCE';
    const attType = (body.attendance_type || body.att_type || 'IN').toString().toUpperCase().trim();

    if (!targetPhone) {
        return res.status(400).json({ status: 'error', message: 'Missing phone number' });
    }

    let rawTime = String(body.time || body.in_time || body.out_time || '').trim();
    let cleanTime = '';

    if (rawTime.includes('1899') || rawTime.includes('GMT') || rawTime.includes('T') || rawTime === '' || rawTime === '--') {
        cleanTime = new Date().toLocaleTimeString('en-US', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } else {
        cleanTime = rawTime;
    }

    let todayStr = new Date().toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    const dayOfMonth = new Date().getDate();

    const inQuotes = {
        1: "एक नए महीने की शुरुआत! आइए, नए संकल्पों के साथ बच्चों के भविष्य को उज्ज्वल बनाएं।",
        2: "शिक्षक वह दीप है जो स्वयं जलकर दूसरों के जीवन को आलोकित करता है। आपका स्वागत है!",
        3: "आप केवल विषय नहीं पढ़ाते, आप देश के भावी नागरिकों का निर्माण करते हैं। शुभ प्रभात!",
        4: "ज्ञान बांटना ही संसार का सबसे महान कार्य है। आपकी मेहनत से कई सपने साकार हो रहे हैं!",
        5: "सफल शिक्षक वह है जो बच्चों में सीखने की जिज्ञासा जगाए। आइए, आज कुछ नया सिखाएं!",
        6: "आपकी एक मुस्कान और मार्गदर्शन से किसी बच्चे का पूरा दिन बदल सकता है। शुभ प्रभात!",
        7: "शिक्षा की जड़े कड़वी होती हैं, पर उसका फल बहुत मीठा होता है। आपकी लगन को नमन!",
        8: "उत्कृष्टता कोई कार्य नहीं, बल्कि एक आदत है। आज फिर एक नई ऊर्जा के साथ शुरुआत करें!",
        9: "सकारात्मक सोच और निष्ठा से किया गया अध्यापन हमेशा अमर रहता है। आपका दिन शुभ हो!",
        10: "बच्चों के मन में ज्ञान का बीज बोना ही शिक्षक का असली सौभाग्य है। कर्मभूमि में स्वागत है!",
        11: "धैर्य और लगन ही एक महान शिक्षक की पहचान है। आपकी उपस्थिति हमारे लिए गर्व की बात है!",
        12: "सच्चा शिक्षक वह है जो बच्चे को उसके भीतर की क्षमता का अहसास कराए। शुभ प्रभात!",
        13: "शिक्षा ही वह सबसे शक्तिशाली हथियार है जिससे दुनिया को बदला जा सकता है। जय हिंद!",
        14: "ज्ञान का दान ही सबसे बड़ा दान है। आज पूरी निष्ठा से अपने दायित्व का निर्वहन करें!",
        15: "महीने का मध्य! अपनी उसी अटूट ऊर्जा और उत्साह के साथ बच्चों का मार्गदर्शन करते रहें।",
        16: "शिक्षकों के मार्गदर्शन के बिना सफलता का कोई भी मुकाम हासिल नहीं किया जा सकता।",
        17: "आपकी मेहनत हर दिन एक नए भारत की नींव रख रही है। आपका आज का दिन मंगलमय हो!",
        18: "शिक्षा केवल अक्षर ज्ञान नहीं, बल्कि चरित्र का निर्माण है। शुभ प्रभात!",
        19: "अनुशासन और प्रेम का संतुलन ही एक आदर्श शिक्षक का आभूषण है। आपका स्वागत है!",
        20: "आपकी दी गई सीख बच्चों के जीवन भर काम आएगी। पूरे उत्साह के साथ कार्य प्रारंभ करें!",
        21: "विद्या ही परम धन है और आप उस धन के संरक्षक हैं। आपका दिन ऊर्जा से भरपूर रहे!",
        22: "एक अच्छा शिक्षक एक प्रकाशस्तंभ की तरह है जो भटकते हुए जहाजों को राह दिखाता है।",
        23: "महान कार्य करने का एक ही तरीका है कि आप अपने काम से प्यार करें। शुभ प्रभात!",
        24: "ज्ञान की ज्योति कभी बुझती नहीं। आपकी लगन से बच्चों का जीवन हमेशा जगमगाएगा।",
        25: "बच्चों के सपनों को पंख देने के इस पावन कार्य में आपका पुनः हार्दिक स्वागत है!",
        26: "हर बच्चा एक खास प्रतिभा लेकर आता है, उसे पहचानने का हुनर आपके पास है।",
        27: "सफलता का कोई संक्षिप्त रास्ता नहीं होता, आपकी निरंतर मेहनत ही इसका प्रमाण है!",
        28: "शिक्षक वह सीढ़ी है जो खुद वहीं रहती है, पर दूसरों को ऊंचाइयों पर पहुंचा देती है।",
        29: "आपकी निष्ठा और समर्पण ही इस विद्यालय की असली ताकत है। शुभ प्रभात!",
        30: "सिखाने की कला ही एक शिक्षक को महान बनाती है। आज फिर कुछ नया रचें!",
        31: "महीने का अंतिम दिन! आपके अथक प्रयासों से इस महीने कई नए अध्याय लिखे गए हैं।"
    };

    const outQuotes = {
        1: "महीने के पहले दिन आपकी उत्कृष्ट सेवा और मेहनत के लिए धन्यवाद। विश्राम करें और कल पुनः मिलें!",
        2: "आज दिन भर बच्चों के भविष्य को संवारने में दिए गए योगदान के लिए आभार। आपकी शाम सुखद रहे!",
        3: "दिन भर की निष्ठापूर्ण अध्यापन सेवा के लिए विद्यालय परिवार आपका धन्यवाद करता है। शुभ संध्या!",
        4: "राष्ट्र निर्माण के इस पावन कार्य में आज की आपकी लगन अत्यंत सराहनीय रही। धन्यवाद!",
        5: "एक और सफल कार्य दिवस पूर्ण हुआ! आपके अमूल्य प्रयासों और मार्गदर्शन के लिए हार्दिक धन्यवाद।",
        6: "आज की आपकी मेहनत से कई बच्चों का जीवन समृद्ध हुआ है। विश्राम करें, शुभ संध्या!",
        7: "दिन भर की थकान के बाद अब शांतिपूर्ण विश्राम करें। आपके अमूल्य योगदान का आभार!",
        8: "आपकी निरंतर निष्ठा ही विद्यालय की प्रगति का आधार है। आज के समर्पण के लिए धन्यवाद!",
        9: "आज का कार्य दिवस सफलतापूर्वक संपन्न हुआ। आपकी लगन को JRD परिवार का नमन!",
        10: "बच्चों के उज्ज्वल भविष्य की नींव रखने के लिए धन्यवाद। आपकी शाम आनंदमय रहे!",
        11: "आज दिए गए ज्ञान और संस्कारों के लिए विद्यालय प्रबंधन आपका आभार व्यक्त करता है।",
        12: "मेहनत रंग लाती है! आज के आपके सराहनीय प्रयासों के लिए हार्दिक धन्यवाद। शुभ संध्या!",
        13: "दिन भर के उत्कृष्ट अध्यापन के लिए धन्यवाद। विश्राम करें और कल पुनः नई ऊर्जा से मिलें!",
        14: "ज्ञान के इस पावन यज्ञ में आज की आपकी आहुति के लिए धन्यवाद। आपका समय सुखद हो!",
        15: "मध्य महीने तक आपकी अटूट सेवा के लिए आभार! विश्राम करें और कल पुनः मिलें।",
        16: "आज का दिन बहुत ही फलदायी रहा। आपकी निरंतर मेहनत के लिए हार्दिक धन्यवाद!",
        17: "बच्चों को दिए गए आपके अनमोल समय और ज्ञान के लिए विद्यालय परिवार आभारी है।",
        18: "आज का कार्य दिवस पूर्ण हुआ। आपकी लगन और निष्ठा के लिए कोटि-कोटि धन्यवाद!",
        19: "शिक्षकों के समर्पण से ही विद्यालय का नाम रोशन होता है। आज के योगदान के लिए आभार!",
        20: "आपकी आज की मेहनत से बच्चों ने कुछ नया सीखा है। शुभ संध्या व शांतिपूर्ण रात्रि!",
        21: "दिन भर की उत्कृष्ट सेवा के लिए JRD परिवार आपका आभार व्यक्त करता है। विश्राम करें!",
        22: "शिक्षा के प्रति आपकी सच्ची निष्ठा को नमन! आज का कार्य दिवस सफलतापूर्वक पूर्ण हुआ।",
        23: "बच्चों के सर्वांगीण विकास में आज दिए गए आपके योगदान के लिए हार्दिक धन्यवाद!",
        24: "एक और प्रेरक दिन संपन्न हुआ! आपकी अटूट मेहनत के लिए धन्यवाद, शुभ संध्या!",
        25: "ज्ञान बांटने का आज का आपका सफर बहुत ही सराहनीय रहा। विश्राम करें!",
        26: "आपकी उपस्थिति और मार्गदर्शन ही बच्चों की असली ताकत है। आज के लिए धन्यवाद!",
        27: "दिन भर की थकान के बाद अब अपने परिवार के साथ सुखद समय बिताएं। आभार!",
        28: "आपकी निष्ठा से विद्यालय नित नई ऊंचाइयों को छू रहा है। आज की सेवा के लिए धन्यवाद!",
        29: "सफल कार्य दिवस की बधाई! आपके अमूल्य प्रयासों के लिए विद्यालय परिवार आभारी है।",
        30: "आज के समर्पित अध्यापन कार्य के लिए धन्यवाद। आपकी शाम सुखद और शांतिपूर्ण रहे!",
        31: "पूरे महीने आपकी अथक मेहनत और समर्पित सेवा के लिए JRD परिवार आपका हार्दिक आभार व्यक्त करता है!"
    };

    const todayInQuote = inQuotes[dayOfMonth] || inQuotes[1];
    const todayOutQuote = outQuotes[dayOfMonth] || outQuotes[1];

    try {
        if (!sock || !isBotReady) {
            return res.status(503).json({ status: 'error', message: 'WhatsApp Bot not ready' });
        }

        let formattedNumber = targetPhone.toString().replace(/[^0-9]/g, '');
        if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
        const jid = formattedNumber + '@s.whatsapp.net';

        let messageText = "";

        if (type === 'TEACHER_ATTENDANCE') {
            if (attType === 'OUT') {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n🚩 *शिक्षक प्रस्थान (OUT-TIME)*\n\nआदरणीय *${name}* जी,\n\n🕒 *प्रस्थान समय:* ${cleanTime}\n🏁 *स्थिति:* कार्य दिवस पूर्ण ✅\n\n🌺 *आज का आभार संदेश:*\n_"${todayOutQuote}"_\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
            } else {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n📋 *शिक्षक उपस्थिति (IN-TIME)*\n\nआदरणीय *${name}* जी,\nविद्यालय में आपका हार्दिक स्वागत है!\n\n🕒 *आगमन समय:* ${cleanTime}\n✅ *स्थिति:* PRESENT (उपस्थित)\n\n💭 *आज का प्रेरणादायी विचार:*\n_"${todayInQuote}"_\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
            }
        } else {
            const isAbsent = status.toLowerCase() === 'absent' || status.toLowerCase() === 'a' || status === 'अनुपस्थित';
            if (isAbsent) {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n⚠️ *उपस्थिति सूचना (ABSENT)*\n\nप्रिय अभिभावक,\nआपका बच्चा *${name}* (कक्षा: ${className}) आज विद्यालय में **अनुपस्थित (ABSENT)** है।\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
            } else {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n✅ *उपस्थिति सूचना (PRESENT)*\n\nप्रिय अभिभावक,\nआपका बच्चा *${name}* (कक्षा: ${className}) आज विद्यालय में **उपस्थित (PRESENT)** है।\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
            }
        }

        const sent = await sock.sendMessage(jid, { text: messageText });
        if (sent?.key?.id) messageCache.set(sent.key.id, { conversation: messageText });

        if (updateAttendanceSmsStatus && body.attendance_id) {
            updateAttendanceSmsStatus(body.attendance_id, 'SENT');
        }

        return res.status(200).json({ status: 'success', message: 'Attendance message sent successfully' });
    } catch (error) {
        console.error('❌ Attendance sending error:', error.message);
        return res.status(500).json({ status: 'error', message: error.toString() });
    }
});
