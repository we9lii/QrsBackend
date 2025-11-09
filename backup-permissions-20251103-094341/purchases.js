const express = require('express');
const router = express.Router();
const db = require('../db.js');
const multer = require('multer');
const { cloudinary } = require('../cloudinary.js');
const streamifier = require('streamifier');

// Multer memory storage for direct Cloudinary uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper: upload a file to Cloudinary into a purchases folder per user
const uploadFileToCloudinary = (file, uploadedById) => {
  return new Promise((resolve, reject) => {
    const publicId = file.originalname.split('.').slice(0, -1).join('.').trim();
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `qssun_reports/purchases/${uploadedById}`,
        public_id: publicId,
        resource_type: 'auto'
      },
      (error, result) => {
        if (error) return reject(error);
        if (result) resolve({ url: result.secure_url, fileName: file.originalname, id: result.public_id, uploadedBy: uploadedById });
        else reject(new Error('Cloudinary upload failed without an error object.'));
      }
    );
    streamifier.createReadStream(file.buffer).pipe(uploadStream);
  });
};

// Security Middleware to check for Purchase Management permission
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
    console.error('Error in checkPurchaseManagementPermission:', error);
    return res.status(500).json({ message: 'Internal error while checking permissions.' });
  }
};

// Map DB row to frontend PurchaseInvoice
const mapPurchaseRowToFrontend = (row) => ({
  id: row.id,
  invoiceNumber: row.invoice_number,
  vendor: row.vendor || 'N/A',
  payee: row.payee || 'N/A',
  buyerName: row.buyer_name || undefined,
  custodyNumber: row.custody_number || undefined,
  description: row.description || '',
  invoiceDate: row.invoice_date ? new Date(row.invoice_date).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
  amount: Number(row.amount || 0),
  transferFee: row.transfer_fee !== null && row.transfer_fee !== undefined ? Number(row.transfer_fee) : undefined,
  employeeName: row.employee_full_name || row.employee_id_username || 'N/A',
  notes: row.notes || undefined,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  hidden: !!row.hidden,
  hideReason: row.hide_reason || undefined,
  hiddenAt: row.hidden_at ? new Date(row.hidden_at).toISOString() : undefined,
  reviewStatus: row.review_status || 'NEEDS_REVIEW',
});

// GET /api/purchase-invoices - list
router.get('/purchase-invoices', checkPurchaseManagementPermission, async (req, res) => {
  try {
    const requesterId = req.headers['x-user-id'];
    const requesterRole = (req.headers['x-user-role'] || '').toLowerCase();

    let query = `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name
                 FROM purchase_invoices p
                 LEFT JOIN users u ON p.user_id = u.id
                 ORDER BY p.invoice_date DESC, p.created_at DESC`;
    let params = [];

    if (requesterRole === 'employee' && requesterId) {
      query = `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name
               FROM purchase_invoices p
               LEFT JOIN users u ON p.user_id = u.id
               WHERE p.user_id = ?
               ORDER BY p.invoice_date DESC, p.created_at DESC`;
      params = [requesterId];
    }

    const [rows] = await db.query(query, params);
    res.json(rows.map(mapPurchaseRowToFrontend));
  } catch (error) {
    console.error('Error in GET /api/purchase-invoices:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء جلب فواتير المشتريات.' });
  }
});

// POST /api/purchase-invoices - create
router.post('/purchase-invoices', checkPurchaseManagementPermission, async (req, res) => {
  const {
    employeeId,
    invoiceNumber,
    vendor,
    payee,
    buyerName,
    custodyNumber,
    description,
    invoiceDate,
    amount,
    transferFee,
    notes,
    reviewStatus,
  } = req.body;

  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    const id = `PUR-${Date.now().toString().slice(-6)}`;
    const payload = {
      id,
      invoice_number: invoiceNumber,
      vendor: vendor || null,
      payee: payee || null,
      buyer_name: buyerName || null,
      custody_number: custodyNumber || null,
      description: description || null,
      invoice_date: invoiceDate ? new Date(invoiceDate) : new Date(),
      amount: Number(amount || 0),
      transfer_fee: transferFee !== undefined && transferFee !== null ? Number(transferFee) : null,
      user_id: userId,
      notes: notes || null,
      review_status: (reviewStatus || 'NEEDS_REVIEW'),
      created_at: new Date(),
      last_modified: new Date(),
    };

    await db.query('INSERT INTO purchase_invoices SET ?', payload);

    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name
       FROM purchase_invoices p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`, [id]
    );
    res.status(201).json(mapPurchaseRowToFrontend(rows[0]));
  } catch (error) {
    console.error('Error in POST /api/purchase-invoices:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء إنشاء فاتورة المشتريات.' });
  }
});

// GET /api/purchase-invoices/:id - details with attachments + logs
router.get('/purchase-invoices/:id', checkPurchaseManagementPermission, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name
       FROM purchase_invoices p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`, [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Purchase invoice not found.' });
    const base = mapPurchaseRowToFrontend(rows[0]);

    const [attachRows] = await db.query('SELECT * FROM purchase_attachments WHERE purchase_id = ? ORDER BY upload_date DESC', [id]);
    const attachments = attachRows.map(a => ({ id: String(a.id), url: a.url, fileName: a.file_name, type: a.type }));

    const [logRows] = await db.query('SELECT id, actor_id, action, comment, date FROM purchase_logs WHERE purchase_id = ? ORDER BY date DESC', [id]);
    const logs = logRows.map(l => ({ id: String(l.id), action: l.action, comment: l.comment || '', actorId: String(l.actor_id || ''), date: new Date(l.date).toISOString() }));

    res.json({ ...base, attachments, logs });
  } catch (error) {
    console.error(`Error in GET /api/purchase-invoices/${id}:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء جلب تفاصيل الفاتورة.' });
  }
});

// POST /api/purchase-invoices/:id/hide - hide invoice with reason
router.post('/purchase-invoices/:id/hide', checkPurchaseManagementPermission, async (req, res) => {
  const { id } = req.params;
  const { employeeId, reason } = req.body;
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    await db.query('UPDATE purchase_invoices SET hidden = 1, hide_reason = ?, hidden_at = ?, last_modified = ? WHERE id = ?', [reason || null, new Date(), new Date(), id]);
    await db.query('INSERT INTO purchase_logs SET ?', { purchase_id: id, action: 'hidden', comment: reason || '', actor_id: userId, date: new Date() });

    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name
       FROM purchase_invoices p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`, [id]
    );
    res.json(mapPurchaseRowToFrontend(rows[0]));
  } catch (error) {
    console.error(`Error in POST /api/purchase-invoices/${id}/hide:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء إخفاء الفاتورة.' });
  }
});

// POST /api/purchase-invoices/:id/attachments - upload attachments
router.post('/purchase-invoices/:id/attachments', checkPurchaseManagementPermission, upload.array('attachments'), async (req, res) => {
  const { id } = req.params;
  const { employeeId, type } = req.body; // optional type: invoice_scan | payment_proof | other
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    let uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      uploadedFiles = await Promise.all(req.files.map(file => uploadFileToCloudinary(file, userId)));
      for (const f of uploadedFiles) {
        await db.query('INSERT INTO purchase_attachments SET ?', {
          purchase_id: id,
          type: type || 'invoice_scan',
          url: f.url,
          file_name: f.fileName,
          uploaded_by: userId,
          upload_date: new Date(),
        });
      }
    }

    await db.query('INSERT INTO purchase_logs SET ?', { purchase_id: id, action: 'attachments_uploaded', comment: type || '', actor_id: userId, date: new Date() });
    res.status(201).json({ message: 'تم رفع المرفقات بنجاح.', files: uploadedFiles });
  } catch (error) {
    console.error(`Error in POST /api/purchase-invoices/${id}/attachments:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء رفع المرفقات.' });
  }
});

module.exports = router;