// ============================================================
// Koiii POS — Google Apps Script v3
// เพิ่มระบบ token ยืนยันตัวตน (auth) เข้ามาจาก v2
//
// ทำไมต้องเพิ่ม?
//   v2 ไม่มีการตรวจสอบสิทธิ์เลยสำหรับ action ที่แก้ข้อมูล
//   (saveMenu, saveStock, restock, waste, adjustStock, cancelOrder,
//   saveOrder) ใครก็ตามที่รู้ SCRIPT_URL (ซึ่งดูได้จาก View Source
//   ของหน้าเว็บ) ยิง request ตรงมาที่นี่ได้เลยโดยไม่ต้อง login เลย
//
// v3 แก้ยังไง?
//   - checkPassword สำเร็จ → สร้าง "token" แบบสุ่ม เก็บไว้ใน
//     CacheService (หมดอายุอัตโนมัติ 6 ชม.) แล้วส่ง token กลับไป
//   - ทุก action อื่น (ยกเว้น checkPassword) ต้องแนบ token ที่ valid
//     มาด้วยเสมอ ไม่งั้นถูกปฏิเสธทันที
//
// วิธีอัปเดต:
//   1. เปิด Google Apps Script Editor (script.google.com)
//   2. ลบโค้ดเก่าทั้งหมดออก
//   3. วางโค้ดใหม่ทั้งหมดนี้
//   4. กด Deploy → Manage Deployments → แก้ deployment เดิม (ปุ่มดินสอ)
//      → Version: "New version" → Deploy
//      (ใช้ "New version" ไม่ใช่ "New deployment" เพื่อให้ URL เดิมใช้ได้
//      ต่อ ไม่ต้องไปแก้ SCRIPT_URL ในไฟล์ HTML ทุกไฟล์ใหม่)
// ============================================================

// ── ชื่อ Sheet ที่ใช้ในระบบ ──
const SHEET_ORDERS   = 'Orders';
const SHEET_MENU     = 'Menu';
const SHEET_STOCK    = 'Stock';
const SHEET_STOCKLOG = 'StockLog';

// ============================================================
// AUTH — ระบบ token ยืนยันตัวตน (เพิ่มใหม่ v3)
//
// ทำงานยังไง:
//   1. login สำเร็จ (checkPassword คืน ok:true) → createToken()
//      สุ่ม UUID มาเป็น token แล้วเก็บลง CacheService
//   2. ทุก request อื่นๆ ต้องแนบ token → isValidToken() เช็คว่า
//      token นี้เคยถูกสร้างและยังไม่หมดอายุไหม
//   3. CacheService หมดอายุอัตโนมัติเอง ไม่ต้องลบเองภายหลัง
//
// ทำไม 21600 วินาที (6 ชม.) ไม่ใช่ 8 ชม. ตามที่ comment เดิมบอก?
//   เพราะ CacheService.put() รองรับ expirationInSeconds สูงสุดแค่
//   21600 วินาที (6 ชม.) เป็นข้อจำกัดของ Apps Script เอง
// ============================================================
const SESSION_TTL_SEC = 21600; // 6 ชั่วโมง (ค่าสูงสุดที่ CacheService รองรับ)

function createToken() {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('tok_' + token, '1', SESSION_TTL_SEC);
  return token;
}

function isValidToken(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get('tok_' + token) === '1';
}

// ============================================================
// doGet — รับคำขอแบบ GET (ดึงข้อมูล)
// v3: ต้องแนบ ?token=... ที่ valid มาด้วยทุกครั้ง ไม่งั้นปฏิเสธ
// ============================================================
function doGet(e) {
  if (!isValidToken(e.parameter.token)) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }

  const action = e.parameter.action;

  if (action === 'getMenu') {
    return jsonResponse(getMenuItems());
  }

  if (action === 'getStock') {
    return jsonResponse(getStockItems());
  }

  if (action === 'getStockLog') {
    const limit = parseInt(e.parameter.limit) || 100;
    return jsonResponse(getStockLog(limit));
  }

  // ── Default: ออเดอร์ตามวันที่ ──
  const date = e.parameter.date;
  return jsonResponse(getOrders(date));
}

// ============================================================
// doPost — รับคำขอแบบ POST (ส่งข้อมูล/แก้ไข)
// v3: checkPassword ยกเว้นไม่ต้องมี token (เพราะยังไม่ login)
//     action อื่นทั้งหมดต้องมี token ที่ valid ก่อนถึงจะทำงาน
// ============================================================
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;

    // ── ตรวจสอบรหัสผ่าน Admin — ไม่ต้องมี token (นี่คือจุดที่สร้าง token) ──
    if (action === 'checkPassword') {
      var result = checkPassword(body.password);
      if (result.ok) {
        result.token = createToken(); // login สำเร็จ → แจก token ใหม่
      }
      return jsonResponse(result);
    }

    // ── ทุก action อื่นจากนี้ ต้องมี token ที่ valid เสมอ ──
    if (!isValidToken(body.token)) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }

    if (action === 'saveMenu') {
      saveMenuItems(body.items);
      return jsonResponse({ ok: true, action: 'saveMenu' });
    }

    if (action === 'saveStock') {
      saveStockItems(body.items);
      return jsonResponse({ ok: true, action: 'saveStock' });
    }

    if (action === 'restock') {
      restockItem(body.itemId, body.itemName, parseFloat(body.qty), body.note, body.unit);
      return jsonResponse({ ok: true, action: 'restock' });
    }

    if (action === 'waste') {
      wasteItem(body.itemId, body.itemName, parseFloat(body.qty), body.note, body.unit);
      return jsonResponse({ ok: true, action: 'waste' });
    }

    if (action === 'adjustStock') {
      adjustStockItem(body.itemId, body.itemName, parseFloat(body.newQty), body.note, body.unit);
      return jsonResponse({ ok: true, action: 'adjustStock' });
    }

    if (action === 'cancelOrder') {
      return cancelOrderInSheet(body);
    }

    // ── Default: บันทึกออเดอร์ + ตัดสต็อกอัตโนมัติ ──
    saveOrder(body);
    return jsonResponse({ ok: true, action: 'saveOrder' });

  } catch(err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ============================================================
// jsonResponse — แปลง JavaScript object → JSON string และส่งกลับ
// ============================================================
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ORDERS — บันทึกออเดอร์ + ตัดสต็อกอัตโนมัติ
// ============================================================

function saveOrder(body) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_ORDERS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ORDERS);
    sheet.appendRow(['date','time','table','orderType','items','total','payMethod']);
  }

  sheet.appendRow([
    body.date,
    body.time,
    body.table,
    body.orderType,
    body.items,
    body.total,
    body.payMethod
  ]);

  try {
    const orderItems = parseOrderItems(body.items || '');
    if (orderItems.length > 0) {
      deductStockForOrder(orderItems);
    }
  } catch(stockErr) {
    console.log('⚠️ Stock deduction error:', stockErr.message);
  }
}

function getOrders(date) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];

  return data.slice(1)
    .filter(row => !date || String(row[0]) === date)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let val = row[i];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
        }
        obj[h] = val;
      });
      return obj;
    });
}

// ============================================================
// MENU — จัดการเมนูสินค้า
// ============================================================

function getMenuItems() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_MENU);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    obj.price  = parseFloat(obj.price)  || 0;
    obj.active = obj.active === true || obj.active === 'TRUE';
    obj.weight = obj.weight_desc || obj.weight || '';
    return obj;
  });
}

function saveMenuItems(items) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_MENU);
  if (!sheet) sheet = ss.insertSheet(SHEET_MENU);

  sheet.clearContents();
  const headers = ['id','type','cat','name','price','weight_desc','emoji','img','active'];
  sheet.appendRow(headers);
  items.forEach(item => {
    sheet.appendRow(headers.map(h => item[h] !== undefined ? item[h] : ''));
  });
}

// ============================================================
// STOCK ITEMS — ดึง/บันทึกตั้งค่าสต็อก
// ============================================================

function getStockItems() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_STOCK);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_STOCK);
    sheet.appendRow([
      'id','menuName','displayName','category','unit',
      'deductPerOrder','currentQty','alertQty','costPerUnit',
      'expiryDays','lastRestockDate','supplier','supplierPhone','active'
    ]);
    return [];
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    obj.deductPerOrder = parseFloat(obj.deductPerOrder) || 0;
    obj.currentQty     = parseFloat(obj.currentQty)     || 0;
    obj.alertQty       = parseFloat(obj.alertQty)       || 0;
    obj.costPerUnit    = parseFloat(obj.costPerUnit)     || 0;
    obj.expiryDays     = parseInt(obj.expiryDays)        || 0;
    obj.active         = obj.active === true || obj.active === 'TRUE';
    return obj;
  });
}

function saveStockItems(items) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_STOCK);
  if (!sheet) sheet = ss.insertSheet(SHEET_STOCK);

  sheet.clearContents();
  const headers = [
    'id','menuName','displayName','category','unit',
    'deductPerOrder','currentQty','alertQty','costPerUnit',
    'expiryDays','lastRestockDate','supplier','supplierPhone','active'
  ];
  sheet.appendRow(headers);

  items.forEach(item => {
    sheet.appendRow(headers.map(h => item[h] !== undefined ? item[h] : ''));
  });
}

// ============================================================
// STOCK DEDUCTION — ตัดสต็อกอัตโนมัติเมื่อมีออเดอร์
// ============================================================

function parseOrderItems(itemsStr) {
  const countMap = {};
  if (!itemsStr) return [];

  itemsStr.split(' | ').forEach(bowl => {
    bowl.replace(/^ชามที่\d+:\s*/, '').split(', ').forEach(item => {
      const nameMatch = item.match(/^[^\s]*\s([^\฿]+)/);
      const qtyMatch  = item.match(/x(\d+)/);

      if (nameMatch) {
        const name = nameMatch[1].trim();
        const qty  = qtyMatch ? parseInt(qtyMatch[1]) : 1;
        countMap[name] = (countMap[name] || 0) + qty;
      }
    });
  });

  return Object.entries(countMap).map(([name, qty]) => ({ name, qty }));
}

function deductStockForOrder(orderItems) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_STOCK);
  if (!sheet) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch(e) {
    console.log('⚠️ LockService timeout - stock deduction skipped:', e.message);
    return;
  }

  try {
    const data    = sheet.getDataRange().getValues();
    if (data.length <= 1) return;

    const headers = data[0];

    const IDX_MENU   = headers.indexOf('menuName');
    const IDX_DEDUCT = headers.indexOf('deductPerOrder');
    const IDX_QTY    = headers.indexOf('currentQty');
    const IDX_UNIT   = headers.indexOf('unit');
    const IDX_ID     = headers.indexOf('id');
    const IDX_DNAME  = headers.indexOf('displayName');
    const COL_QTY    = IDX_QTY + 1;

    const pendingUpdates = [];
    const normalizeName = name => String(name).trim().toLowerCase();

    orderItems.forEach(orderItem => {
      const orderNameNorm = normalizeName(orderItem.name);

      for (let i = 1; i < data.length; i++) {
        const sheetNameNorm = normalizeName(data[i][IDX_MENU]);
        if (sheetNameNorm !== orderNameNorm) continue;

        const deductPerOrder = parseFloat(data[i][IDX_DEDUCT]) || 0;
        const currentQty     = parseFloat(data[i][IDX_QTY])    || 0;
        const unit           = data[i][IDX_UNIT];
        const itemId         = data[i][IDX_ID];
        const displayName    = data[i][IDX_DNAME];

        const totalDeduct = deductPerOrder * orderItem.qty;
        const newQty = Math.max(0, currentQty - totalDeduct);

        data[i][IDX_QTY] = newQty;

        pendingUpdates.push({
          rowIndex: i + 1,
          newQty,
          log: { itemId, displayName, totalDeduct, newQty, unit }
        });

        break;
      }
    });

    const qtyColumn = data.slice(1).map(row => [row[IDX_QTY]]);

    pendingUpdates.forEach(update => {
      qtyColumn[update.rowIndex - 2] = [update.newQty];
    });

    if (pendingUpdates.length > 0 && data.length > 1) {
      sheet.getRange(2, COL_QTY, data.length - 1, 1).setValues(qtyColumn);
    }

    pendingUpdates.forEach(update => {
      const { itemId, displayName, totalDeduct, newQty, unit } = update.log;
      addStockLog(itemId, displayName, 'sale', -totalDeduct, 'จากออเดอร์ POS', newQty, unit);
    });

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// RESTOCK / WASTE / ADJUST
// ============================================================

function restockItem(itemId, itemName, qty, note, unit) {
  updateStockQty(itemId, itemName, qty, 'restock', note || 'เติมสต็อก', unit, true);
}

function wasteItem(itemId, itemName, qty, note, unit) {
  updateStockQty(itemId, itemName, qty, 'waste', note || 'ของเสีย', unit, false);
}

function adjustStockItem(itemId, itemName, newQty, note, unit) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_STOCK);
  if (!sheet) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch(e) {
    console.log('⚠️ LockService timeout (adjust):', e.message);
    return;
  }

  try {
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const COL_ID  = headers.indexOf('id')         + 1;
    const COL_QTY = headers.indexOf('currentQty') + 1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][COL_ID - 1]) === String(itemId)) {
        const oldQty = parseFloat(data[i][COL_QTY - 1]) || 0;
        const diff   = newQty - oldQty;

        sheet.getRange(i + 1, COL_QTY).setValue(newQty);
        addStockLog(itemId, itemName, 'adjust', diff,
          note || `ปรับจาก ${oldQty} เป็น ${newQty}`, newQty, unit);
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function updateStockQty(itemId, itemName, qty, type, note, unit, isAdd) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_STOCK);
  if (!sheet) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch(e) {
    console.log('⚠️ LockService timeout (updateStockQty):', e.message);
    return;
  }

  try {
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const COL_ID      = headers.indexOf('id')              + 1;
    const COL_QTY     = headers.indexOf('currentQty')      + 1;
    const COL_RESTOCK = headers.indexOf('lastRestockDate')  + 1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][COL_ID - 1]) !== String(itemId)) continue;

      const currentQty = parseFloat(data[i][COL_QTY - 1]) || 0;
      const newQty     = isAdd
        ? currentQty + qty
        : Math.max(0, currentQty - qty);

      sheet.getRange(i + 1, COL_QTY).setValue(newQty);

      if (isAdd && COL_RESTOCK > 0) {
        sheet.getRange(i + 1, COL_RESTOCK).setValue(
          new Date().toLocaleDateString('th-TH', {day:'2-digit', month:'2-digit', year:'numeric'})
        );
      }

      const logQty = isAdd ? +qty : -qty;
      addStockLog(itemId, itemName, type, logQty, note, newQty, unit);
      break;
    }
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// STOCK LOG
// ============================================================

function addStockLog(itemId, itemName, type, qty, note, newTotal, unit) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_STOCKLOG);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_STOCKLOG);
    sheet.appendRow(['date','time','itemId','itemName','type','qty','unit','note','newTotal']);
  }

  const now = new Date();
  sheet.appendRow([
    now.toLocaleDateString('th-TH', {day:'2-digit', month:'2-digit', year:'numeric'}),
    now.toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'}),
    itemId,
    itemName,
    type,
    qty,
    unit,
    note || '',
    newTotal
  ]);
}

function getStockLog(limit) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_STOCKLOG);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];

  return data.slice(1)
    .reverse()
    .slice(0, limit)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

// ============================================================
// checkPassword — ตรวจสอบรหัสผ่าน Admin (ไม่เปลี่ยนจาก v2)
// ============================================================
function checkPassword(inputPassword) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var configSheet = ss.getSheetByName('Config');

    if (!configSheet) {
      return { ok: false, error: 'ไม่พบ sheet "Config" กรุณาสร้างก่อน' };
    }

    var storedPassword = configSheet.getRange('B1').getValue();
    storedPassword = String(storedPassword).trim();

    if (!storedPassword) {
      return { ok: false, error: 'ยังไม่ได้ตั้งรหัสผ่าน กรุณาใส่ใน cell B1' };
    }

    var isMatch = inputPassword.trim() === storedPassword;
    return { ok: isMatch };

  } catch(e) {
    Logger.log('checkPassword error: ' + e.toString());
    return { ok: false, error: e.toString() };
  }
}

// ============================================================
// cancelOrderInSheet — mark บิลเป็น "ยกเลิก" ใน Sheet Orders
// ============================================================
function cancelOrderInSheet(data) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_ORDERS);

    if (!sheet) {
      return jsonResponse({ ok: false, error: 'ไม่พบ Sheet Orders' });
    }

    const allData = sheet.getDataRange().getValues();
    if (allData.length < 2) {
      return jsonResponse({ ok: false, error: 'ไม่มีข้อมูลใน Sheet' });
    }

    const headers = allData[0];

    const dateCol  = headers.findIndex(h => String(h).toLowerCase() === 'date');
    const timeCol  = headers.findIndex(h => String(h).toLowerCase() === 'time');
    const tableCol = headers.findIndex(h => String(h).toLowerCase() === 'table');

    if (dateCol < 0 || timeCol < 0 || tableCol < 0) {
      return jsonResponse({
        ok: false,
        error: `หา column ไม่เจอ — date:${dateCol} time:${timeCol} table:${tableCol}`
      });
    }

    let statusCol = headers.findIndex(h => String(h).toLowerCase() === 'status');
    if (statusCol < 0) {
      statusCol = headers.length;
      sheet.getRange(1, statusCol + 1).setValue('status');
    }

    const targetTable = String(data.table || data.orderType || '').trim();
    let foundRow = -1;

    for (let i = 1; i < allData.length; i++) {
      let rowTime = allData[i][timeCol];
      if (rowTime instanceof Date) {
        rowTime = Utilities.formatDate(rowTime, Session.getScriptTimeZone(), 'HH:mm');
      }

      const rowDate  = String(allData[i][dateCol]).trim();
      const rowTimeS = String(rowTime).trim();
      const rowTable = String(allData[i][tableCol]).trim();

      if (rowDate === String(data.date).trim() &&
          rowTimeS === String(data.time).trim() &&
          rowTable === targetTable) {
        foundRow = i;
        break;
      }
    }

    if (foundRow < 0) {
      return jsonResponse({ ok: false, error: 'ไม่พบบิลที่ตรงกับ date/time/table ที่ส่งมา' });
    }

    sheet.getRange(foundRow + 1, statusCol + 1).setValue('ยกเลิก');

    return jsonResponse({ ok: true });

  } catch(e) {
    return jsonResponse({ ok: false, error: e.toString() });
  }
}
