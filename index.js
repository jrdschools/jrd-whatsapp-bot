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
const gTTS = require('gtts');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1CPviWaISRLeTB6wgSPKSjep78v7a48cHjs5-n9q4sPGUM_jqlWA2aUd2qbhUXKBC/exec";

// 📇 LID (WhatsApp की नई Privacy ID) → असली मोबाइल नंबर की स्थायी मैपिंग
// जानबूझकर auth_info_baileys से अलग रखी है ताकि QR रीसेट/नए सेशन के बाद भी सीखी हुई मैपिंग बनी रहे
const LID_MAP_FILE = path.join(__dirname, 'lid_phone_map.json');
let lidPhoneMap = {};

function loadLidPhoneMap() {
    try {
        if (fs.existsSync(LID_MAP_FILE)) {
            lidPhoneMap = JSON.parse(fs.readFileSync(LID_MAP_FILE, 'utf8')) || {};
            console.log(`📇 LID मैपिंग कैश लोड हुआ (${Object.keys(lidPhoneMap).length} एंट्री)`);
        }
    } catch (e) {
        console.error('❌ LID मैपिंग कैश लोड करने में त्रुटि:', e.message);
        lidPhoneMap = {};
    }
}

function saveLidPhoneMapping(lidJid, phone) {
    try {
        if (!lidJid || !phone || lidPhoneMap[lidJid] === phone) return;
        lidPhoneMap[lidJid] = phone;
        fs.writeFileSync(LID_MAP_FILE, JSON.stringify(lidPhoneMap, null, 2));
        console.log(`📇 नई LID मैपिंग याद रखी: ${lidJid} → ${phone}`);
    } catch (e) {
        console.error('❌ LID मैपिंग सेव करने में त्रुटि:', e.message);
    }
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
            console.log('🧹 Auth Folder पूरी तरह से साफ़ कर दिया गया!');
        }
    } catch (e) {
        console.error('❌ Error clearing Auth Folder:', e.message);
    }
}

// किसी एक JID स्ट्रिंग से शुद्ध 10 अंकों का भारतीय मोबाइल नंबर निकालना।
// ⚠️ यह सिर्फ असली Phone-Number JID पर काम करता है — @lid (WhatsApp की internal privacy ID) को
//    हमेशा null करके लौटाता है, कभी भी उसके अंकों से "नंबर जैसा दिखने वाला" कुछ नहीं बनाता।
//    यही वह जगह थी जहाँ पुराना फॉलबैक गलती करता था और गलत नंबर गूगल शीट को भेज देता था।
function pnJidToIndianMobile(candidate) {
    if (!candidate || typeof candidate !== 'string') return null;
    if (candidate.includes('@lid')) return null;

    let digits = candidate.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    // 91 से शुरू होने वाला 12 डिजिट नंबर (उदा: 919792649799)
    if (digits.length === 12 && digits.startsWith('91')) {
        const p = digits.substring(2);
        if (/^[6-9]\d{9}$/.test(p)) return p;
    }

    // सीधे 10 डिजिट का भारतीय मोबाइल नंबर
    if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return digits;

    // छोटी-मोटी गड़बड़ी (एक्स्ट्रा चिन्ह वगैरह) झेलने के लिए — पर सिर्फ छोटी/PN-जैसी लंबाई की स्ट्रिंग पर,
    // ताकि यह किसी लंबे LID नंबर के अंदर से गलती से 10 अंक न उठा ले
    if (digits.length > 0 && digits.length <= 13) {
        const match = digits.match(/[6-9]\d{9}/);
        if (match && match[0]) return match[0];
    }
    return null;
}

// 🎯 गार्जियन का असली 10-डिजिट मोबाइल नंबर निकालने वाला फ़ंक्शन — अब 3 लेयर में, LID-सेफ
// ⚠️ ASYNC है क्योंकि ज़रूरत पड़ने पर Baileys के internal LID मैप को भी चेक करता है।
// सबसे ज़रूरी बदलाव: अगर कहीं से भी पक्का असली नंबर नहीं मिलता, तो यह null लौटाता है —
// पुराने कोड की तरह अंदाज़े से (LID के अंकों से) कोई गलत नंबर कभी नहीं बनाता।
async function extractGuardianPhone(jid, msg) {
    try {
        const directCandidates = [];

        // 1. WhatsApp के नए Baileys अपडेट में असली Phone JID (PN) यहाँ मिलता है
        if (msg?.key?.remoteJidAlt) directCandidates.push(msg.key.remoteJidAlt);
        if (msg?.key?.participantAlt) directCandidates.push(msg.key.participantAlt);

        // 2. संदेश के मैसेज पेलोड में
        if (msg?.key?.participant) directCandidates.push(msg.key.participant);
        if (msg?.key?.remoteJid) directCandidates.push(msg.key.remoteJid);
        if (jid) directCandidates.push(jid);

        // 3. Extended Context Info
        const ctx = msg?.message?.extendedTextMessage?.contextInfo;
        if (ctx?.participant) directCandidates.push(ctx.participant);

        // इनमें से जो भी @lid फॉर्मेट में हैं, उन्हें अलग निकाल लो (लेयर 2/3 और सीखने के लिए काम आएँगे)
        const lidCandidates = [...new Set(directCandidates.filter(c => typeof c === 'string' && c.includes('@lid')))];

        // 🥇 लेयर 1 — सीधे candidates में से असली PN ढूँढो (सबसे भरोसेमंद, ज़्यादातर मामलों में यहीं मिल जाएगा)
        for (const candidate of directCandidates) {
            const phone = pnJidToIndianMobile(candidate);
            if (phone) {
                // अगर असली remoteJid/participant @lid फॉर्मेट में था, तो यह सीखा हुआ जोड़ा याद रख लो
                lidCandidates.forEach(lidJid => saveLidPhoneMapping(lidJid, phone));
                return phone;
            }
        }

        // 🥈 लेयर 2 — Baileys के अपने internal LID↔PN स्टोर में देखो (उपलब्ध हो तभी, इसलिए सब कुछ ऑप्शनल-चेन्ड है)
        for (const lidJid of lidCandidates) {
            try {
                const resolved = await sock?.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
                const phone = pnJidToIndianMobile(resolved);
                if (phone) {
                    saveLidPhoneMapping(lidJid, phone);
                    return phone;
                }
            } catch (e) { /* सिर्फ best-effort — चुपचाप आगे बढ़ो */ }
        }

        // 🥉 लेयर 3 — अपने खुद के सेव किए हुए कैश में देखो (इसी गार्जियन के LID से पहले कभी नंबर मैच हुआ हो तो)
        for (const lidJid of lidCandidates) {
            if (lidPhoneMap[lidJid]) return lidPhoneMap[lidJid];
        }

        // ❌ कहीं से भी पक्का असली नंबर नहीं मिला। पुराने कोड जैसा अंदाज़ा लगाकर गलत नंबर मत बनाओ —
        // साफ़-साफ़ null लौटाओ ताकि आगे का लॉजिक गलत नंबर गूगल शीट को भेजने के बजाय ईमानदारी से संभाले।
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

            // 🎯 शुद्ध 10-अंकों का गार्जियन मोबाइल नंबर
            const senderPhone = await extractGuardianPhone(jid, msg);
            const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const lowerText = rawText.toLowerCase();

            console.log(`📱 मैसेज आया | निष्पादित गार्जियन नंबर: [${senderPhone}] | टेक्स्ट: "${rawText}"`);

            // 🆕 अगर WhatsApp की नई Privacy (LID) सिस्टम की वजह से नंबर बिल्कुल नहीं मिला,
            // तो गार्जियन से एक बार उसका पंजीकृत मोबाइल नंबर माँग लो और उसे स्थायी रूप से याद रख लो।
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

            // 🎯 मेन्यू ऑप्शन
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

            // 🎯 नाम, Enrolment, Scholar या Roll नंबर से सर्च
            const searchQuery = rawText.replace(/#/g, '').trim();

            try {
                const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(searchQuery || 'CHECK_USER')}`;
                const response = await axios.get(apiUrl, { timeout: 12000 });
                const resData = response.data || {};

                // यदि गार्जियन का नंबर डेटाबेस में पंजीकृत नहीं है
                if (resData.status === 'unregistered_number') {
                    if (isGreeting || isOptionNum || !rawText.includes('#')) {
                        await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई (वाराणसी)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 हमारे विद्यालय की डिजिटल हेल्पलाइन में आपका स्वागत है!\n\nसत्र 2026-27 हेतु नए प्रवेश प्रारंभ हैं।\nअधिक जानकारी या संपर्क के लिए विकल्प भेजें:\n1️⃣ एडमिशन जानकारी\n2️⃣ स्कूल टाइमिंग\n3️⃣ प्रबंधक संदेश\n4️⃣ लोकेशन\n\n_नोट: आपका मोबाइल नंबर (${senderPhone}) छात्र डेटाबेस में पंजीकृत नहीं है।_`);
                    } else {
                        await sendReply(jid, `🛑 *अनधिकृत पहुँच (Access Denied)*\n\nआपका मोबाइल नंबर (*${senderPhone}*) विद्यालय के आधिकारिक डेटाबेस में पंजीकृत नहीं है।\n\nसुरक्षा कारणों से छात्र विवरण केवल पंजीकृत अभिभावक को ही दिखाया जाता है।`);
                    }
                    return;
                }

                // यदि ग्रीटिंग (Hi/Hello/Menu) भेजा है
                if (isGreeting) {
                    const menuText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *अभिभावक डिजिटल सेवा केंद्र*\n\nसूचना प्राप्त करने के लिए संबंधित **नंबर** भेजें:\n\n1️⃣ *नया एडमिशन (सत्र 2026-27)*\n2️⃣ *स्कूल टाइमिंग एवं शेड्यूल*\n3️⃣ *प्रबंधकीय एवं संस्थापक संदेश*\n4️⃣ *विद्यालय का पता व लोकेशन*\n\n🔎 *अपने बच्चे की फीस / प्रोफाइल देखने के लिए:*\nबच्चे का **नाम** या **Enrolment No.** लिखकर भेजें (उदा: *#Aditya* या *1024*)\n\n_आपका नंबर पंजीकृत है ✅_`;
                    await sendReply(jid, menuText);
                    return;
                }

                // यदि छात्र ढूँढा जा रहा है (नाम या Enrolment नो से)
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

// 🎨 VIP स्टूडेंट प्रोफाइल कार्ड फ़ंक्शन
async function sendStudentProfileCard(jid, s) {
    const replyMsg = `🎓 *STUDENT OFFICIAL PROFILE*\n🏫 *JRD Public School, Marui*\n📅 *सत्र (Session):* ${s.session || '2026-27'}\n━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Enrolment No:* \`${s.enrolment || 'N/A'}\` \n📜 *Scholar/Reg No:* ${s.scholar_no || 'N/A'}\n🔢 *Roll No:* ${s.roll_no || 'N/A'}\n\n👤 *छात्र का नाम:* *${s.name}*\n👨‍👦 *पिता का नाम:* ${s.father}\n👩‍👦 *माता का नाम:* ${s.mother}\n🏫 *कक्षा:* ${s.class} (${s.type || 'REGULAR'})\n\n💰 *कुल जमा शुल्क (Paid):* ₹${s.total_paid || 0}\n\n📊 *भुगतान/जमा विवरण:*\n${s.paid_list || 'कोई जमा फीस दर्ज नहीं है'}\n\n⚠️ *बकाया शुल्क विवरण:*\n${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n🧾 *बहीखाता कुल बकाया ब्रेकडाउन (DUE SUMMARY):*\n• *चालू सत्र बकाया (${s.session || '2026-27'}):* ₹${s.current_due || 0}\n• *पिछला बकाया (Old Due):* ₹${s.old_due || 0}\n---------------------------------------\n🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${s.grand_due || 0}*\n━━━━━━━━━━━━━━━━━━━━━━━\n_यदि फ़ीस अथवा विवरण में कोई त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);
}

// 📄 BRANDED VIP PDF रसीद जनरेटर फ़ंक्शन
async function sendFeePdfReceipt(jid, data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A5', margin: 20 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);
                if (sock && isBotReady) {
                    const captionText = `🏫 *J.R.D. PUBLIC SCHOOL*\n🧾 छात्र *${data.name || ''}* की आधिकारिक डिजिटल फीस जमा रसीद।`;
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

            // बॉर्डर
            doc.rect(10, 10, doc.page.width - 20, doc.page.height - 20).lineWidth(1.5).stroke('#1A365D');
            doc.rect(13, 13, doc.page.width - 26, doc.page.height - 26).lineWidth(0.5).stroke('#1A365D');

            // हेडर
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
            doc.font('Helvetica').text(`${data.rid || 'N/A'}`, 95, metaTop + 10);

            doc.font('Helvetica-Bold').text(`Student Name: `, 30, metaTop + 28);
            doc.font('Helvetica').text(`${data.name || 'N/A'}`, 105, metaTop + 28);

            doc.font('Helvetica-Bold').text(`Class & Sec  : `, 30, metaTop + 46);
            doc.font('Helvetica').text(`${data.className || 'N/A'}`, 105, metaTop + 46);

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

// 🎙️ हिंदी में असली (महिला आवाज़) वॉइस नोट जनरेट करना — Google TTS (free) + ffmpeg से ogg/opus में कन्वर्ट
async function generateHindiVoiceNote(text) {
    const stamp = Date.now() + '_' + Math.floor(Math.random() * 100000);
    const mp3Path = path.join(os.tmpdir(), `voice_${stamp}.mp3`);
    const oggPath = path.join(os.tmpdir(), `voice_${stamp}.ogg`);

    return new Promise((resolve, reject) => {
        const speech = new gTTS(text, 'hi'); // 'hi' = हिंदी, डिफ़ॉल्ट रूप से महिला आवाज़
        speech.save(mp3Path, (err) => {
            if (err) return reject(err);

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
                        reject(readErr);
                    }
                })
                .on('error', (ffErr) => {
                    try { fs.unlinkSync(mp3Path); } catch (e) {}
                    reject(ffErr);
                })
                .save(oggPath);
        });
    });
}

// 🔊 फीस जमा होने पर गार्जियन को हिंदी वॉइस नोट भेजना
async function sendFeeVoiceNote(jid, data) {
    try {
        const spokenText = `नमस्ते! ${data.name || 'छात्र'} की फीस ${data.paid || 0} रुपये सफलतापूर्वक जमा हो गई है। धन्यवाद। जे आर डी पब्लिक स्कूल, मरुई, वाराणसी।`;
        const audioBuffer = await generateHindiVoiceNote(spokenText);

        if (sock && isBotReady) {
            await sock.sendMessage(jid, {
                audio: audioBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true // true = वॉइस नोट जैसा दिखेगा (waveform के साथ), न कि साधारण ऑडियो फ़ाइल
            });
        }
    } catch (err) {
        console.error('❌ वॉइस नोट भेजने में त्रुटि:', err.message);
    }
}

// 🛡️ ANTI-BAN SAFE MESSAGE QUEUE ENGINE WITH DUAL RECEIPT (TEXT + PDF)
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
                    textToSend = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n🧾 *आधिकारिक फीस जमा रसीद*\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *छात्र का नाम:* ${item.name || 'N/A'}\n🏫 *कक्षा:* ${item.className || 'N/A'}\n📅 *सत्र:* ${item.session || '2026-27'}\n🆔 *रसीद संख्या:* ${item.rid || 'N/A'}\n💰 *कुल जमा राशि:* ₹${item.paid || 0}/-\n\n📊 *मदवार विवरण / Breakdown:*\n${cleanDet}\n━━━━━━━━━━━━━━━━━━━━━━━\n_आपकी जमा फीस की पीडीएफ (PDF) रसीद नीचे संलग्न है।_\nधन्यवाद! - JRD Management`;
                }

                // 1. सुंदर टेक्स्ट मैसेज भेजना
                const sent = await sock.sendMessage(jid, { text: textToSend });
                if (sent?.key?.id) messageCache.set(sent.key.id, { conversation: textToSend });

                // 2. ऑटोमैटिक PDF रसीद जनरेट करके भेजना
                await new Promise(res => setTimeout(res, 1500));
                await sendFeePdfReceipt(jid, item);

                // 3. हिंदी में वॉइस नोट भेजना (फीस कन्फर्मेशन बोलकर सुनाना)
                await new Promise(res => setTimeout(res, 1500));
                await sendFeeVoiceNote(jid, item);

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

// 📩 ऐप्स स्क्रिप्ट से आने वाले फीस / बल्क मैसेज कतार में जोड़ना
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

    processQueue();

    return res.status(200).json({ status: 'queued', queue_length: messageQueue.length });
});

// 📩 डायरेक्ट मैसेज सेंड API
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

// 🌐 QR कोड और वेब रूट्स
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

// 🧹 पुरानी/ग़लत LID→Phone कैश एंट्रीज़ को हटाने के लिए (ज़रूरत पड़ने पर एक बार उपयोग करें, फिर हटा दें)
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

// ⚡ 4 मिनट में रेलवे सर्वर को अलाइव रखने वाला सेल्फ-पिंग
setInterval(() => {
    https.get('https://jrd-whatsapp-bot-production.up.railway.app/', (res) => {
        console.log('⚡ Self-Ping successful');
    }).on('error', (err) => {
        console.error('❌ Self-Ping error:', err.message);
    });
}, 4 * 60 * 1000);
