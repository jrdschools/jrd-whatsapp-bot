const mysql = require('mysql2/promise');

// 🌐 InfinityFree MySQL डेटाबेस कनेक्शन पूल
const pool = mysql.createPool({
    host: 'sql301.infinityfree.com',
    user: 'if0_42111799',
    password: '2vwRfuCQmioFtE',
    database: 'if0_42111799_XXX', // ⚠️ ध्यान दें: 'XXX' की जगह अपना असली डेटाबेस नाम (उदा: if0_42111799_jrd) डालें
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 20000 // फ्री होस्टिंग के लिए टाइमआउट 20 सेकंड रखा गया है
});

// 🔄 SQL डेटाबेस में अटेंडेंस SMS स्टेटस (SENT/FAILED) अपडेट करने का फ़ंक्शन
async function updateAttendanceSmsStatus(enrolment, attendanceDate, status = 'SENT') {
    try {
        const query = `
            UPDATE student_attendance 
            SET sms_status = ?, sent_time = NOW() 
            WHERE enrolment = ? AND attendance_date = ?
        `;
        const [result] = await pool.execute(query, [status, enrolment, attendanceDate]);
        console.log(`✅ SQL Sync: ${enrolment} का SMS स्टेटस [${status}] अपडेट हो गया।`);
        return result;
    } catch (err) {
        console.error('❌ SQL Update Error:', err.message);
    }
}

// 🔌 डेटाबेस कनेक्शन चेक करने का हेल्पर फ़ंक्शन
async function testDbConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ InfinityFree MySQL Database connected successfully!');
        connection.release();
    } catch (err) {
        console.error('❌ Database Connection Failed:', err.message);
    }
}

module.exports = { 
    pool, 
    updateAttendanceSmsStatus, 
    testDbConnection 
};
