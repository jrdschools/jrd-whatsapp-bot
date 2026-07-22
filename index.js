const { updateAttendanceSmsStatus, testDbConnection } = require('./db');

// बोट स्टार्ट होते ही DB कनेक्शन टेस्ट करें
testDbConnection();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1CPviWaISRLeTB6wgSPKSjep78v7a48cHjs5-n9q4sPGUM_jqlWA2aUd2qbhUXKBC/exec";

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "JRD_BOT_SESSION" }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/render/project/src/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => {
    console.log('\n=============================================');
    console.log(' JRD Enterprise VIP Bot Active & Secured! ');
    console.log('=============================================\n');
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

            await client.sendMessage(formattedNumber + '@c.us', item.message);
            console.log(`✅ [${item.type}] मैसेज भेजा गया -> ${formattedNumber}`);
            processedCount++;

            // ⏱️ रैंडम डिले: 4 से 8 सेकंड के बीच (ताकि व्हाट्सएप स्पैम न समझे)
            const randomDelay = Math.floor(Math.random() * 4000) + 4000;
            await new Promise(res => setTimeout(res, randomDelay));

            // 🛑 हर 20 मैसेज के बाद 15 सेकंड का लंबा पॉज (Break)
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

// 📩 ऐप्स स्क्रिप्ट से आने वाले बल्क/ऑटो मैसेज क्यू में जोड़ना
app.post('/enqueue-message', (req, res) => {
    const { number, message, type } = req.body;
    if (!number || !message) return res.status(400).json({ status: 'error', message: 'Missing fields' });

    messageQueue.push({ number, message, type: type || 'GENERAL' });
    console.log(`📥 नया मैसेज क्यू में जुड़ा -> ${number} (कुल कतार: ${messageQueue.length})`);

    processQueue();

    return res.status(200).json({ status: 'queued', queue_length: messageQueue.length });
});

client.on('message', async (msg) => {
    try {
        const chat = await msg.getChat();
        await chat.sendSeen();
    } catch (e) {}

    // 🎯 शुद्ध 10-अंकों का नंबर एक्सट्रैक्टर
    let senderPhone = "";
    try {
        const contact = await msg.getContact();
        if (contact && contact.number) {
            senderPhone = contact.number.toString().replace(/[^0-9]/g, '');
        } 
        if (!senderPhone || senderPhone.length > 12 || (contact.id && contact.id._serialized && contact.id._serialized.includes('@lid'))) {
            const formatted = await contact.getFormattedNumber();
            if (formatted) {
                senderPhone = formatted.replace(/[^0-9]/g, '');
            }
        }
    } catch (err) {
        console.error("Contact resolve error:", err.message);
    }

    if (!senderPhone || senderPhone.length < 10) {
        let rawSender = msg.author || msg.from || "";
        senderPhone = rawSender.replace(/[^0-9]/g, '');
    }

    if (senderPhone.length >= 10) {
        senderPhone = senderPhone.slice(-10);
    }

    console.log(`📱 मैसेज प्राप्त हुआ | शुद्ध 10-अंकों का नंबर : [${senderPhone}] | टेक्स्ट : "${msg.body}"`);

    const text = msg.body.trim();
    const lowerText = text.toLowerCase();

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
        await msg.reply(menuText);
        return;
    } 

    if (lowerText === '1') {
        await msg.reply(`📝 *प्रवेश प्रारंभ (सत्र 2026-27)*\n🏫 *JRD Public School, मरुई, वाराणसी*\n━━━━━━━━━━━━━━━━━━━━━━━\n• संस्कारयुक्त एवं उच्च स्तरीय शिक्षा\n• आधुनिक कंप्यूटर लैब व योग्य शिक्षक\n\n📞 *प्रवेश हेतु विद्यालय कार्यालय में संपर्क करें।*`);
        return;
    } 
    if (lowerText === '2') {
        await msg.reply(`⏰ *स्कूल समय एवं नियम*\n🏫 *JRD Public School*\n━━━━━━━━━━━━━━━━━━━━━━━\n⏱ *समय:* सुबह 07:30 AM से दोपहर 01:30 PM तक\n📅 *दिन:* सोमवार से शनिवार\n\n_नोट: कृपया बच्चों को पूर्ण गणवेश (Uniform) में समय से भेजें।_`);
        return;
    } 
    if (lowerText === '3') {
        await msg.reply(`👑 *प्रबंधकीय संदेश*\n🏫 *JRD Public School Management*\n━━━━━━━━━━━━━━━━━━━━━━━\n✨ *संस्थापक:* श्री बंशगोपाल वर्मा जी\n✨ *प्रबंधक:* डॉ. बंशलाल जी\n\n> *"हम प्रत्येक बच्चे के सर्वांगीण विकास एवं उज्ज्वल भविष्य के लिए पूर्णतः समर्पित हैं।"*`);
        return;
    }
    if (lowerText === '4') {
        await msg.reply(`📍 *विद्यालय लोकेशन:*
JRD Public School, ग्राम व पोस्ट - मरुई, जिला - वाराणसी (उ.प्र.)

🗺 *गूगल मैप्स पर ढूँढें:*
Google Maps पर खोजें: *JRD Public School Marui Varanasi*`);
        return;
    }

    // 💬 2. आम बातचीत (Casual Talk)
    const casualWords = ['कैसे हो', 'कैसे हैं', 'kaise ho', 'kaise hain', 'good morning', 'good afternoon', 'thanks', 'thank you', 'धन्यवाद', 'ok', 'okay', 'ठीक है', 'जय हिंद', 'राम राम', 'सुप्रभात', 'thik hai', 'kya hal hai'];
    if (casualWords.some(word => lowerText.includes(word))) {
        await msg.reply(`🙏 *JRD Public School, मरुई* में आपका स्वागत है!\n\nअपने बच्चे का फ़ीस बहीखाता देखने के लिए सीधे उसका **नाम** लिखकर भेजें। मुख्य मेन्यू के लिए **Menu** लिखें।`);
        return;
    }

    // 🔍 3. DOUBLE FILTER SEARCH ENGINE
    if (text.length >= 2) {
        try {
            const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(text)}`;
            
            const response = await axios.get(apiUrl, { timeout: 15000 });

            if (response.data && response.data.status === 'success') {
                sendStudentProfileCard(msg, response.data.data);
            } 
            else if (response.data && response.data.status === 'unregistered_number') {
                await msg.reply(`🛑 *अनधिकृत पहुँच (Access Denied)*

आपका मोबाइल नंबर (*${senderPhone}*) विद्यालय के आधिकारिक डेटाबेस में पंजीकृत नहीं है।

सुरक्षा कारणों से छात्र विवरण केवल पंजीकृत (Registered) अभिभावक के नंबर पर ही भेजा जाता है।
_यदि आपने नया नंबर लिया है, तो कृपया विद्यालय कार्यालय में संपर्क करें।_`);
            } 
            else if (response.data && (response.data.status === 'student_not_associated_with_number' || response.data.status === 'not_found')) {
                await msg.reply(`❌ *रिकॉर्ड नहीं मिला!*

छात्र का नाम *"${text}"* आपके पंजीकृत मोबाइल नंबर (*${senderPhone}*) से जुड़ा हुआ नहीं पाया गया।

कृपया सही नाम अथवा Enrolment No लिखकर भेजें।`);
            }
        } catch (error) {
            console.error('Database Search Error:', error.message);
        }
    }
});

// 🎨 VIP प्रोफाइल कार्ड फ़ंक्शन (FULL BREAKDOWN ACTIVE)
async function sendStudentProfileCard(msg, s) {
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

    await msg.reply(replyMsg);
}

// 📩 डायरेक्ट सिंगल मैसेज सेंड API
app.post('/send-whatsapp', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ status: 'error' });

    try {
        let formattedNumber = number.toString().replace(/[^0-9]/g, '');
        if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
        await client.sendMessage(formattedNumber + '@c.us', message);
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        return res.status(500).json({ status: 'error' });
    }
});

app.listen(3000, () => console.log('Secure VIP Bot running on port 3000'));
client.initialize();
