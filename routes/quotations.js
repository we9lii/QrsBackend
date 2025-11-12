const express = require('express');
const router = express.Router();
const db = require('../db.js');

// List saved quotations (summary for cards)
router.get('/quotations', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT q.id, q.quote_number, q.quote_date, q.customer_name, q.location, q.mobile,
              COALESCE(SUM(i.total_with_tax), 0) AS total_with_tax,
              q.created_at
         FROM quotations q
         LEFT JOIN quotation_items i ON i.quotation_id = q.id
         GROUP BY q.id
         ORDER BY q.created_at DESC, q.quote_date DESC`
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error in GET /api/quotations:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء جلب عروض الأسعار.' });
  }
});

// Create/save a quotation with its items
router.post('/quotations', async (req, res) => {
  try {
    const {
      quote_number,
      quote_date,
      customer_name,
      location,
      mobile,
      items,
    } = req.body || {};

    if (!customer_name || !quote_number) {
      return res.status(400).json({ message: 'يجب إدخال اسم العميل ورقم العرض.' });
    }

    const payload = {
      quote_number: String(quote_number),
      quote_date: quote_date ? new Date(quote_date) : new Date(),
      customer_name: String(customer_name),
      location: location ? String(location) : null,
      mobile: mobile ? String(mobile) : null,
      created_at: new Date(),
    };

    const [result] = await db.query('INSERT INTO quotations SET ?', payload);
    const quotationId = result.insertId;

    const itemsArr = Array.isArray(items) ? items : [];
    for (const it of itemsArr) {
      const itemPayload = {
        quotation_id: quotationId,
        category: it.category ? String(it.category) : 'الاقتصادي',
        horsepower: it.horsepower ? String(it.horsepower) : null,
        capacity_kw: it.capacity_kw !== undefined && it.capacity_kw !== null ? Number(it.capacity_kw) : null,
        price_per_kw: it.price_per_kw !== undefined && it.price_per_kw !== null ? Number(it.price_per_kw) : null,
        total_before_tax: it.total_before_tax !== undefined && it.total_before_tax !== null ? Number(it.total_before_tax) : null,
        vat15: it.vat15 !== undefined && it.vat15 !== null ? Number(it.vat15) : null,
        total_with_tax: it.total_with_tax !== undefined && it.total_with_tax !== null ? Number(it.total_with_tax) : null,
      };
      await db.query('INSERT INTO quotation_items SET ?', itemPayload);
    }

    const [summaryRows] = await db.query(
      `SELECT q.id, q.quote_number, q.quote_date, q.customer_name, q.location, q.mobile,
              COALESCE(SUM(i.total_with_tax), 0) AS total_with_tax,
              q.created_at
         FROM quotations q
         LEFT JOIN quotation_items i ON i.quotation_id = q.id
         WHERE q.id = ?
         GROUP BY q.id`,
      [quotationId]
    );
    res.status(201).json(summaryRows[0]);
  } catch (error) {
    console.error('Error in POST /api/quotations:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء حفظ عرض السعر.' });
  }
});

// Fetch single quotation with items
router.get('/quotations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [qRows] = await db.query(
      `SELECT id, quote_number, quote_date, customer_name, location, mobile, created_at
         FROM quotations WHERE id = ? OR quote_number = ? LIMIT 1`,
      [id, id]
    );
    if (!qRows || qRows.length === 0) {
      return res.status(404).json({ message: 'لم يتم العثور على عرض السعر.' });
    }
    const quotation = qRows[0];

    const [items] = await db.query(
      `SELECT id, category, horsepower, capacity_kw, price_per_kw, total_before_tax, vat15, total_with_tax
         FROM quotation_items WHERE quotation_id = ?
         ORDER BY FIELD(category, 'الأفضل','الجيد','الاقتصادي','الأدنى'), id ASC`,
      [quotation.id]
    );

    return res.status(200).json({
      id: quotation.id,
      quote_number: quotation.quote_number,
      quote_date: quotation.quote_date,
      customer_name: quotation.customer_name,
      location: quotation.location,
      mobile: quotation.mobile,
      created_at: quotation.created_at,
      items,
    });
  } catch (error) {
    console.error('Error in GET /api/quotations/:id:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء جلب تفاصيل عرض السعر.' });
  }
});

module.exports = router;