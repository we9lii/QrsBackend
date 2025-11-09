const express = require('express');
const router = express.Router();
const db = require('../db.js');
const multer = require('multer');
const { cloudinary } = require('../cloudinary.js');
const streamifier = require('streamifier');

// Multer memory storage for direct Cloudinary uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper: upload a file to Cloudinary into a packages folder per user
const uploadFileToCloudinary = (file, uploadedById) => {
  return new Promise((resolve, reject) => {
    const publicId = file.originalname.split('.').slice(0, -1).join('.').trim();
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `qssun_reports/packages/${uploadedById}`,
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

// Map DB row to frontend PackageRequest
const mapPackageRowToFrontend = (row) => ({
  id: row.id,
  title: row.title || 'N/A',
  description: row.description || '',
  customerName: row.customer_name || 'N/A',
  customerPhone: row.customer_phone || 'N/A',
  priority: (row.priority || 'medium'),
  status: (row.status || 'NEW'),
  progressPercent: Number(row.progress_percent || 0),
  creationDate: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  lastModified: row.last_modified ? new Date(row.last_modified).toISOString() : new Date().toISOString(),
  employeeId: row.employee_id_username || 'N/A',
  employeeName: row.employee_full_name || row.employee_id_username || 'N/A',
  branch: row.branch_name || 'N/A',
  customerLocation: row.customer_location || null,
  meta: (() => { try { return JSON.parse(row.meta || '{}'); } catch { return {}; } })(),
});

// GET /api/package-requests - list
router.get('/package-requests', async (req, res) => {
  try {
    const requesterId = req.headers['x-user-id'];
    const requesterRole = (req.headers['x-user-role'] || '').toLowerCase();

    let query = `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
                 FROM package_requests p
                 LEFT JOIN users u ON p.user_id = u.id
                 LEFT JOIN branches b ON u.branch_id = b.id
                 ORDER BY p.created_at DESC`;
    let params = [];

    // If employee role, limit to their own requests; admins see all
    if (requesterRole === 'employee' && requesterId) {
      query = `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
               FROM package_requests p
               LEFT JOIN users u ON p.user_id = u.id
               LEFT JOIN branches b ON u.branch_id = b.id
               WHERE p.user_id = ?
               ORDER BY p.created_at DESC`;
      params = [requesterId];
    }

    const [rows] = await db.query(query, params);
    const list = rows.map(mapPackageRowToFrontend);
    res.json(list);
  } catch (error) {
    console.error('Error in GET /api/package-requests:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء جلب طلبات البكجات.' });
  }
});

// POST /api/package-requests - create
router.post('/package-requests', async (req, res) => {
  const {
    employeeId,
    title,
    description,
    customerName,
    customerPhone,
    packageType,
    deliveryMethod,
    modifications,
    customerLocation,
    isPaid,
    priority,
    meta,
  } = req.body;

  try {
    // Resolve user
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    const id = `PKG-${Date.now().toString().slice(-6)}`;
    const status = isPaid ? 'PAYMENT_CONFIRMED' : 'NEW';
    const progress = isPaid ? 10 : 0;

    const payload = {
      id,
      user_id: userId,
      title: title || `${packageType || 'Package'} - ${customerName || ''}`.trim(),
      description: description || modifications || '',
      customer_name: customerName || '',
      customer_phone: customerPhone || '',
      priority: priority || 'medium',
      status,
      progress_percent: progress,
      customer_location: customerLocation || null,
      meta: JSON.stringify({ ...(meta || {}), packageType, deliveryMethod, modifications, isPaid, customerLocation }),
      created_at: new Date(),
      last_modified: new Date(),
    };

    await db.query('INSERT INTO package_requests SET ?', payload);

    // Return with user join fields
    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
       FROM package_requests p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE p.id = ?`, [id]
    );

    res.status(201).json(mapPackageRowToFrontend(rows[0]));
  } catch (error) {
    console.error('Error in POST /api/package-requests:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء إنشاء طلب البكج.' });
  }
});

// GET /api/package-requests/:id - details with attachments + logs
router.get('/package-requests/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
       FROM package_requests p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE p.id = ?`, [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Package request not found.' });
    const base = mapPackageRowToFrontend(rows[0]);

    const [attachRows] = await db.query('SELECT * FROM package_attachments WHERE package_id = ? ORDER BY upload_date DESC', [id]);
    const attachments = attachRows.map(a => ({ url: a.url, fileName: a.file_name, type: a.type }));
    const paymentProofs = attachments.filter(a => a.type === 'payment_proof');
    const shippingDocs = attachments.filter(a => a.type === 'shipping_doc');

    const [logRows] = await db.query('SELECT id, actor_id, action, comment, date FROM package_logs WHERE package_id = ? ORDER BY date DESC', [id]);
    const logs = logRows.map(l => ({ id: String(l.id), action: l.action, comment: l.comment || '', actorId: String(l.actor_id || ''), date: new Date(l.date).toISOString() }));

    res.json({ ...base, attachments: { paymentProofs, shippingDocs, all: attachments }, logs });
  } catch (error) {
    console.error(`Error in GET /api/package-requests/${id}:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء جلب تفاصيل الطلب.' });
  }
});

// POST /api/package-requests/:id/confirm-payment - upload payment proof and set status
router.post('/package-requests/:id/confirm-payment', upload.array('payment_proof'), async (req, res) => {
  const { id } = req.params;
  const { employeeId, comment } = req.body;
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    // Upload files
    let uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      uploadedFiles = await Promise.all(req.files.map(file => uploadFileToCloudinary(file, userId)));
      for (const f of uploadedFiles) {
        await db.query('INSERT INTO package_attachments SET ?', {
          package_id: id,
          type: 'payment_proof',
          url: f.url,
          file_name: f.fileName,
          uploaded_by: userId,
          upload_date: new Date(),
        });
      }
    }

    await db.query('UPDATE package_requests SET status = ?, progress_percent = ?, last_modified = ? WHERE id = ?', ['PAYMENT_CONFIRMED', 20, new Date(), id]);
    await db.query('INSERT INTO package_logs SET ?', { package_id: id, action: 'payment_confirmed', comment: comment || '', actor_id: userId, date: new Date() });

    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
       FROM package_requests p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE p.id = ?`, [id]
    );
    res.json(mapPackageRowToFrontend(rows[0]));
  } catch (error) {
    console.error(`Error in POST /api/package-requests/${id}/confirm-payment:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء تأكيد الدفع.' });
  }
});

// POST /api/package-requests/:id/start - move to PROCESSING
router.post('/package-requests/:id/start', async (req, res) => {
  const { id } = req.params;
  const { employeeId, comment } = req.body;
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    await db.query('UPDATE package_requests SET status = ?, progress_percent = ?, last_modified = ? WHERE id = ?', ['PROCESSING', 50, new Date(), id]);
    await db.query('INSERT INTO package_logs SET ?', { package_id: id, action: 'processing_started', comment: comment || '', actor_id: userId, date: new Date() });

    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
       FROM package_requests p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE p.id = ?`, [id]
    );
    res.json(mapPackageRowToFrontend(rows[0]));
  } catch (error) {
    console.error(`Error in POST /api/package-requests/${id}/start:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء بدء التنفيذ.' });
  }
});

// POST /api/package-requests/:id/mark-ready - upload shipping docs and set READY_FOR_DELIVERY
router.post('/package-requests/:id/mark-ready', upload.array('shipping_docs'), async (req, res) => {
  const { id } = req.params;
  const { employeeId, comment } = req.body;
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    let uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      uploadedFiles = await Promise.all(req.files.map(file => uploadFileToCloudinary(file, userId)));
      for (const f of uploadedFiles) {
        await db.query('INSERT INTO package_attachments SET ?', {
          package_id: id,
          type: 'shipping_doc',
          url: f.url,
          file_name: f.fileName,
          uploaded_by: userId,
          upload_date: new Date(),
        });
      }
    }

    await db.query('UPDATE package_requests SET status = ?, progress_percent = ?, last_modified = ? WHERE id = ?', ['READY_FOR_DELIVERY', 75, new Date(), id]);
    await db.query('INSERT INTO package_logs SET ?', { package_id: id, action: 'marked_ready', comment: comment || '', actor_id: userId, date: new Date() });

    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
       FROM package_requests p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE p.id = ?`, [id]
    );
    res.json(mapPackageRowToFrontend(rows[0]));
  } catch (error) {
    console.error(`Error in POST /api/package-requests/${id}/mark-ready:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء تجهيز الطلب.' });
  }
});

// POST /api/package-requests/:id/confirm-delivery - set DELIVERED
router.post('/package-requests/:id/confirm-delivery', async (req, res) => {
  const { id } = req.params;
  const { employeeId, comment } = req.body;
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
    const userId = userRows[0].id;

    await db.query('UPDATE package_requests SET status = ?, progress_percent = ?, last_modified = ? WHERE id = ?', ['DELIVERED', 100, new Date(), id]);
    await db.query('INSERT INTO package_logs SET ?', { package_id: id, action: 'delivery_confirmed', comment: comment || '', actor_id: userId, date: new Date() });

    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
       FROM package_requests p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE p.id = ?`, [id]
    );
    res.json(mapPackageRowToFrontend(rows[0]));
  } catch (error) {
    console.error(`Error in POST /api/package-requests/${id}/confirm-delivery:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء تأكيد الاستلام.' });
  }
});

// PUT /api/package-requests/:id - update editable fields
router.put('/package-requests/:id', async (req, res) => {
  const { id } = req.params;
  const { employeeId, title, description, customerName, customerPhone, priority, status, progressPercent } = req.body;
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (customerName !== undefined) updates.customer_name = customerName;
    if (customerPhone !== undefined) updates.customer_phone = customerPhone;
    if (priority !== undefined) updates.priority = priority;
    if (status !== undefined) updates.status = status;
    if (progressPercent !== undefined) updates.progress_percent = progressPercent;
    updates.last_modified = new Date();

    if (Object.keys(updates).length === 1 && updates.last_modified) {
      return res.status(400).json({ message: 'لا توجد حقول محدّثة.' });
    }

    const [result] = await db.query('UPDATE package_requests SET ? WHERE id = ?', [updates, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'الطلب غير موجود.' });
    }

    const [rows] = await db.query(
      `SELECT p.*, u.username as employee_id_username, u.full_name as employee_full_name, b.name as branch_name
       FROM package_requests p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE p.id = ?`, [id]
    );
    res.json(mapPackageRowToFrontend(rows[0]));
  } catch (error) {
    console.error(`Error in PUT /api/package-requests/${id}:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء تعديل الطلب.' });
  }
});

// DELETE /api/package-requests/:id - delete
router.delete('/package-requests/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM package_attachments WHERE package_id = ?', [id]);
    await db.query('DELETE FROM package_logs WHERE package_id = ?', [id]);
    const [result] = await db.query('DELETE FROM package_requests WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'الطلب غير موجود.' });
    }
    res.status(200).json({ message: 'تم حذف الطلب بنجاح.' });
  } catch (error) {
    console.error(`Error in DELETE /api/package-requests/${id}:`, error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء حذف الطلب.' });
  }
});

module.exports = router;