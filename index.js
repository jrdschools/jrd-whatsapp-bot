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

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

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
const HINDI_FEMALE_VOICE = "hi-IN-SwaraNeural";

// 🌺 1 से 31 तारीख के प्रातःकालीन प्रेरणादायी विचार (IN-TIME QUOTES)
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

// 🌺 1 से 31 तारीख के सायंकालीन आभार संदेश (OUT-TIME QUOTES)
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
// 📖 1 से 31 तारीख के छात्र दैनिक प्रेरक विचार
const studentQuotes = {
    1: "परिश्रम ही सफलता की असली कुंजी है।",
    2: "विद्या ददाति विनयं, विनयाद् याति पात्रताम्।",
    3: "अनुशासन ही लक्ष्य और उपलब्धि के बीच का सेतु है।",
    4: "ज्ञान वह सबसे शक्तिशाली हथियार है जिससे दुनिया बदली जा सकती है।",
    5: "समय का सही सदुपयोग ही महानता की पहली सीढ़ी है।",
    6: "सच्ची शिक्षा वही है जो इंसान को विनम्र और समझदार बनाए।",
    7: "कठिन अभ्यास ही भविष्य को सरल और उज्ज्वल बनाता है।",
    8: "अच्छी आदतें और अच्छी पुस्तकें जीवन को संवारती हैं।",
    9: "हर दिन कुछ नया सीखना ही सच्ची प्रगति है।",
    10: "सफलता कोई मंजिल नहीं, यह एक सतत अभ्यास है।",
    11: "गुरु और माता-पिता का सम्मान ही उन्नति का आधार है।",
    12: "जिज्ञासा और एकाग्रता ज्ञान प्राप्ति के दो मुख्य नेत्र हैं।",
    13: "स्वच्छ विचार और मधुर वाणी विद्यार्थी के सच्चे आभूषण हैं।",
    14: "गलतियों से सीखकर आगे बढ़ना ही बुद्धिमानी है।",
    15: "आत्मविश्वास और दृढ़ संकल्प से हर लक्ष्य संभव है।",
    16: "शिक्षा केवल परीक्षा पास करना नहीं, जीवन जीने की कला है।",
    17: "धैर्य और निरंतर प्रयास से हर बाधा पार होती है।",
    18: "सकारात्मक सोच से कठिन कार्य भी आसान हो जाता है।",
    19: "बड़ों का आशीर्वाद और कठिन मेहनत ही विजय दिलाती है।",
    20: "नियमबद्ध जीवन ही सफलता की गारंटी है।",
    21: "ज्ञान बांटने से बढ़ता है, संकोच करने से नहीं।",
    22: "सच्चा विद्यार्थी वही है जो समय की कद्र करता है।",
    23: "सदा सत्य बोलें और अपने कर्तव्यों का निष्ठा से पालन करें।",
    24: "सपनों को सच करने के लिए नींद नहीं, लगन चाहिए।",
    25: "स्वाध्याय (खुद से पढ़ना) विद्यार्थी का सर्वोत्तम मित्र है।",
    26: "सदा विनम्र रहें, विद्या फलदार वृक्ष की तरह झुकना सिखाती है।",
    27: "साहस और ईमानदारी जीवन की सबसे बड़ी पूंजी है।",
    28: "जो समय पर जागता है, वही अपनी तकदीर बनाता है।",
    29: "उत्तम संस्कार ही उत्तम चरित्र का निर्माण करते हैं।",
    30: "लक्ष्य जितना बड़ा होगा, संघर्ष और सफलता उतनी ही शानदार होगी।",
    31: "ईश्वर में विश्वास और कर्म पर निष्ठा ही विजय का मार्ग है।"
};
// ⚠️ 1 से 31 तारीख के अनुपस्थिति (ABSENT) विशेष अनुशासन एवं नियमितता विचार
const absentQuotes = {
    1: "नियमितता ही सफलता की नींव है, एक भी दिन का अभाव प्रगति को धीमा कर देता है।",
    2: "समय का एक-एक पल अनमोल है, छूटा हुआ पाठ दोबारा उसी ऊर्जा से नहीं मिलता।",
    3: "अनुशासन और दैनिक उपस्थिति से ही विद्यार्थी का भविष्य उज्ज्वल बनता है।",
    4: "ज्ञान की निरंतरता ही परीक्षा में सर्वोच्च परिणाम दिलाती है।",
    5: "कठिन परिश्रम और नियमित विद्यालय जाना ही सफलता का मूल मंत्र है।",
    6: "शिक्षा का दीप तभी जलता रहता है जब विद्यार्थी प्रतिदिन कक्षा से जुड़े।",
    7: "एक दिन का विश्राम भी अध्ययन की लय को तोड़ सकता है, सदैव नियमित रहें।",
    8: "लक्ष्य तक वही पहुंचता है जो हर परिस्थिति में अपने कर्तव्य पथ पर अडिग रहे।",
    9: "दैनिक कक्षा में उपस्थित रहना ही उत्तम संस्कारों की पहली पहचान है।",
    10: "सफलता का कोई शार्टकट नहीं होता, दैनिक अध्ययन ही विजय का मार्ग है।",
    11: "गुरु का सानिध्य और दैनिक मार्गदर्शन विद्यार्थी को महान बनाता है।",
    12: "समय का सम्मान करें, क्योंकि बीता हुआ समय कभी वापस नहीं आता।",
    13: "नियमित अभ्यास से कठिन से कठिन विषय भी सरल हो जाता है।",
    14: "प्रतिदिन कुछ नया सीखना ही जीवन में निरंतर आगे बढ़ने का रहस्य है।",
    15: "आलस्य ज्ञान का सबसे बड़ा शत्रु है, नियमित उपस्थिति से इसे परास्त करें।",
    16: "विद्या रूपी धन को पाने के लिए प्रतिदिन विद्यालय रूपी मंदिर आना आवश्यक है।",
    17: "दृढ़ संकल्प और नियमित उपस्थिति से हर बड़ी मंजिल पाई जा सकती है।",
    18: "छूटी हुई कक्षा केवल पाठ का नुकसान नहीं, बल्कि समय का भी नुकसान है।",
    19: "अपने सपनों को सच करने के लिए हर दिन पूरी लगन से कक्षा में जुड़ें।",
    20: "नियमबद्ध जीवन और नियमित अध्ययन ही विद्यार्थी का असली आभूषण है।",
    21: "प्रतिदिन का थोड़ा सा प्रयास भविष्य में विशाल सफलता का रूप लेता है।",
    22: "शिक्षा एक तपस्या है, और दैनिक उपस्थिति इस तपस्या का मुख्य नियम है।",
    23: "सच्चा विद्यार्थी वही है जो विषम परिस्थितियों में भी पढ़ाई को प्राथमिकता दे।",
    24: "आज का किया गया परिश्रम ही कल की स्वर्णिम सफलता तय करता है।",
    25: "लगातार सीखने की ललक ही आपको भीड़ से अलग और उत्कृष्ट बनाती है।",
    26: "कक्षा में बिताया हर मिनट भविष्य के निर्माण में एक ईंट की तरह जुड़ता है।",
    27: "नियमित अध्ययन से ही बुद्धि तीव्र और आत्मविश्वास मजबूत होता है।",
    28: "अनुशासन ही वह शक्ति है जो साधारण विद्यार्थी को असाधारण बनाती है।",
    29: "अपने कर्तव्यों के प्रति निष्ठा ही आपको जीवन में सर्वोच्च मुकाम दिलाएगी।",
    30: "सफलता उन्हीं को मिलती है जो हर दिन अपनी उपस्थिति दर्ज कराते हैं।",
    31: "महीने का समापन! नए संकल्प के साथ आने वाले दिनों में शत-प्रतिशत उपस्थिति का लक्ष्य रखें।"
};
// 🛡️ सुरक्षित और साफ टेक्स्ट निष्कर्षण
function safePdfText(str, fallback = 'N/A') {
    if (!str || str === 'undefined' || str === 'null') return fallback;
    let clean = String(str).replace(/[^\x20-\x7E]/g, '').trim();
    return clean.length > 0 ? clean : fallback;
}

function calculateDynamicDue(student) {
    const monthlyFee = parseFloat(student.monthly_fee || student.tuition_fee || 0);
    const studentType = String(student.type || student.student_type || 'REGULAR').toUpperCase();
    const oldDue = parseFloat(student.old_due || 0);
    const totalPaid = parseFloat(student.total_paid || student.paid || 0);

    const currentMonth = new Date().getMonth() + 1;
    let elapsedMonths = (currentMonth >= 4) ? (currentMonth - 3) : (currentMonth + 9);

    let actualMonthlyFee = (studentType === 'RTE') ? 0 : monthlyFee;
    let expectedTillMonth = actualMonthlyFee * elapsedMonths;
    let currentDue = Math.max(0, expectedTillMonth - totalPaid);
    let grandTotalDue = currentDue + oldDue;

    return { elapsedMonths, expectedTillMonth, currentDue, oldDue, grandTotalDue };
}

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
        console.error('❌ Auth Folder साफ़ करने में त्रुटि:', e.message);
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

        return null;
    } catch (e) {
        console.error('❌ extractGuardianPhone त्रुटि:', e.message);
        return null;
    }
}

async function startBot() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        console.log('⚡ JRD VIP WhatsApp Bot प्रारंभ हो रहा है...');
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
                    console.log('❌ सेशन समाप्त। नया सेशन बनाया जा रहा है...');
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
                console.log(' 🎉 JRD VIP ERP Bot Active & Ready! ');
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

            console.log(`📱 संदेश प्राप्त | नंबर: [${senderPhone || 'अज्ञात'}] | पाठ: "${rawText}"`);

            if (!senderPhone) {
                const possiblePhone = rawText.replace(/[^0-9]/g, '');

                if (possiblePhone.length === 10 && /^[6-9]\d{9}$/.test(possiblePhone)) {
                    try {
                        const verifyUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${possiblePhone}&query=CHECK_USER`;
                        const verifyRes = await axios.get(verifyUrl, { timeout: 12000 });

                        if (verifyRes.data?.status !== 'unregistered_number') {
                            saveLidPhoneMapping(jid, possiblePhone);
                            await sendReply(jid, `🙏 *नमस्ते!*\n\nआपका मोबाइल नंबर (*${possiblePhone}*) सफलतापूर्वक पंजीकृत कर लिया गया है।\n\nकृपया मुख्य मेन्यू देखने हेतु **Hi** लिखकर भेजें।`);
                        } else {
                            await sendReply(jid, `🙏 *आदरणीय अभिभावक,*\n\nयह मोबाइल नंबर (*${possiblePhone}*) विद्यालय रिकॉर्ड में पंजीकृत नहीं है।\n\nकृपया सही पंजीकृत नंबर भेजें अथवा विद्यालय कार्यालय में संपर्क करें।`);
                        }
                    } catch (e) {
                        await sendReply(jid, `⚠️ सत्यापन प्रक्रिया में त्रुटि हुई। कृपया थोड़ी देर बाद प्रयास करें।`);
                    }
                    return;
                }

                await sendReply(jid, `🙏 *नमस्ते!*\n\nJ.R.D. Public School की डिजिटल हेल्पलाइन में आपका स्वागत है।\n\nसुरक्षा कारणों से आपका नंबर स्वतः पहचाना नहीं जा सका। कृपया अपना **10 अंकों का पंजीकृत मोबाइल नंबर** यहाँ टाइप करके भेजें (उदा: 9792649799)।`);
                return;
            }

            const isGreeting = ['hi', 'hello', 'नमस्ते', 'menu', 'start', 'good morning', 'suprabhat', 'जय हिंद'].includes(lowerText);
            const isOptionNum = ['1', '2', '3', '4'].includes(lowerText);

            if (isOptionNum) {
                if (lowerText === '1') {
                    await sendReply(jid, `📝 *नया प्रवेश प्रारंभ (सत्र 2026-27)*\n🏫 *J.R.D. Public School, मरुई, वाराणसी*\n━━━━━━━━━━━━━━━━━━━━━━━\n• संस्कारयुक्त एवं उच्च स्तरीय डिजिटल शिक्षा\n• कंप्यूटर लैब एवं योग्य शिक्षक वृन्द\n\n📞 *प्रवेश हेतु विद्यालय कार्यालय में संपर्क करें।*`);
                    return;
                }
                if (lowerText === '2') {
                    await sendReply(jid, `⏰ *स्कूल समय सारणी*\n🏫 *J.R.D. Public School*\n━━━━━━━━━━━━━━━━━━━━━━━\n⏱ *समय:* प्रातः 07:30 AM से दोपहर 01:30 PM तक\n📅 *दिन:* सोमवार से शनिवार\n\n_नोट: कृपया बच्चों को समय से पूर्ण गणवेश (Uniform) में भेजें।_`);
                    return;
                }
                if (lowerText === '3') {
                    await sendReply(jid, `👑 *प्रबंधकीय संदेश*\n🏫 *J.R.D. Public School Management*\n━━━━━━━━━━━━━━━━━━━━━━━\n✨ *संस्थापक:* स्व. श्री बंशगोपाल वर्मा जी\n✨ *प्रबंधक:* डॉ. बंशलाल जी\n\n> *"हम प्रत्येक बच्चे के सर्वांगीण विकास एवं उज्ज्वल भविष्य के लिए समर्पित हैं।"*`);
                    return;
                }
                if (lowerText === '4') {
                    await sendReply(jid, `📍 *विद्यालय लोकेशन:*\nJ.R.D. Public School, ग्राम व पोस्ट - मरुई, चोलापुर, जिला - वाराणसी (उ.प्र.) - 221208\n\n🗺 *गूगल मैप्स पर ढूँढें:*\nGoogle Maps पर खोजें: *JRD Public School Marui Varanasi*`);
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
                        await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई (वाराणसी)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 डिजिटल हेल्पलाइन में आपका स्वागत है!\n\nसत्र 2026-27 हेतु नए प्रवेश प्रारंभ हैं।\nविकल्प संख्या भेजें:\n1️⃣ प्रवेश जानकारी\n2️⃣ स्कूल टाइमिंग\n3️⃣ प्रबंधक संदेश\n4️⃣ लोकेशन\n\n_नोट: आपका मोबाइल नंबर (${senderPhone}) छात्र डेटाबेस में नहीं है।_`);
                    } else {
                        await sendReply(jid, `🛑 *अनधिकृत पहुँच*\n\nआपका मोबाइल नंबर (*${senderPhone}*) आधिकारिक डेटाबेस में पंजीकृत नहीं है।`);
                    }
                    return;
                }

                if (isGreeting) {
                    const menuText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *अभिभावक डिजिटल सेवा केंद्र*\n\n1️⃣ *नया एडमिशन (2026-27)*\n2️⃣ *स्कूल टाइमिंग*\n3️⃣ *प्रबंधक संदेश*\n4️⃣ *लोकेशन*\n\n🔎 *बच्चे की फीस / प्रोफाइल देखने हेतु:*\nबच्चे का **नाम** (# के साथ) या **Enrolment No.** भेजें (उदा: *#Aditya* या *1024*)\n\n_आपका नंबर पंजीकृत है ✅_`;
                    await sendReply(jid, menuText);
                    return;
                }

                if (rawText.includes('#') || searchQuery.length >= 2) {
                    if (resData.status === 'success') {
                        await sendStudentProfileCard(jid, resData.data);
                    } else if (resData.status === 'student_not_associated_with_number' || resData.status === 'not_found') {
                        await sendReply(jid, `❌ *रिकॉर्ड नहीं मिला*\n\nछात्र विवरण *"${searchQuery}"* आपके पंजीकृत मोबाइल नंबर से जुड़ा नहीं मिला।\n\nकृपया सही नाम # के साथ (उदा: *#Aditya*) या Enrolment No भेजें।`);
                    }
                    return;
                }

                await sendReply(jid, `🙏 *JRD Public School, मरुई* में आपका स्वागत है!\n\nबच्चे की फीस या प्रोफाइल देखने के लिए उसका **नाम** (# के साथ) या **Enrolment No** भेजें (उदा: *#Aditya*)।\n\nमुख्य मेन्यू हेतु **Menu** लिखें।`);

            } catch (error) {
                console.error('Database Search Error:', error.message);
                if (isGreeting) {
                    await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n\nमुख्य मेन्यू देखने हेतु **Menu** लिखें।`);
                }
            }
        });

    } catch (err) {
        isConnecting = false;
        console.error('❌ startBot त्रुटि:', err.message);
    }
}

async function sendReply(jid, text) {
    try {
        if (sock && isBotReady) {
            const sent = await sock.sendMessage(jid, { text });
            if (sent?.key?.id) messageCache.set(sent.key.id, { conversation: text });
        }
    } catch (err) {
        console.error('❌ उत्तर भेजने में त्रुटि:', err.message);
    }
}

async function sendStudentProfileCard(jid, s) {
    const calc = calculateDynamicDue(s);
    const replyMsg = `🎓 *STUDENT OFFICIAL PROFILE*\n🏫 *JRD Public School, Marui*\n📅 *सत्र:* ${s.session || '2026-27'}\n━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Enrolment No:* \`${s.enrolment || 'N/A'}\` \n📜 *Scholar No:* ${s.scholar_no || 'N/A'}\n🔢 *Roll No:* ${s.roll_no || 'N/A'}\n\n👤 *छात्र का नाम:* *${s.name}*\n👨‍👦 *पिता का नाम:* ${s.father}\n👩‍👦 *माता का नाम:* ${s.mother}\n🏫 *कक्षा:* ${s.class} (${s.type || 'REGULAR'})\n\n💰 *कुल जमा शुल्क:* ₹${s.total_paid || 0}\n\n📊 *जमा विवरण:*\n${s.paid_list || 'कोई जमा रिकॉर्ड दर्ज नहीं है'}\n\n⚠️ *बकाया विवरण:*\n${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n🧾 *कुल बकाया ब्रेकडाउन (DUE SUMMARY):*\n• *चालू सत्र बकाया:* ₹${calc.currentDue}\n• *पिछला बकाया (Old Due):* ₹${calc.oldDue}\n---------------------------------------\n🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${calc.grandTotalDue}*\n━━━━━━━━━━━━━━━━━━━━━━━\n_यदि विवरण में त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);
}

// 📄 BRANDED ADMISSION / PROMOTION PDF CERTIFICATE BUILDER
async function sendAdmissionOrPromotionPdf(jid, item) {
    return new Promise((resolve) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 30 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(buffers);
                    const actionType = String(item.type || item.action || '').toUpperCase();
                    const isPromo = actionType.includes('PROMOT') || item.type === 'PROMOTION_CONFIRMATION' || item.action === 'PROMOTION_CONFIRMATION';

                    const title = isPromo ? 'Promotion_Certificate' : 'Admission_Confirmation';
                    const captionText = `🏫 *J.R.D. PUBLIC SCHOOL (MARUI, VARANASI)*\n📄 छात्र *${item.studentName || item.name || ''}* का आधिकारिक ${isPromo ? 'कक्षा पदोन्नति प्रमाण पत्र एवं स्वीकृत फ़ीस विवरण (Promotion Letter)' : 'प्रवेश पत्र एवं फ़ीस विवरण (Admission Form)'} PDF।`;

                    if (sock && isBotReady) {
                        await sock.sendMessage(jid, {
                            document: pdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `${title}_${safePdfText(item.studentName || item.name, 'Student')}.pdf`,
                            caption: captionText
                        });
                        console.log(`✅ ${isPromo ? 'प्रमोशन' : 'एडमिशन'} PDF सफलतापूर्वक प्रेषित!`);
                    }
                    resolve();
                } catch (e) {
                    console.error('❌ Admission/Promotion PDF Send Error:', e.message);
                    resolve();
                }
            });

            const actionType = String(item.type || item.action || '').toUpperCase();
            const isPromo = actionType.includes('PROMOT') || item.type === 'PROMOTION_CONFIRMATION' || item.action === 'PROMOTION_CONFIRMATION';
            const mainColor = isPromo ? '#0F766E' : '#1A365D';

            doc.save();
            doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
            doc.fillColor(mainColor).fillOpacity(0.03).fontSize(38).font('Helvetica-Bold');
            doc.text('J.R.D. PUBLIC SCHOOL', doc.page.width / 2 - 220, doc.page.height / 2 - 20, { align: 'center' });
            doc.restore();

            doc.rect(15, 15, doc.page.width - 30, doc.page.height - 30).lineWidth(2).strokeColor(mainColor).stroke();
            doc.rect(19, 19, doc.page.width - 38, doc.page.height - 38).lineWidth(0.5).strokeColor(mainColor).stroke();

            doc.rect(25, 25, doc.page.width - 50, 65).fillColor(mainColor).fill();
            doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 25, 34, { align: 'center' });
            doc.fontSize(8.5).font('Helvetica').text('Gram & Post - Marui, Cholapur, Varanasi (U.P.) - 221208', 25, 59, { align: 'center' });
            doc.fontSize(8).font('Helvetica-Bold').text('UDISE CODE: 09670804504 | BOARD: BASIC SHIKSHA PARISHAD U.P.', 25, 71, { align: 'center' });

            doc.rect(25, 100, doc.page.width - 50, 24).fillColor('#F1F5F9').fill();
            doc.fillColor(mainColor).fontSize(10.5).font('Helvetica-Bold').text(
                isPromo ? 'OFFICIAL CLASS PROMOTION CERTIFICATE & APPROVED FEE STRUCTURE (2026-27)' : 'OFFICIAL ADMISSION CONFIRMATION SLIP & FEE STRUCTURE (2026-27)',
                25, 107, { align: 'center' }
            );

            const gridTop = 135;
            doc.rect(25, gridTop, doc.page.width - 50, 140).lineWidth(0.5).strokeColor('#CBD5E1').stroke();

            let rowY = gridTop + 8;
            const drawRow = (label, value, isBoldVal = false) => {
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text(label, 35, rowY);
                doc.font(isBoldVal ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(isBoldVal ? mainColor : '#0F172A').text(safePdfText(value, 'N/A'), 220, rowY);
                doc.moveTo(25, rowY + 15).lineTo(doc.page.width - 25, rowY + 15).strokeColor('#E2E8F0').stroke();
                rowY += 21;
            };

            const classDisplayVal = (isPromo && item.fromClass) 
                ? `${item.fromClass}  ->  ${item.className || item.class}` 
                : (item.className || item.class || 'N/A');

            drawRow('Student Full Name :', item.studentName || item.name, true);
            drawRow("Father's Name :", item.fatherName || item.father);
            drawRow("Mother's Name :", item.motherName || item.mother);
            drawRow('Scholar / Enrollment No (SR) :', item.scholarNo || item.scholar_no || item.enroll, true);
            drawRow(isPromo ? 'Promoted Class :' : 'Allocated Class :', classDisplayVal, true);
            drawRow('Category / Student Type :', item.studentType || (isPromo ? 'PROMOTED (OLD)' : 'NEW ADMISSION'));

            const feeTop = gridTop + 152;
            doc.rect(25, feeTop, doc.page.width - 50, 20).fillColor(mainColor).fill();
            doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text('APPROVED SESSION FEE BREAKDOWN (2026-27)', 35, feeTop + 5);

            let feeY = feeTop + 24;
            doc.rect(25, feeY, doc.page.width - 50, 18).fillColor('#F1F5F9').fill();
            doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold');
            doc.text('Fee Component', 35, feeY + 4);
            doc.text('Approved Amount', doc.page.width - 160, feeY + 4, { align: 'right' });
            feeY += 20;

            let totalFeeSum = 0;
            const addFeeRow = (label, amt) => {
                if (!amt || parseFloat(amt) <= 0) return;
                let numAmt = parseFloat(amt);
                totalFeeSum += numAmt;
                doc.font('Helvetica').fontSize(9).fillColor('#334155').text(label, 35, feeY);
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A').text(`Rs. ${numAmt.toLocaleString('en-IN')}/-`, doc.page.width - 160, feeY, { align: 'right' });
                doc.moveTo(25, feeY + 14).lineTo(doc.page.width - 25, feeY + 14).strokeColor('#E2E8F0').stroke();
                feeY += 18;
            };

            let fs = item.feeStructure || {};
            let mSingle = parseFloat(fs.monthly_fee || item.monthlyFee || 0);
            let mTotal = parseFloat(fs.monthly_total || (mSingle * 12) || 0);

            if (mTotal > 0) addFeeRow(`Tuition Fee (Monthly: Rs.${mSingle} x 12 Months)`, mTotal);
            addFeeRow('Admission Fee', fs.admission_fee || item.admission_fee);
            addFeeRow('Registration Fee', fs.registration_fee || item.registration_fee);
            addFeeRow('Class Change Fee', fs.class_change_fee || item.class_change_fee);
            addFeeRow('Half Yearly Exam Fee', fs.half_yearly_exam_fee || item.half_yearly_exam_fee);
            addFeeRow('Annual Exam Fee', fs.annual_exam_fee || item.annual_exam_fee);
            addFeeRow('Practical Exam Fee', fs.practical_fee || item.practical_fee);
            addFeeRow('Board Exam Fee', fs.board_fee || item.board_fee);
            addFeeRow('Admit Card Fee', fs.admit_card_fee || item.admit_card_fee);

            let grandTotalAmt = parseFloat(fs.grand_total || item.totalAmount || totalFeeSum || 0);
            doc.rect(25, feeY, doc.page.width - 50, 22).fillColor('#E0E7FF').fill();
            doc.fillColor(mainColor).fontSize(10).font('Helvetica-Bold');
            doc.text('TOTAL APPROVED ANNUAL FEE :', 35, feeY + 6);
            doc.text(`Rs. ${grandTotalAmt.toLocaleString('en-IN')}/-`, doc.page.width - 160, feeY + 6, { align: 'right' });

            const footerY = doc.page.height - 115;
            doc.rect(25, footerY, doc.page.width - 50, 36).fillColor('#F8FAFC').fill();
            doc.fillColor('#334155').fontSize(8).font('Helvetica-Oblique').text(
                isPromo 
                ? 'Declaration: Hearty congratulations on your promotion! Please adhere to the approved fee structure and official guidelines for session 2026-27.'
                : 'Declaration: Welcome to J.R.D. Public School family! Please adhere to the approved fee structure and official school guidelines for session 2026-27.',
                32, footerY + 8, { width: doc.page.width - 64, align: 'justify' }
            );

            const sigY = doc.page.height - 55;
            doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold');
            doc.text('Parent / Guardian Signature', 35, sigY);
            doc.text('Admission In-Charge', 240, sigY);
            doc.text('Principal / Official Seal', doc.page.width - 150, sigY, { align: 'right' });

            doc.end();
        } catch (err) {
            console.error('❌ Admission/Promotion PDF Build Error:', err.message);
            resolve();
        }
    });
}

function buildBrandedFeePdfDoc(doc, data, opts) {
    const headerColor = opts.headerColor || '#1A365D';
    const bandLabel = opts.bandLabel || 'OFFICIAL FEE STATEMENT';

    doc.rect(10, 10, doc.page.width - 20, doc.page.height - 20).lineWidth(1.5).stroke(headerColor);
    doc.rect(13, 13, doc.page.width - 26, doc.page.height - 26).lineWidth(0.5).stroke(headerColor);

    doc.rect(20, 20, doc.page.width - 40, 55).fill(headerColor);
    doc.fillColor('#FFFFFF').fontSize(15).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 20, 28, { align: 'center' });
    doc.fontSize(8.5).font('Helvetica').text('Marui, Varanasi (U.P.) - 221208 | UDISE: 09670804504', 20, 48, { align: 'center' });

    doc.fillColor('#000000');
    doc.rect(20, 80, doc.page.width - 40, 20).fill('#E2E8F0');
    doc.fillColor(headerColor).fontSize(9.5).font('Helvetica-Bold').text(bandLabel, 20, 85, { align: 'center' });

    const metaTop = 108;
    doc.rect(20, metaTop, doc.page.width - 40, 70).lineWidth(0.5).stroke('#CBD5E1');

    doc.fillColor('#334155').fontSize(8.5).font('Helvetica-Bold');
    doc.text(`Student Name: `, 28, metaTop + 8);
    doc.font('Helvetica').text(`${safePdfText(data.name || data.studentName, 'STUDENT')}`, 100, metaTop + 8);

    doc.font('Helvetica-Bold').text(`Class & Sec  : `, 28, metaTop + 25);
    doc.font('Helvetica').text(`${data.className || 'N/A'}`, 100, metaTop + 25);

    doc.font('Helvetica-Bold').text(`Enrolment    : `, 28, metaTop + 42);
    doc.font('Helvetica').text(`${safePdfText(data.scholarNo || data.rid, 'N/A')}`, 100, metaTop + 42);

    const rightX = doc.page.width / 2 + 10;
    doc.font('Helvetica-Bold').text(`Session : `, rightX, metaTop + 8);
    doc.font('Helvetica').text(`${safePdfText(data.session, '2026-27')}`, rightX + 45, metaTop + 8);

    doc.font('Helvetica-Bold').text(`Status  : `, rightX, metaTop + 25);
    doc.fillColor('#15803D').font('Helvetica-Bold').text(`${opts.statusLabel || 'DUE'}`, rightX + 45, metaTop + 25);

    doc.fillColor('#334155').font('Helvetica-Bold').text(`Date    : `, rightX, metaTop + 42);
    const todayDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    doc.font('Helvetica').text(`${todayDate}`, rightX + 45, metaTop + 42);

    const tableTop = 188;
    doc.rect(20, tableTop, doc.page.width - 40, 18).fill('#F1F5F9');
    doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold');
    doc.text('Head', 28, tableTop + 4);
    doc.text('Demand', 280, tableTop + 4);
    doc.text('Received', 350, tableTop + 4);
    doc.text('Status', doc.page.width - 90, tableTop + 4);
    doc.moveTo(20, tableTop + 18).lineTo(doc.page.width - 20, tableTop + 18).stroke('#CBD5E1');

    let rowY = tableTop + 24;
    const rows = Array.isArray(data.breakdown) ? data.breakdown : [];
    if (rows.length > 0) {
        doc.fontSize(8).font('Helvetica');
        rows.forEach(row => {
            doc.fillColor('#334155').text(String(row.label || ''), 28, rowY, { width: 240 });
            doc.text(`Rs.${row.demand || 0}`, 280, rowY);
            doc.fillColor('#15803D').text(`Rs.${row.received || 0}`, 350, rowY);
            doc.fillColor(row.status === 'DUE' ? '#B91C1C' : '#15803D').text(String(row.status || ''), doc.page.width - 90, rowY);
            rowY += 16;
        });
    } else {
        doc.fillColor('#334155').fontSize(8.5).font('Helvetica');
        const cleanDetails = (data.details || '').replace(/<br>/g, '\n') || 'School Tuition / Fee Payment';
        doc.text(cleanDetails, 28, rowY, { width: doc.page.width - 60 });
        rowY += 40;
    }

    const totalBoxY = Math.max(rowY + 10, doc.page.height - 110);
    doc.rect(20, totalBoxY, doc.page.width - 40, 26).fill(headerColor);
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold');
    doc.text(opts.totalLabel || 'TOTAL AMOUNT:', 28, totalBoxY + 8);
    doc.text(`Rs. ${opts.totalAmount || 0}/-`, doc.page.width - 130, totalBoxY + 8, { align: 'right' });

    const footerY = doc.page.height - 70;
    doc.fillColor('#64748B').fontSize(7).font('Helvetica-Oblique');
    doc.text(opts.footerNote || 'This is an officially generated digital fee statement from J.R.D. Public School Administration.', 20, footerY, { align: 'center' });

    doc.rect(doc.page.width - 115, footerY - 5, 95, 30).lineWidth(0.5).stroke('#CBD5E1');
    doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold');
    doc.text('OFFICIAL SEAL & STAMP', doc.page.width - 115, footerY + 8, { width: 95, align: 'center' });
}

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
                        const captionText = `🏫 *J.R.D. PUBLIC SCHOOL (MARUI, VARANASI)*\n🧾 छात्र *${data.name || data.studentName || ''}* की आधिकारिक फीस जमा रसीद।`;
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

            buildBrandedFeePdfDoc(doc, data, {
                headerColor: '#1A365D',
                bandLabel: 'OFFICIAL FEE PAYMENT RECEIPT',
                statusLabel: 'PAID OK',
                totalLabel: 'TOTAL AMOUNT RECEIVED:',
                totalAmount: data.paid || 0,
                footerNote: 'This is an officially generated digital fee receipt from J.R.D. Public School Administration.'
            });

            doc.end();
        } catch (err) {
            console.error('PDF Receipt Build Error:', err.message);
            resolve();
        }
    });
}

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
                            fileName: `Fee_Notice_${safePdfText(data.studentName || data.name, 'Notice')}.pdf`,
                            caption: captionText
                        });
                    }
                    resolve();
                } catch (e) {
                    console.error('PDF Reminder Send Error:', e.message);
                    resolve();
                }
            });

            buildBrandedFeePdfDoc(doc, data, {
                headerColor: '#B91C1C',
                bandLabel: data.type === 'FEE_STRUCTURE_COMBO' ? 'FULL SESSION FEE STRUCTURE' : 'OFFICIAL FEE REMINDER NOTICE',
                statusLabel: 'DUE',
                totalLabel: 'TOTAL OUTSTANDING DUES:',
                totalAmount: data.totalAmount || 0,
                footerNote: 'Principal / Accounts Administration -- J.R.D. Public School'
            });

            doc.end();
        } catch (err) {
            console.error('PDF Reminder Build Error:', err.message);
            resolve();
        }
    });
}

// 🎙️ सुरक्षित एवं क्रैश-प्रूफ Swara Neural AI वॉइस जनरेटर
async function generateHindiVoiceNote(text) {
    const stamp = Date.now() + '_' + Math.floor(Math.random() * 100000);
    const mp3Path = path.join(os.tmpdir(), `voice_${stamp}.mp3`);
    const oggPath = path.join(os.tmpdir(), `voice_${stamp}.ogg`);

    const cleanup = () => {
        try { if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path); } catch (e) {}
        try { if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath); } catch (e) {}
    };

    try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(HINDI_FEMALE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = await tts.toStream(text);

        const chunks = [];
        await new Promise((resolve, reject) => {
            audioStream.on('data', (chunk) => chunks.push(chunk));
            audioStream.on('end', resolve);
            audioStream.on('error', reject);
        });

        fs.writeFileSync(mp3Path, Buffer.concat(chunks));

        return await new Promise((resolve) => {
            ffmpeg(mp3Path)
                .audioCodec('libopus')
                .audioBitrate('32k')
                .audioChannels(1)
                .format('ogg')
                .on('end', () => {
                    try {
                        const buffer = fs.readFileSync(oggPath);
                        cleanup();
                        resolve(buffer);
                    } catch (readErr) {
                        cleanup();
                        resolve(null);
                    }
                })
                .on('error', () => {
                    cleanup();
                    resolve(null);
                })
                .save(oggPath);
        });
    } catch (err) {
        console.error('⚠️ Edge TTS असफल, फॉलबैक का उपयोग हो रहा है:', err.message);
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
                            cleanup();
                            resolve(buffer);
                        } catch (e) {
                            cleanup();
                            resolve(null);
                        }
                    })
                    .on('error', () => {
                        cleanup();
                        resolve(null);
                    })
                    .save(oggPath);
            });
        } catch (fallbackErr) {
            cleanup();
            return null;
        }
    }
}

// 🛡️ सुरक्षित और क्रैश-प्रूफ ऑटो-मैसेज प्रोसेसिंग क्यू
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

                // 🎯 A. FEE REMINDER & STRUCTURE COMBO
                if (item.type === 'FEE_REMINDER_COMBO' || item.type === 'FEE_STRUCTURE_COMBO') {
                    const voiceScript = (item.voiceText && item.voiceText.trim().length > 0)
                        ? item.voiceText
                        : `नमस्कार! प्रिय अभिभावक, जे आर डी पब्लिक स्कूल मरुई से विनम्र निवेदन है। आपके बच्चे ${item.studentName || ''} की फीस ${item.totalAmount || 0} रुपये अभी बकाया है। कृपया इसे शीघ्र जमा करने का कष्ट करें। धन्यवाद!`;

                    const audioBuffer = await generateHindiVoiceNote(voiceScript);
                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    }

                    if (item.message) await sock.sendMessage(jid, { text: item.message });
                    await new Promise(res => setTimeout(res, 1500));

                    if (item.qrUrl) {
                        await sock.sendMessage(jid, {
                            image: { url: item.qrUrl },
                            caption: `📲 *1-Click Direct Fee Payment Link:*\n${item.upiLink || ''}\n\n*(स्कैन करने हेतु इस QR कोड को गैलरी में सेव कर सकते हैं)*`
                        });
                    }

                    await new Promise(res => setTimeout(res, 1200));
                    await sendFeeReminderPdf(jid, item);
                }

                // 🎯 B. NEW ADMISSION & CLASS PROMOTION CONFIRMATION
                else if (item.type === 'ADMISSION_CONFIRMATION' || item.type === 'PROMOTION_CONFIRMATION' || item.type === 'ADMISSION' || item.action === 'ADMISSION_NOTIFICATION' || item.action === 'addNewAdmission') {
                    const isPromo = item.type === 'PROMOTION_CONFIRMATION' || item.action === 'PROMOTION_CONFIRMATION';
                    const fs = item.feeStructure || {};

                    let mSingle = parseFloat(fs.monthly_fee || item.monthlyFee || 0);
                    let mTotal = parseFloat(fs.monthly_total || (mSingle * 12) || 0);
                    let admFee = parseFloat(fs.admission_fee || item.admission_fee || 0);
                    let regFee = parseFloat(fs.registration_fee || item.registration_fee || 0);
                    let chgFee = parseFloat(fs.class_change_fee || item.class_change_fee || 0);
                    let halfFee = parseFloat(fs.half_yearly_exam_fee || item.half_yearly_exam_fee || 0);
                    let annuFee = parseFloat(fs.annual_exam_fee || item.annual_exam_fee || 0);
                    let pracFee = parseFloat(fs.practical_fee || item.practical_fee || 0);
                    let boardFee = parseFloat(fs.board_fee || item.board_fee || 0);
                    let admitFee = parseFloat(fs.admit_card_fee || item.admit_card_fee || 0);

                    let grandTotal = item.totalAmount || fs.grand_total || fs.total_amount || (mTotal + admFee + regFee + chgFee + halfFee + annuFee + pracFee + boardFee + admitFee);

                    let voiceFeeList = [];
                    if (mTotal > 0) voiceFeeList.push(`वार्षिक शिक्षण शुल्क ${mTotal} रुपये`);
                    if (admFee > 0) voiceFeeList.push(`प्रवेश शुल्क ${admFee} रुपये`);
                    if (regFee > 0) voiceFeeList.push(`पंजीकरण शुल्क ${regFee} रुपये`);
                    if (chgFee > 0) voiceFeeList.push(`कक्षा परिवर्तन शुल्क ${chgFee} रुपये`);
                    if (halfFee > 0) voiceFeeList.push(`छमाही परीक्षा शुल्क ${halfFee} रुपये`);
                    if (annuFee > 0) voiceFeeList.push(`वार्षिक परीक्षा शुल्क ${annuFee} रुपये`);
                    if (pracFee > 0) voiceFeeList.push(`प्रैक्टिकल फीस ${pracFee} रुपये`);
                    if (boardFee > 0) voiceFeeList.push(`बोर्ड परीक्षा शुल्क ${boardFee} रुपये`);
                    if (admitFee > 0) voiceFeeList.push(`एडमिट कार्ड शुल्क ${admitFee} रुपये`);

                    const feeDescText = voiceFeeList.length > 0 ? voiceFeeList.join(', ') : 'कोई अतिरिक्त शुल्क देय नहीं';
                    const sName = item.studentName || item.name || 'छात्र';
                    const cName = item.className || item.class || '-';

                    let voiceScript = isPromo
                        ? `नमस्कार! जे आर डी पब्लिक स्कूल मरुई में आपका हार्दिक स्वागत है। बधाई हो, आपके प्रिय बच्चे ${sName} को अगली कक्षा ${cName} में प्रमोट कर दिया गया है। नई कक्षा के लिए स्वीकृत फ़ीस का विवरण इस प्रकार है: ${feeDescText}। पूरे शैक्षणिक सत्र में कुल मिलाकर ${grandTotal} रुपये का शुल्क देय होगा। नये सत्र की हार्दिक शुभकामनाएँ!`
                        : `नमस्कार! जे आर डी PUBLIC SCHOOL मरुई परिवार में आपका हार्दिक स्वागत है। आपके प्रिय बच्चे ${sName} का कक्षा ${cName} में नया दाखिला सफलतापूर्वक पूर्ण हो चुका है। स्वीकृत फ़ीस का विवरण इस प्रकार है: ${feeDescText}। पूरे शैक्षणिक सत्र में कुल मिलाकर ${grandTotal} रुपये का शुल्क देय होगा। नये सत्र की ढेरों शुभकामनाएँ!`;

                    const audioBuffer = await generateHindiVoiceNote(voiceScript);
                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    }

                    if (item.message && item.message.trim().length > 0) {
                        await sock.sendMessage(jid, { text: item.message });
                        await new Promise(res => setTimeout(res, 1500));
                    }

                    await sendAdmissionOrPromotionPdf(jid, item);
                }

                // 🎯 C. FEE PAYMENT RECEIPT
                else if (item.type === 'FEE_RECEIPT' || item.type === 'PAYMENT' || (parseFloat(item.paid) > 0 && item.rid)) {
                    let cleanDet = (item.details || '').replace(/<br>/g, "\n");
                    let studentNameClean = item.name || item.studentName || 'छात्र';
                    let paidAmount = item.paid || item.amount || 0;

                    let breakdownList = Array.isArray(item.breakdown) ? item.breakdown : [];
                    let voiceFeeList = [];
                    let textItems = [];

                    if (breakdownList.length > 0) {
                        breakdownList.forEach(b => {
                            let amt = parseFloat(b.received || b.amount || 0);
                            if (amt > 0) {
                                let labelName = b.label || 'शुल्क';
                                voiceFeeList.push(`${labelName} ${amt} रुपये`);
                                textItems.push(`• *${labelName}:* ₹${amt}/-`);
                            }
                        });
                    }

                    let textBreakdownDetails = textItems.length > 0 ? textItems.join('\n') : (cleanDet || `• *फीस जमा:* ₹${paidAmount}/-`);
                    let voiceBreakdownText = voiceFeeList.length > 0 ? "जमा की गई मदों का विवरण इस प्रकार है: " + voiceFeeList.join(', ') + "। " : "";

                    let textToSend = item.message || `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n🧾 *आधिकारिक फीस जमा रसीद*\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *छात्र का नाम:* *${studentNameClean}*\n🏫 *कक्षा:* ${item.className || item.class || 'N/A'}\n📅 *सत्र:* ${item.session || '2026-27'}\n🆔 *रसीद संख्या:* \`${item.rid || 'N/A'}\` \n💰 *कुल जमा राशि:* ₹${paidAmount}/-\n\n📊 *जमा फीस मदवार विवरण (Fee Breakdown):*\n${textBreakdownDetails}\n━━━━━━━━━━━━━━━━━━━━━━━\n_आपकी जमा फीस की डिजिटल PDF रसीद नीचे संलग्न है।_\nधन्यवाद! - JRD Management`;

                    await sock.sendMessage(jid, { text: textToSend });
                    await new Promise(res => setTimeout(res, 1200));

                    let voiceScript = `नमस्ते! प्रिय अभिभावक, जे आर डी पब्लिक स्कूल मरुई में आपके प्रिय बच्चे ${studentNameClean} की कुल ${paidAmount} रुपये फीस सफलतापूर्वक जमा कर ली गई है। ${voiceBreakdownText}डिजिटल रसीद एवं बहीखाता विवरण संदेश में नीचे संलग्न है। धन्यवाद!`;
                    const audioBuffer = await generateHindiVoiceNote(voiceScript);
                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    }

                    await new Promise(res => setTimeout(res, 1200));
                    await sendFeePdfReceipt(jid, item);
                }

                // 🎯 D. TEACHER WELCOME (TEXT + SWARA AI VOICE + 100% BRANDED OFFICIAL JOINING LETTER PDF)
                else if (item.type === 'TEACHER_WELCOME' || item.action === 'save_teacher') {
                    // 1. टेक्स्ट मैसेज भेजें
                    if (item.message && item.message.trim().length > 0) {
                        await sock.sendMessage(jid, { text: item.message });
                        await new Promise(res => setTimeout(res, 1200));
                    }

                    // 2. Swara AI वॉइस नोट
                    let audioBuffer = null;
                    if (item.audio_url && item.audio_url.startsWith('http')) {
                        try {
                            const audioRes = await axios.get(item.audio_url, { 
                                responseType: 'arraybuffer', 
                                timeout: 10000,
                                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                            });
                            audioBuffer = Buffer.from(audioRes.data);
                        } catch (e) {
                            console.error("⚠️ ऑनलाइन ऑडियो डाउनलोड फेल, स्वरा TTS से नया बना रहे हैं...");
                        }
                    }

                    if (!audioBuffer) {
                        const scriptText = `नमस्ते! आदरणीय ${item.name || 'शिक्षक'} जी, जानकी बाल शिक्षा निकेतन परिवार में आपका हार्दिक स्वागत एवं अभिनंदन है। आपकी लॉगिन आईडी, पासवर्ड और आधिकारिक नियुक्ति पत्र संदेश में नीचे भेजा जा रहा है। धन्यवाद!`;
                        audioBuffer = await generateHindiVoiceNote(scriptText);
                    }

                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                        await new Promise(res => setTimeout(res, 1500));
                    }

                    // 3. 📄 100% BRANDED HIGH-QUALITY OFFICIAL JOINING LETTER PDF
                    try {
                        let pdfBuffer = null;

                        // यदि PHP URL दिया है तो डाउनलोड करने का प्रयास करें
                        if (item.pdf_url && item.pdf_url.startsWith('http')) {
                            try {
                                const pdfRes = await axios.get(item.pdf_url, { 
                                    responseType: 'arraybuffer', 
                                    timeout: 12000,
                                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                                });
                                const downloadedBuf = Buffer.from(pdfRes.data);
                                if (downloadedBuf.toString('utf8', 0, 4) === '%PDF') {
                                    pdfBuffer = downloadedBuf;
                                }
                            } catch (dErr) {
                                console.log("⚠️ PHP URL से PDF डाउनलोड नहीं हो पाया, ऑटो-जनरेटर यूज़ हो रहा है...");
                            }
                        }

                        // यदि PHP से PDF न मिले, तो Node.js खुद Branded A4 Official Joining Letter बनाएगा
                        if (!pdfBuffer) {
                            pdfBuffer = await new Promise((resolve) => {
                                const doc = new PDFDocument({ size: 'A4', margin: 30 });
                                let buffers = [];
                                doc.on('data', buffers.push.bind(buffers));
                                doc.on('end', () => resolve(Buffer.concat(buffers)));

                                const mainColor = '#1A365D'; // डार्क नेवी ब्लू
                                const todayDate = new Date().toLocaleDateString('en-IN', {
                                    timeZone: 'Asia/Kolkata',
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric'
                                });

                                const teacherName = item.name || item.studentName || 'Teacher';
                                const teacherId = item.teacher_id || item.teacherId || item.scholarNo || 'N/A';
                                const teacherPass = item.password || 'jrd123';
                                const teacherClass = item.className || item.class_assigned || item.class || 'Class 10';
                                const teacherSub = item.subject || 'General';
                                const teacherDesig = item.designation || 'Teacher';
                                const teacherPhone = item.number || item.phone || 'N/A';

                                // 🏛️ 1. वाटरमार्क
                                doc.save();
                                doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
                                doc.fillColor(mainColor).fillOpacity(0.03).fontSize(38).font('Helvetica-Bold');
                                doc.text('J.R.D. PUBLIC SCHOOL', doc.page.width / 2 - 220, doc.page.height / 2 - 20, { align: 'center' });
                                doc.restore();

                                // 🏛️ 2. डबल बॉर्डर
                                doc.rect(15, 15, doc.page.width - 30, doc.page.height - 30).lineWidth(2).strokeColor(mainColor).stroke();
                                doc.rect(19, 19, doc.page.width - 38, doc.page.height - 38).lineWidth(0.5).strokeColor(mainColor).stroke();

                                // 🏛️ 3. स्कूल हेडर
                                doc.rect(25, 25, doc.page.width - 50, 65).fillColor(mainColor).fill();
                                doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 25, 34, { align: 'center' });
                                doc.fontSize(8.5).font('Helvetica').text('Gram & Post - Marui, Cholapur, Varanasi (U.P.) - 221208', 25, 59, { align: 'center' });
                                doc.fontSize(8).font('Helvetica-Bold').text('UDISE CODE: 09670804504 | BOARD: BASIC SHIKSHA PARISHAD U.P.', 25, 71, { align: 'center' });

                                // 🏛️ 4. बैंड टाइटल
                                doc.rect(25, 100, doc.page.width - 50, 24).fillColor('#F1F5F9').fill();
                                doc.fillColor(mainColor).fontSize(10.5).font('Helvetica-Bold').text('OFFICIAL TEACHER APPOINTMENT & JOINING LETTER', 25, 107, { align: 'center' });

                                // 🏛️ 5. टीचर इंफॉर्मेशन टेबल ग्रिड
                                const gridTop = 135;
                                doc.rect(25, gridTop, doc.page.width - 50, 185).lineWidth(0.5).strokeColor('#CBD5E1').stroke();

                                let rowY = gridTop + 8;
                                const drawRow = (label, value, isBoldVal = false) => {
                                    doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text(label, 35, rowY);
                                    doc.font(isBoldVal ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(isBoldVal ? mainColor : '#0F172A').text(safePdfText(value, 'N/A'), 220, rowY);
                                    doc.moveTo(25, rowY + 15).lineTo(doc.page.width - 25, rowY + 15).strokeColor('#E2E8F0').stroke();
                                    rowY += 21;
                                };

                                drawRow('Teacher Full Name :', teacherName, true);
                                drawRow('Teacher ID / Username :', teacherId, true);
                                drawRow('Login Password :', teacherPass, true);
                                drawRow('Assigned Class :', teacherClass, true);
                                drawRow('Subject Assigned :', teacherSub);
                                drawRow('Designation / Post :', teacherDesig);
                                drawRow('Contact Number :', teacherPhone);
                                drawRow('Date of Joining :', todayDate);

                                // 🏛️ 6. रूल्स एंड गाइडलाइंस सेक्शन
                                const rulesTop = gridTop + 195;
                                doc.rect(25, rulesTop, doc.page.width - 50, 20).fillColor(mainColor).fill();
                                doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text('TEACHER PORTAL GUIDELINES & RESPONSIBILITIES', 35, rulesTop + 5);

                                doc.fillColor('#334155').fontSize(8.5).font('Helvetica');
                                const rulesText = 
                                    `1. Attendance & Timetable: Please log in to your Teacher Portal at https://jrdschool.in using your Username and Password.\n` +
                                    `2. Daily Class Activity: Record student daily attendance, upload homework assignments, and submit exam marks regularly.\n` +
                                    `3. Code of Conduct: Maintain utmost discipline, academic standards, and moral guidance for student welfare.\n` +
                                    `4. Official System ID: Keep your login password confidential. Any system activity from your account is your responsibility.`;

                                doc.text(rulesText, 35, rulesTop + 28, { width: doc.page.width - 70, align: 'left', lineGap: 4 });

                                // 🏛️ 7. डिक्लेरेशन और सिग्नेचर
                                const footerY = doc.page.height - 110;
                                doc.rect(25, footerY, doc.page.width - 50, 32).fillColor('#F8FAFC').fill();
                                doc.fillColor('#334155').fontSize(8).font('Helvetica-Oblique').text(
                                    'Declaration: Welcome to J.R.D. Public School family! We look forward to your valuable contribution towards excellence in education for session 2026-27.',
                                    32, footerY + 8, { width: doc.page.width - 64, align: 'justify' }
                                );

                                const sigY = doc.page.height - 55;
                                doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold');
                                doc.text('Teacher Signature', 35, sigY);
                                doc.text('Admission / HR In-Charge', 240, sigY);
                                doc.text('Principal / Official Seal', doc.page.width - 150, sigY, { align: 'right' });

                                doc.end();
                            });
                        }

                        // व्हाट्सएप पर PDF प्रेषित करें
                        await sock.sendMessage(jid, {
                            document: pdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `Joining_Letter_${safePdfText(item.name, 'Teacher')}.pdf`,
                            caption: `🏫 *J.R.D. PUBLIC SCHOOL (MARUI, VARANASI)*\n📄 आदरणीय *${item.name || 'शिक्षक'}* जी का आधिकारिक नियुक्ति पत्र (Joining Letter PDF) संलग्न है।`
                        });
                        console.log(`✅ Teacher Official Joining PDF (${item.name}) सफलतापूर्वक भेजा गया!`);

                    } catch (pErr) {
                        console.error("❌ Teacher PDF बनाने/भेजने में त्रुटि:", pErr.message);
                    }
                }

                // 🎯 E. GENERAL MESSAGES
                else {
                    if (item.message && item.message.trim().length > 0) {
                        await sock.sendMessage(jid, { text: item.message });
                    }
                    if (item.voiceText && item.voiceText.trim().length > 0) {
                        const audioBuffer = await generateHindiVoiceNote(item.voiceText);
                        if (audioBuffer) {
                            await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`❌ ऑटो संदेश भेजने में त्रुटि (${item.number}):`, err.message);
        } finally {
            messageQueue.shift();
            await new Promise(res => setTimeout(res, 2000));
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

    const stData = body.studentData || {};
    const fStruct = body.feeStructure || {};

    messageQueue.push({
        number: targetPhone.toString(),
        message: body.message || "",
        type: body.type || body.action || 'GENERAL',
        action: body.action || body.type || '',
        name: body.name || body.teacher_name || body.student_name || body.studentName || stData.name || '',
        studentName: body.studentName || body.name || body.student_name || stData.name || '',
        className: body.className || body.class || stData.class || '',
        fromClass: body.fromClass || body.from_class || stData.from_class || '',
        session: body.session || body.session_year || stData.session_year || '2026-27',
        rid: body.rid || body.receipt_no || '',
        scholarNo: body.scholarNo || body.scholar_no || body.enroll || stData.scholar_no || stData.enroll || '',
        enroll: body.enroll || stData.enroll || body.scholarNo || '',
        fatherName: body.fatherName || body.father || stData.father || '',
        motherName: body.motherName || body.mother || stData.mother || '',
        studentType: body.studentType || body.student_type || body.status || stData.type || 'REGULAR',
        paid: body.paid || body.amount || 0,
        totalAmount: body.totalAmount || fStruct.grand_total || fStruct.total_amount || 0,
        feeStructure: Object.keys(fStruct).length > 0 ? fStruct : body,
        voiceText: body.voiceText || '',
        // 🟢 टीचर वेलकम ऑडियो और पीडीएफ हेतु जोड़े गए पैरामीटर्स
        audio_url: body.audio_url || body.voice_url || '',
        pdf_url: body.pdf_url || body.document_url || '',
        filename: body.filename || body.pdf_name || `Joining_Letter_${body.teacher_id || 'Teacher'}.pdf`,
        upiLink: body.upiLink || '',
        qrUrl: body.qrUrl || '',
        details: body.details || '',
        breakdown: Array.isArray(body.breakdown) ? body.breakdown : []
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
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px; color:green;">✅ JRD VIP ERP व्हाट्सएप बोट कनेक्टेड है!</h2>');
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
    res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">🧹 पुराना सेशन साफ़ कर दिया गया है! <a href="/qr">/qr पेज खोलें</a>।</h2>');
});

app.get('/clear-lid-cache', (req, res) => {
    try {
        if (fs.existsSync(LID_MAP_FILE)) {
            fs.unlinkSync(LID_MAP_FILE);
            lidPhoneMap = {};
            return res.send('✅ LID cache cleared.');
        }
        res.send('ℹ️ Cache file already absent.');
    } catch (e) {
        res.status(500).send('❌ Error: ' + e.message);
    }
});

app.get('/', (req, res) => {
    res.send(`JRD WhatsApp Bot Status: ${isBotReady ? 'Connected ✅' : 'Waiting for QR scan ⏳'}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`JRD VIP ERP Bot running on port ${PORT}`);
});

startBot();

// ⚡ Self-Ping Interval (Railway सर्वर को एक्टिव रखने हेतु)
setInterval(() => {
    https.get('https://jrd-whatsapp-bot-production.up.railway.app/', () => {
        console.log('⚡ Self-Ping successful');
    }).on('error', (err) => {
        console.error('❌ Self-Ping error:', err.message);
    });
}, 4 * 60 * 1000);

// 🎙️ TEACHER & STUDENT LIVE ATTENDANCE API WITH 1-31 QUOTES
app.post('/send-attendance', async (req, res) => {
    const body = req.body || {};
    const targetPhone = body.number || body.phone || body.mobile;
    const name = body.name || body.teacher_name || 'शिक्षक';
    const status = (body.status || 'PRESENT').toString().toUpperCase().trim();
    const className = body.class || body.class_name || '';
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
        let voiceScriptText = "";

        if (type === 'TEACHER_ATTENDANCE') {
            if (status === 'ABSENT' || status === 'A') {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n⚠️ *अनुपस्थिति सूचना (TEACHER ABSENT)*\n\nआदरणीय *${name}* जी,\nआज विद्यालय में आपकी स्थिति **अनुपस्थित (ABSENT)** दर्ज की गई है।\n\n_कृपया अपनी नियमित उपस्थिति बनाए रखें ताकि पठन-पाठन सुचारू रूप से चल सके।_\n━━━━━━━━━━━━━━━━━━━━━━━\n– Er. Sarvesh Verma (Management)`;
                voiceScriptText = `नमस्ते! आदरणीय ${name} जी, जे आर डी पब्लिक स्कूल मरुई प्रबंधन द्वारा सूचित किया जाता है कि आज विद्यालय में आपकी स्थिति अनुपस्थित दर्ज की गई है। कृपया अपनी नियमित उपस्थिति बनाए रखें ताकि पठन-पाठन सुचारू रूप से चल सके।
 धन्यवाद!`;
            } else if (attType === 'OUT') {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n🚩 *शिक्षक प्रस्थान (OUT-TIME)*\n\nआदरणीय *${name}* जी,\n\n🕒 *प्रस्थान समय:* ${cleanTime}\n🏁 *स्थिति:* कार्य दिवस पूर्ण ✅\n\n🌺 *आज का आभार संदेश:*\n_"${todayOutQuote}"_\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
                voiceScriptText = `नमस्ते! आदरणीय ${name} जी, जे आर डी पब्लिक स्कूल मरुई में आपका आज का प्रस्थान समय ${cleanTime} बजे सफलतापूर्वक दर्ज कर लिया गया है। ${todayOutQuote} धन्यवाद!`;
            } else if (attType === 'IN') {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n📋 *शिक्षक उपस्थिति (IN-TIME)*\n\nआदरणीय *${name}* जी,\nविद्यालय में आपका हार्दिक स्वागत है!\n\n🕒 *आगमन समय:* ${cleanTime}\n✅ *स्थिति:* PRESENT (उपस्थित)\n\n💭 *आज का प्रेरणादायी विचार:*\n_"${todayInQuote}"_\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
                voiceScriptText = `नमस्ते! आदरणीय ${name} जी, जे आर डी पब्लिक स्कूल मरुई परिवार में आपका हार्दिक स्वागत है। आपका आगमन समय ${cleanTime} बजे दर्ज हो गया है। ${todayInQuote} आपका दिन शुभ हो!`;
            } else {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n✅ *उपस्थिति सूचना (PRESENT)*\n\nआदरणीय *${name}* जी,\nआज विद्यालय में आपकी उपस्थिति (**PRESENT**) दर्ज कर ली गई है।\n\n💭 *आज का विचार:*\n_"${todayInQuote}"_\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
                voiceScriptText = `नमस्ते! आदरणीय ${name} जी, जे आर डी पब्लिक स्कूल मरुई में आज आपकी उपस्थिति सफलतापूर्वक दर्ज कर ली गई है। ${todayInQuote} धन्यवाद!`;
            }
      } else {
            // 🎓 छात्र उपस्थिति एवं अनुपस्थिति संदेश इंजन (Gender-Free, 31 Quotes & Clean Class)
            const isAbsent = status.toLowerCase() === 'absent' || status.toLowerCase() === 'a' || status === 'अनुपस्थित';
            
            // क्लास से फालतू शब्द साफ करना (ताकि "कक्षा: Class 9" जैसी गलती न हो)
            const cleanClass = String(className || '')
                .replace(/class/gi, '')
                .replace(/कक्षा/gi, '')
                .replace(/th|st|nd|rd/gi, '')
                .trim() || className;

            const todayStudentQuote = studentQuotes[dayOfMonth] || studentQuotes[1];

          } else {
            // 🎓 छात्र उपस्थिति एवं अनुपस्थिति संदेश इंजन (Only JRD Public School & Clean Voice Ending)
            const isAbsent = status.toLowerCase() === 'absent' || status.toLowerCase() === 'a' || status === 'अनुपस्थित';
            
            // क्लास से फालतू शब्द साफ करना (ताकि "कक्षा: Class 9" जैसी पुनरावृत्ति न हो)
            const cleanClass = String(className || '')
                .replace(/class/gi, '')
                .replace(/कक्षा/gi, '')
                .replace(/th|st|nd|rd/gi, '')
                .trim() || className;

            const todayStudentQuote = studentQuotes[dayOfMonth] || studentQuotes[1];
            const todayAbsentQuote = absentQuotes[dayOfMonth] || absentQuotes[1];

            if (isAbsent) {
                // 🔴 अनुपस्थित (ABSENT)
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n` +
                              `📅 *दिनांक:* ${todayStr}\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `⚠️ *दैनिक उपस्थिति सूचना (ABSENT)*\n\n` +
                              `आदरणीय अभिभावक जी,\n` +
                              `सादर प्रणाम।\n\n` +
                              `आपको अत्यंत विनम्रतापूर्वक सूचित किया जाता है कि आपके प्रिय पाल्य:\n\n` +
                              `👤 *विद्यार्थी:* *${name}*\n` +
                              `📚 *कक्षा:* ${cleanClass}\n` +
                              `📊 *स्थिति:* अनुपस्थित (ABSENT) ❌\n\n` +
                              `आज विद्यालय में उपस्थित नहीं हैं।\n\n` +
                              `📖 *आज का अनुशासन विचार:*\n` +
                              `_"${todayAbsentQuote}"_\n\n` +
                              `✍️ *विशेष आग्रह:*\n` +
                              `_कृपया पाल्य के विद्यालय न आने का उचित कारण विद्यालय कार्यालय में अवश्य सूचित करने का कष्ट करें ताकि इनकी निरंतर पढ़ाई प्रभावित न हो।_\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `– JRD Management`;

                voiceScriptText = `आदरणीय अभिभावक जी, सादर प्रणाम। जे आर डी पब्लिक स्कूल से सूचित किया जाता है कि आपके प्रिय पाल्य ${name}, कक्षा ${cleanClass}, आज विद्यालय में अनुपस्थित हैं। आज का अनुशासन विचार: ${todayAbsentQuote}। कृपया विद्यालय न आने का उचित कारण सूचित करने का कष्ट करें। धन्यवाद!`;

            } else {
                // 🟢 उपस्थित (PRESENT)
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n` +
                              `📅 *दिनांक:* ${todayStr}\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `✅ *दैनिक उपस्थिति सूचना (PRESENT)*\n\n` +
                              `आदरणीय अभिभावक जी,\n` +
                              `सादर प्रणाम।\n\n` +
                              `हमें आपको सूचित करते हुए अत्यंत हर्ष हो रहा है कि आपके प्रिय पाल्य:\n\n` +
                              `👤 *विद्यार्थी:* *${name}*\n` +
                              `📚 *कक्षा:* ${cleanClass}\n` +
                              `📊 *स्थिति:* उपस्थित (PRESENT) ✅\n\n` +
                              `आज विद्यालय में समय से उपस्थित हैं।\n\n` +
                              `📖 *आज का प्रेरक विचार:*\n` +
                              `_"${todayStudentQuote}"_\n\n` +
                              `👉 _कृपया घर पर भी इनके दैनिक अध्ययन एवं गृहकार्य पर विशेष ध्यान दें।_\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `– JRD Management`;

                voiceScriptText = `आदरणीय अभिभावक जी, सादर प्रणाम। जे आर डी पब्लिक स्कूल में आज आपके प्रिय पाल्य ${name}, कक्षा ${cleanClass}, समय से उपस्थित हैं। आज का प्रेरक विचार: ${todayStudentQuote}। कृपया घर पर भी इनके नियमित अध्ययन और गृहकार्य पर ध्यान दें। धन्यवाद!`;
            }
        }
        const sent = await sock.sendMessage(jid, { text: messageText });
        if (sent?.key?.id) messageCache.set(sent.key.id, { conversation: messageText });

        if (voiceScriptText) {
            try {
                const audioBuffer = await generateHindiVoiceNote(voiceScriptText);
                if (audioBuffer) {
                    await sock.sendMessage(jid, {
                        audio: audioBuffer,
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true
                    });
                }
            } catch (vErr) {
                console.error("⚠️ Voice note issue:", vErr.message);
            }
        }

        if (updateAttendanceSmsStatus && body.attendance_id) {
            updateAttendanceSmsStatus(body.attendance_id, 'SENT');
        }

        return res.status(200).json({ status: 'success', message: 'Attendance message & Voice note sent successfully' });
    } catch (error) {
        console.error('❌ Attendance sending error:', error.message);
        return res.status(500).json({ status: 'error', message: error.toString() });
    }
});
