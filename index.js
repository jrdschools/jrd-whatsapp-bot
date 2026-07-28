const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, Browsers, fetchLatestBaileysVersion, isJidBroadcast } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('baileys-mongo-state');
const { MongoClient } = require('mongodb');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const https = require('https');
const fs = require('fs');
const path = require('path');

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1CPviWaISRLeTB6wgSPKSjep78v7a48cHjs5-n9q4sPGUM_jqlWA2aUd2qbhUXKBC/exec";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://test:test@cluster0.mongodb.net/?retryWrites=true&w=majority";

const LID_MAP_FILE = path.join(__dirname, 'lid_phone_map.json');
let lidPhoneMap = {};

function loadLidPhoneMap() {
    try {
        if (fs.existsSync(LID_MAP_FILE)) {
            lidPhoneMap = JSON.parse(fs.readFileSync(LID_MAP_FILE, 'utf8')) || {};
        }
    } catch (e) { lidPhoneMap = {}; }
}

function saveLidPhoneMapping(lidJid, phone) {
    try {
        if (!lidJid || !phone || lidPhoneMap[lidJid] === phone) return;
        lidPhoneMap[lidJid] = phone;
        fs.writeFileSync(LID_MAP_FILE, JSON.stringify(lidPhoneMap, null, 2));
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

function cacheMessage(id, messageData) {
    if (!id) return;
    if (messageCache.size > 2000) {
        const firstKey = messageCache.keys().next().value;
        messageCache.delete(firstKey);
    }
    messageCache.set(id, messageData);
}

let sock = null;
let currentQrCode = '';
let isBotReady = false;
let isConnecting = false;
let mongoCollection = null;

async function initMongo() {
    if (!mongoCollection) {
        const mongoClient = new MongoClient(MONGO_URI);
        await mongoClient.connect();
        mongoCollection = mongoClient.db("jrd_bot").collection("sessions");
    }
    return mongoCollection;
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

        for (const candidate of directCandidates) {
            const phone = pnJidToIndianMobile(candidate);
            if (phone) return phone;
        }
        return null;
    } catch (e) { return null; }
}

async function startBot() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        console.log('⚡ JRD VIP WhatsApp Bot (MongoDB Session) स्टार्ट हो रहा है...');
        const collection = await initMongo();
        const { state, saveCreds } = await useMongoDBAuthState(collection);

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
            markOnlineOnConnect: false,
            browser: Browsers.ubuntu('Chrome'),
            msgRetryCounterCache,
            retryRequestDelayMs: 2000,
            maxMsgRetryCount: 10,
            shouldIgnoreJid: jid => isJidBroadcast(jid),
            getMessage: async (key) => {
                if (messageCache.has(key.id)) {
                    const cached = messageCache.get(key.id);
                    return cached.message || cached;
                }
                return { conversation: 'JRD Public School' };
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQrCode = qr;
                isConnecting = false;
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === 'close') {
                isBotReady = false;
                isConnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    setTimeout(() => startBot(), 1500);
                } else {
                    setTimeout(() => startBot(), 2500);
                }
            } else if (connection === 'open') {
                isConnecting = false;
                currentQrCode = '';
                isBotReady = true;
                console.log('🎉 JRD VIP ERP Bot Active via MongoDB!');
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const jid = msg.key.remoteJid;
            if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return;

            const senderPhone = await extractGuardianPhone(jid, msg);
            const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            
            if (senderPhone) {
                await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n\nआपका संदेश प्राप्त हुआ: "${rawText}"`);
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
            if (sent?.key?.id) cacheMessage(sent.key.id, { conversation: text });
        }
    } catch (err) {}
}

app.get('/qr', (req, res) => {
    if (isBotReady) return res.send('✅ Connect hai!');
    if (!currentQrCode) return res.send('QR ready ho raha hai...');
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQrCode)}`;
    res.send(`<img src="${qrImageUrl}"/>`);
});

app.get('/', (req, res) => res.send(`Bot Status: ${isBotReady ? 'Connected ✅' : 'Waiting for QR ⏳'}`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
startBot();
