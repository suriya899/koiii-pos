// ============================================================
// auth.js — ระบบ login/session ใช้ร่วมกันทุกหน้า (POS, kitchen,
// dashboard, stock, stock-editor, menu-editor, admin)
//
// ทุกหน้า (ยกเว้น admin.html ที่เป็นหน้า login เอง) ต้องเรียก
// requireAuth() เป็นบรรทัดแรกสุดของ <script> เพื่อเช็คก่อนว่า
// login แล้วหรือยัง — ถ้ายัง จะเด้งไปหน้า admin.html ทันที
//
// token ที่ได้จากการ login จะถูกแนบไปกับทุก request ไปหา
// Apps Script (ทั้ง GET query string และ POST body) เพื่อให้
// backend ตรวจสอบสิทธิ์ก่อนอ่าน/แก้ข้อมูลทุกครั้ง
// ============================================================

// URL ของ Google Apps Script — ใช้ร่วมกันทุกไฟล์ แก้ที่นี่ที่เดียว
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbziGE6NDPk2ztrirPlMFueedesJKn0ANOzuTVyqwqZ7w5O6eXempqbMqLTggSEEhBf2/exec';

const SESSION_KEY = 'koiii_admin_auth';

// อายุ session ฝั่ง browser = 6 ชั่วโมง
// ต้องเท่ากับ SESSION_TTL_SEC ฝั่ง Apps Script (21600 วินาที)
// เพราะ CacheService ของ Apps Script รองรับสูงสุดแค่ 6 ชั่วโมง
const SESSION_TTL = 6 * 60 * 60 * 1000;

// getSession() — อ่าน session จาก sessionStorage
// คืน null ถ้าไม่มี / หมดอายุ / parse ไม่ได้
function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token) return null;
    if (Date.now() - session.loginTime >= SESSION_TTL) return null;
    return session;
  } catch (e) {
    return null;
  }
}

// getToken() — คืน token ปัจจุบัน หรือ '' ถ้าไม่ได้ login
function getToken() {
  const session = getSession();
  return session ? session.token : '';
}

// saveSession(token) — บันทึก session หลัง login สำเร็จ
function saveSession(token) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    token: token,
    loginTime: Date.now()
  }));
}

// clearSession() — ลบ session (logout / หมดอายุ)
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// requireAuth() — เรียกที่หัวไฟล์ทุกหน้าที่ต้อง login ก่อนใช้งาน
// ไม่มี session ที่ valid → เด้งไปหน้า login ทันที
function requireAuth() {
  if (!getSession()) {
    location.href = 'admin.html';
  }
}
