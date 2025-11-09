const express = require('express');
const router = express.Router();
const db = require('../db.js');

// Security Middleware to check for Purchase Management permission (reused for accounting features)
const checkPurchaseManagementPermission = async (req, res, next) => {
  try {
    const requesterIdOrUsername = req.headers['x-user-id'] || req.body.employeeId;
    if (!requesterIdOrUsername) {
      return res.status(401).json({ message: 'Unauthorized: User ID is missing.' });
    }
    const idStr = String(requesterIdOrUsername);
    const isNumericId = /^[0-9]+$/.test(idStr);
    const whereField = isNumericId ? 'id' : 'username';
    const [userRows] = await db.query(`SELECT role, has_purchase_management_permission FROM users WHERE ${whereField} = ?`, [requesterIdOrUsername]);
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    const user = userRows[0];
    if (String(user.role).toLowerCase() === 'admin' || !!user.has_purchase_management_permission) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: Purchase management permission required.' });
  } catch (error) {
    console.error('Error in checkPurchaseManagementPermission (instantExpenses):', error);
    return res.status(500).json({ message: 'Internal error while checking permissions.' });
  }
};

// Map DB row to frontend Custody Sheet
const mapSheetRow = (row) => ({
  id: row.id,
  custodyNumber: row.custody_number || null,
  custodyAmount: Number(row.custody_amount || 0),
  status: row.status || 'OPEN',
  notes: row.notes || null,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  lastModified: row.last_modified ? new Date(row.last_modified).toISOString() : new Date().toISOString(),
  // lightweight aggregates for UI
  totalSpent: row.total_spent !== undefined && row.total_spent !== null ? Number(row.total_spent) : undefined,
  lineCount: row.line_count !== undefined && row.line_count !== null ? Number(row.line_count) : undefined,
});

// Map DB row to frontend Line Item
const mapLineRow = (row) => ({
  id: row.id,
  date: row.date ? new Date(row.date).toISOString().slice(0, 10) : null,
  company: row.company || null,
  invoiceNumber: row.invoice_number || null,
  description: row.description || null,
  reason: row.reason,
  amount: Number(row.amount || 0),
  bankFees: row.bank_fees !== null && row.bank_fees !== undefined ? Number(row.bank_fees) : undefined,
  buyerName: row.buyer_name || null,
  notes: row.notes || null,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
});

// GET /api/instant-expenses/sheets - list custody sheets (ordered by last_modified DESC)
router.get('/instant-expenses/sheets', checkPurchaseManagementPermission, async (req, res) => {
  try {
    const requesterId = req.headers['x-user-id'];
    const requesterRole = (req.headers['x-user-role'] || '').toLowerCase();

    let base = `
      SELECT s.*,
             COALESCE(SUM(l.amount + COALESCE(l.bank_fees, 0)), 0) AS total_spent,
             COUNT(l.id) AS line_count
      FROM instant_expense_sheets s
      LEFT JOIN instant_expense_lines l ON l.sheet_id = s.id
    `;
    let where = '';
    let params = [];
    if (requesterRole === 'employee' && requesterId) {
      where = 'WHERE s.user_id = ?';
      params = [requesterId];
    }
    const tail = ` GROUP BY s.id ORDER BY s.last_modified DESC`;
    const query = `${base} ${where} ${tail}`;

    const [rows] = await db.query(query, params);
    res.json(rows.map(mapSheetRow));
  } catch (error) {
    console.error('Error in GET /api/instant-expenses/sheets:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء جلب العهد.' });
  }
});

// POST /api/instant-expenses/sheets - create a new custody sheet
router.post('/instant-expenses/sheets', checkPurchaseManagementPermission, async (req, res) => {
  const { employeeId, custodyNumber, custodyAmount, notes } = req.body;
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ? OR id = ?', [employeeId, employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    const id = `CUST-${Date.now().toString().slice(-6)}`;
    const payload = {
      id,
      custody_number: custodyNumber || null,
      custody_amount: Number(custodyAmount || 0),
      user_id: userId,
      status: 'OPEN',
      notes: notes || null,
      created_at: new Date(),
      last_modified: new Date(),
    };
    await db.query('INSERT INTO instant_expense_sheets SET ?', payload);

    const [rows] = await db.query('SELECT * FROM instant_expense_sheets WHERE id = ?', [id]);
    res.status(201).json(mapSheetRow(rows[0]));
  } catch (error) {
    console.error('Error in POST /api/instant-expenses/sheets:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء إنشاء العهدة.' });
  }
});

// GET /api/instant-expenses/sheets/:id - sheet details with lines
router.get('/instant-expenses/sheets/:id', checkPurchaseManagementPermission, async (req, res) => {
  const { id } = req.params;
  try {
    const [sheetRows] = await db.query('SELECT * FROM instant_expense_sheets WHERE id = ?', [id]);
    if (sheetRows.length === 0) return res.status(404).json({ message: 'Sheet not found.' });
    const sheet = mapSheetRow(sheetRows[0]);

    const [lineRows] = await db.query('SELECT * FROM instant_expense_lines WHERE sheet_id = ? ORDER BY date DESC, created_at DESC', [id]);
    const lines = lineRows.map(mapLineRow);
    res.json({ sheet, lines });
  } catch (error) {
    console.error('Error in GET /api/instant-expenses/sheets/:id:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء جلب تفاصيل العهدة.' });
  }
});

// POST /api/instant-expenses/sheets/:id/lines - add a line
router.post('/instant-expenses/sheets/:id/lines', checkPurchaseManagementPermission, async (req, res) => {
  const { id } = req.params; // sheet id
  const { date, company, invoiceNumber, description, reason, amount, bankFees, buyerName, notes } = req.body;
  try {
    const [sheetRows] = await db.query('SELECT custody_amount FROM instant_expense_sheets WHERE id = ?', [id]);
    if (sheetRows.length === 0) return res.status(404).json({ message: 'Sheet not found.' });

    const lineId = `LINE-${Date.now().toString().slice(-9)}`;
    const payload = {
      id: lineId,
      sheet_id: id,
      date: date ? new Date(date) : null,
      company: company || null,
      invoice_number: invoiceNumber || null,
      description: description || null,
      reason: reason,
      amount: Number(amount || 0),
      bank_fees: bankFees !== undefined && bankFees !== null ? Number(bankFees) : null,
      buyer_name: buyerName || null,
      notes: notes || null,
      created_at: new Date(),
    };
    await db.query('INSERT INTO instant_expense_lines SET ?', payload);

    // Touch the parent sheet to update last_modified so lists resort automatically
    await db.query('UPDATE instant_expense_sheets SET last_modified = NOW() WHERE id = ?', [id]);

    const [rows] = await db.query('SELECT * FROM instant_expense_lines WHERE id = ?', [lineId]);
    res.status(201).json(mapLineRow(rows[0]));
  } catch (error) {
    console.error('Error in POST /api/instant-expenses/sheets/:id/lines:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء إضافة بند مصروف.' });
  }
});

// DELETE /api/instant-expenses/sheets/:id/lines/:lineId - remove a line
router.delete('/instant-expenses/sheets/:id/lines/:lineId', checkPurchaseManagementPermission, async (req, res) => {
  const { id, lineId } = req.params;
  try {
    const [exists] = await db.query('SELECT id FROM instant_expense_lines WHERE id = ? AND sheet_id = ?', [lineId, id]);
    if (exists.length === 0) return res.status(404).json({ message: 'Line not found.' });
    await db.query('DELETE FROM instant_expense_lines WHERE id = ? AND sheet_id = ?', [lineId, id]);

    // Touch the parent sheet to update last_modified so lists resort automatically
    await db.query('UPDATE instant_expense_sheets SET last_modified = NOW() WHERE id = ?', [id]);

    res.json({ message: 'تم حذف البند.' });
  } catch (error) {
    console.error('Error in DELETE /api/instant-expenses/sheets/:id/lines/:lineId:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء حذف البند.' });
  }
});

// POST /api/instant-expenses/sheets/:id/close - close the sheet (optional)
router.post('/instant-expenses/sheets/:id/close', checkPurchaseManagementPermission, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE instant_expense_sheets SET status = ?, last_modified = NOW() WHERE id = ?', ['CLOSED', id]);
    const [rows] = await db.query('SELECT * FROM instant_expense_sheets WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Sheet not found after closing.' });
    res.json(mapSheetRow(rows[0]));
  } catch (error) {
    console.error('Error in POST /api/instant-expenses/sheets/:id/close:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء إغلاق العهدة.' });
  }
});

module.exports = router;