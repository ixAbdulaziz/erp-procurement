// server.js
const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config();
const prisma = require('./db');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

/* ================= Uploads (Volume-aware) ================= */
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function safeName(name) { return String(name || 'file').replace(/[^\w.\-]+/g, '_'); }

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + safeName(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) return cb(new Error('نوع الملف غير مدعوم. المسموح: PDF/PNG/JPG/WEBP'));
    cb(null, true);
  }
});

// يقدم الملفات من الـ Volume/القرص
app.use('/uploads', express.static(uploadDir));

/* ================= Helpers ================= */
const r2 = (n)=> Math.round(Number(n) * 100) / 100;

async function findOrCreateSupplierByName(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('اسم المورد مطلوب');
  const existed = await prisma.supplier.findFirst({ where: { name: { equals: clean, mode: 'insensitive' } } });
  return existed || prisma.supplier.create({ data: { name: clean } });
}
async function findOrCreateCategoryByName(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existed = await prisma.category.findFirst({ where: { name: { equals: clean, mode: 'insensitive' } } });
  return existed || prisma.category.create({ data: { name: clean } });
}

/* ================= Health ================= */
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'erp-procurement', time: new Date().toISOString() }));
app.get('/api/db/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [suppliers, invoices, pos] = await prisma.$transaction([
      prisma.supplier.count(), prisma.invoice.count(), prisma.purchaseOrder.count()
    ]);
    res.json({ ok: true, counts: { suppliers, invoices, purchaseOrders: pos } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ================= Suppliers ================= */
app.post('/api/suppliers', async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'اسم المورد مطلوب' });
    const exists = await prisma.supplier.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (exists) return res.status(409).json({ ok: false, error: 'المورد موجود مسبقًا' });
    const supplier = await prisma.supplier.create({ data: { name } });
    res.status(201).json({ ok: true, data: supplier });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/suppliers', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const where = search ? { name: { contains: String(search), mode: 'insensitive' } } : {};
    const items = await prisma.supplier.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, data: items, total: items.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.patch('/api/suppliers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body || {};
    if (name) {
      const clean = String(name).trim();
      const exists = await prisma.supplier.findFirst({
        where: { id: { not: id }, name: { equals: clean, mode: 'insensitive' } }
      });
      if (exists) return res.status(409).json({ ok: false, error: 'اسم المورد مستخدم' });
    }
    const updated = await prisma.supplier.update({ where: { id }, data: { name } });
    res.json({ ok: true, data: updated });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// قائمة الموردين مع مجاميع
app.get('/api/suppliers/with-stats', async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT s.id, s.name, s."createdAt",
             COALESCE(inv.total, 0) AS "totalInvoices",
             COALESCE(pay.total, 0) AS "totalPaid"
      FROM "Supplier" s
      LEFT JOIN (
        SELECT "supplierId", SUM("totalAmount") AS total
        FROM "Invoice" GROUP BY "supplierId"
      ) inv ON inv."supplierId" = s.id
      LEFT JOIN (
        SELECT "supplierId", SUM(amount) AS total
        FROM "SupplierPayment" GROUP BY "supplierId"
      ) pay ON pay."supplierId" = s.id
      ORDER BY s."createdAt" DESC
    `;
    const data = rows.map(r => ({
      id: Number(r.id),
      name: r.name,
      totalInvoices: Number(r.totalInvoices || 0),
      totalPaid: Number(r.totalPaid || 0),
      due: r2(Number(r.totalInvoices || 0) - Number(r.totalPaid || 0))
    }));
    res.json({ ok: true, data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ملخص مورد: فواتير + دفعات (مع البيان/الملاحظات/الملفات)
app.get('/api/suppliers/:id/summary', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) return res.status(404).json({ ok: false, error: 'المورد غير موجود' });

    const invoices = await prisma.invoice.findMany({
      where: { supplierId: id },
      include: { category: true, files: true },
      orderBy: { invoiceDate: 'desc' }
    });

    const invData = invoices.map(x => ({
      id: x.id,
      invoiceNumber: x.invoiceNumber,
      categoryName: x.category?.name || null,
      invoiceDate: x.invoiceDate,
      description: x.description || null,
      notes: x.notes || null,
      amountBeforeTax: Number(x.amountBeforeTax),
      taxAmount: Number(x.taxAmount),
      totalAmount: Number(x.totalAmount),
      files: x.files.map(f => ({ id: f.id, url: f.fileUrl, name: f.fileName }))
    }));

    const payments = await prisma.supplierPayment.findMany({
      where: { supplierId: id },
      orderBy: { paidAt: 'desc' }
    });
    const payData = payments.map(p => ({
      id: p.id, amount: Number(p.amount), paidAt: p.paidAt, note: p.note || null
    }));

    const totals = {
      totalInvoices: r2(invData.reduce((s,x)=> s + x.totalAmount, 0)),
      totalPaid:     r2(payData.reduce((s,p)=> s + p.amount, 0))
    };
    totals.due = r2(totals.totalInvoices - totals.totalPaid);

    res.json({ ok: true, supplier: { id: supplier.id, name: supplier.name }, invoices: invData, payments: payData, totals });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ================= Supplier Payments ================= */
app.post('/api/suppliers/:id/payments', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { amount, paidAt, note } = req.body || {};
    const a = Number(amount);
    if (Number.isNaN(a) || a <= 0) return res.status(400).json({ ok: false, error: 'مبلغ غير صالح' });

    const s = await prisma.supplier.findUnique({ where: { id } });
    if (!s) return res.status(404).json({ ok: false, error: 'المورد غير موجود' });

    await prisma.supplierPayment.create({
      data: { supplierId: id, amount: a, paidAt: paidAt ? new Date(paidAt) : new Date(), note: note || null }
    });

    const [invSum, paySum] = await Promise.all([
      prisma.invoice.aggregate({ _sum: { totalAmount: true }, where: { supplierId: id } }),
      prisma.supplierPayment.aggregate({ _sum: { amount: true }, where: { supplierId: id } })
    ]);
    const totalInvoices = Number(invSum._sum.totalAmount || 0);
    const totalPaid = Number(paySum._sum.amount || 0);
    const due = r2(totalInvoices - totalPaid);

    res.status(201).json({ ok: true, totals: { totalInvoices: r2(totalInvoices), totalPaid: r2(totalPaid), due } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ================= Categories ================= */
app.post('/api/categories', async (req, res) => {
  try {
    const clean = String(req.body?.name || '').trim();
    if (!clean) return res.status(400).json({ ok: false, error: 'اسم الفئة مطلوب' });
    const existed = await prisma.category.findFirst({ where: { name: { equals: clean, mode: 'insensitive' } } });
    const cat = existed || await prisma.category.create({ data: { name: clean } });
    res.status(existed ? 200 : 201).json({ ok: true, data: cat, existed: !!existed });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/categories', async (_req, res) => {
  try { res.json({ ok: true, data: await prisma.category.findMany({ orderBy: { createdAt: 'desc' } }) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ================= Invoices ================= */
app.post('/api/invoices', async (req, res) => {
  try {
    const { supplierName, invoiceNumber, description, notes, categoryName, invoiceDate, amountBeforeTax, taxAmount } = req.body || {};
    if (!supplierName || !invoiceNumber || !invoiceDate || amountBeforeTax == null)
      return res.status(400).json({ ok: false, error: 'حقول مطلوبة: اسم المورد، رقم الفاتورة، التاريخ، المبلغ قبل الضريبة' });

    const supplier = await findOrCreateSupplierByName(supplierName);
    const category = await findOrCreateCategoryByName(categoryName);

    const amt = Number(amountBeforeTax);
    const tax = Number(taxAmount || 0);
    if (Number.isNaN(amt) || amt < 0) return res.status(400).json({ ok: false, error: 'المبلغ غير صالح' });
    if (Number.isNaN(tax) || tax < 0) return res.status(400).json({ ok: false, error: 'مبلغ الضريبة غير صالح' });

    const total = r2(amt + tax);
    const vatRate = amt > 0 ? r2(tax / amt) : 0;

    let inv;
    try {
      inv = await prisma.invoice.create({
        data: {
          supplierId: supplier.id,
          categoryId: category?.id || null,
          invoiceNumber: String(invoiceNumber).trim(),
          description: description || null,
          notes: notes || null,
          invoiceDate: new Date(invoiceDate),
          amountBeforeTax: amt,
          vatRate,
          taxAmount: tax,
          totalAmount: total
        }
      });
    } catch (err) {
      if (err?.code === 'P2002') return res.status(409).json({ ok: false, error: 'رقم الفاتورة مكرر لهذا المورد' });
      throw err;
    }

    res.status(201).json({ ok: true, data: inv, computed: { totalAmount: total } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/invoices', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const where = search
      ? { OR: [{ invoiceNumber: { contains: String(search), mode: 'insensitive' } },
               { supplier: { name: { contains: String(search), mode: 'insensitive' } } }] }
      : {};
    const items = await prisma.invoice.findMany({
      where,
      include: { supplier: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const data = items.map(x => ({
      id: x.id, supplierName: x.supplier.name, invoiceNumber: x.invoiceNumber,
      categoryName: x.category?.name || null, invoiceDate: x.invoiceDate,
      amountBeforeTax: Number(x.amountBeforeTax), taxAmount: Number(x.taxAmount),
      totalAmount: Number(x.totalAmount), notes: x.notes || null
    }));
    res.json({ ok: true, data, total: data.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// رفع ملف للفاتورة
app.post('/api/invoices/:id/files', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      let msg = err.message || 'فشل رفع الملف';
      if (err.code === 'LIMIT_FILE_SIZE') msg = 'حجم الملف أكبر من الحد المسموح (حدنا 20MB)';
      return res.status(400).json({ ok: false, error: msg });
    }
    const f = req.file;
    if (!f) return res.status(400).json({ ok: false, error: 'لم يتم إرفاق ملف' });

    try {
      const id = Number(req.params.id);
      const inv = await prisma.invoice.findUnique({ where: { id } });
      if (!inv) return res.status(404).json({ ok: false, error: 'الفاتورة غير موجودة' });

      const rec = await prisma.invoiceFile.create({
        data: {
          invoiceId: id,
          fileUrl: `/uploads/${path.basename(f.path)}`,
          fileName: f.originalname,
          contentType: f.mimetype,
          sizeBytes: f.size
        }
      });
      return res.status(201).json({ ok: true, data: rec });
    } catch (e) { console.error('Upload error:', e); return res.status(500).json({ ok: false, error: 'خطأ داخلي أثناء حفظ الملف' }); }
  });
});

app.get('/api/invoices/:id/files', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const files = await prisma.invoiceFile.findMany({ where: { invoiceId: id }, orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, data: files });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/invoices/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const x = await prisma.invoice.findUnique({
      where: { id },
      include: { supplier: { select: { name: true } }, category: { select: { name: true } }, files: true }
    });
    if (!x) return res.status(404).json({ ok: false, error: 'غير موجودة' });
    res.json({ ok: true, data: x });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/invoices/:id/payments', (_req, res) => {
  res.status(410).json({ ok: false, error: 'تم نقل الدفعات إلى مستوى المورد: POST /api/suppliers/:id/payments' });
});

/* ================= Purchase Orders ================= */

// مولّد رقم أمر الشراء التلقائي
function formatPoNumber(id, poDate) {
  const d = new Date(poDate);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `PO-${y}${m}${day}-${String(id).padStart(5, '0')}`;
}

// إنشاء PO (رقم تلقائي إن لم يُرسل)
app.post('/api/purchase-orders', async (req, res) => {
  try {
    const { supplierName, poNumber, poDate, amount, description } = req.body || {};
    if (!supplierName || !poDate || amount == null)
      return res.status(400).json({ ok: false, error: 'حقول مطلوبة: اسم المورد، التاريخ، المبلغ' });

    const supplier = await findOrCreateSupplierByName(supplierName);
    const amt = Number(amount);
    if (Number.isNaN(amt) || amt < 0) return res.status(400).json({ ok: false, error: 'المبلغ غير صالح' });

    const tempNumber = `TEMP-${Date.now()}`;
    const created = await prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        poNumber: poNumber?.trim() || tempNumber,
        poDate: new Date(poDate),
        amount: amt,
        description: description || null
      }
    });

    let finalNumber = created.poNumber;
    if (!poNumber) {
      finalNumber = formatPoNumber(created.id, poDate);
      await prisma.purchaseOrder.update({ where: { id: created.id }, data: { poNumber: finalNumber } });
    }

    res.status(201).json({ ok: true, data: { ...created, poNumber: finalNumber } });
  } catch (e) {
    if (e?.code === 'P2002') return res.status(409).json({ ok: false, error: 'رقم أمر الشراء مستخدم بالفعل' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// رفع ملف لأمر الشراء (نفس الإعدادات)
app.post('/api/purchase-orders/:id/files', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      let msg = err.message || 'فشل رفع الملف';
      if (err.code === 'LIMIT_FILE_SIZE') msg = 'حجم الملف أكبر من 20MB';
      return res.status(400).json({ ok: false, error: msg });
    }
    const f = req.file;
    if (!f) return res.status(400).json({ ok: false, error: 'لم يتم إرفاق ملف' });
    try {
      const id = Number(req.params.id);
      const po = await prisma.purchaseOrder.findUnique({ where: { id } });
      if (!po) return res.status(404).json({ ok: false, error: 'أمر الشراء غير موجود' });
      const fileUrl = `/uploads/${path.basename(f.path)}`;
      await prisma.purchaseOrder.update({ where: { id }, data: { fileUrl } });
      res.status(201).json({ ok: true, fileUrl });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
});

// فواتير المورد غير المرتبطة بأي PO
app.get('/api/suppliers/:supplierId/unlinked-invoices', async (req, res) => {
  try {
    const supplierId = Number(req.params.supplierId);
    const invoices = await prisma.invoice.findMany({
      where: { supplierId, poLinks: { none: {} } },
      orderBy: { invoiceDate: 'desc' }
    });
    res.json({
      ok: true,
      data: invoices.map(x => ({
        id: x.id,
        invoiceNumber: x.invoiceNumber,
        invoiceDate: x.invoiceDate,
        totalAmount: Number(x.totalAmount)
      }))
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ربط فواتير بأمر شراء (يتحقق أن المجموع = مبلغ PO)
app.post('/api/purchase-orders/:id/link-invoices', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { invoiceIds } = req.body || {};
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0)
      return res.status(400).json({ ok: false, error: 'اختر فواتير للربط' });

    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return res.status(404).json({ ok: false, error: 'أمر الشراء غير موجود' });

    const existLinks = await prisma.poInvoice.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { invoiceId: true } });
    if (existLinks.length) {
      return res.status(409).json({ ok: false, error: `بعض الفواتير مرتبطة مسبقًا: ${existLinks.map(x=>x.invoiceId).join(', ')}` });
    }

    const invoices = await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, totalAmount: true } });
    const sum = invoices.reduce((s, x) => s + Number(x.totalAmount), 0);
    const poAmount = Number(po.amount);

    if (Math.round(sum * 100) !== Math.round(poAmount * 100)) {
      return res.status(400).json({ ok: false, error: `مجموع الفواتير (${sum.toFixed(2)}) لا يساوي مبلغ أمر الشراء (${poAmount.toFixed(2)})` });
    }

    await prisma.$transaction(invoices.map(inv => prisma.poInvoice.create({ data: { poId: id, invoiceId: inv.id } })));
    res.status(201).json({
