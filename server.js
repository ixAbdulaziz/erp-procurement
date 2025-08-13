const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config();
const prisma = require('./db');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// ===== Uploads (مؤقّت) =====
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error('نوع الملف غير مدعوم. المسموح: PDF/PNG/JPG/WEBP'));
    }
    cb(null, true);
  }
});

app.use('/uploads', express.static(uploadDir));

// ===== Helpers =====
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

// ===== Health =====
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

// ===== Suppliers (اسم فقط) =====
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

// قائمة الموردين مع مجاميع (بدون مضاعفة الجمع)
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

// ملخص مورد: فواتير + دفعات المورد + المجاميع (مع البيان/الملاحظات/الملفات)
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
  description: x.description || null,   // البيان
  notes: x.notes || null,               // الملاحظات
  amountBeforeTax: Number(x.amountBeforeTax),
  taxAmount: Number(x.taxAmount),
  totalAmount: Number(x.totalAmount),
  files: x.files.map(f => ({            // ← رجّع كل الملفات
    id: f.id, url: f.fileUrl, name: f.fileName
   }))
  }));


    const payments = await prisma.supplierPayment.findMany({
      where: { supplierId: id },
      orderBy: { paidAt: 'desc' }
    });
    const payData = payments.map(p => ({
      id: p.id, amount: Number(p.amount), paidAt: p.paidAt, note: p.note || null
    }));

    const totals = {
      totalInvoices: Math.round(invData.reduce((s,x)=> s + x.totalAmount, 0) * 100) / 100,
      totalPaid:     Math.round(payData.reduce((s,p)=> s + p.amount, 0) * 100) / 100
    };
    totals.due = Math.round((totals.totalInvoices - totals.totalPaid) * 100) / 100;

    res.json({
      ok: true,
      supplier: { id: supplier.id, name: supplier.name },
      invoices: invData,
      payments: payData,
      totals
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


// إضافة دفعة على مستوى المورد
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

    // أعد المجموعات بعد الإضافة
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

// ===== Categories =====
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

// ===== Invoices =====
// إنشاء فاتورة (مبلغ ضريبة مباشر + ملاحظات + ملف اختياري)
app.post('/api/invoices', async (req, res) => {
  try {
    const {
      supplierName, invoiceNumber, description, notes, categoryName,
      invoiceDate, amountBeforeTax, taxAmount
    } = req.body || {};
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

// قائمة فواتير عامة (بدون Paid/Due لأن السداد صار على مستوى المورد)
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
app.post('/api/invoices/:id/files', upload.single('file'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) return res.status(404).json({ ok: false, error: 'الفاتورة غير موجودة' });
    const f = req.file;
    if (!f) return res.status(400).json({ ok: false, error: 'لم يتم إرفاق ملف' });

    const rec = await prisma.invoiceFile.create({
      data: {
        invoiceId: id,
        fileUrl: `/uploads/${f.filename}`,
        fileName: f.originalname,
        contentType: f.mimetype,
        sizeBytes: f.size
      }
    });
    res.status(201).json({ ok: true, data: rec });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// تفاصيل فاتورة (بدون مدفوع/مستحق)
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

// (اختياري) تعطيل المسار القديم للدفعات على الفواتير
app.post('/api/invoices/:id/payments', (_req, res) => {
  res.status(410).json({ ok: false, error: 'تم نقل الدفعات إلى مستوى المورد: POST /api/suppliers/:id/payments' });
});

// ===== Static =====
app.use(express.static(path.join(__dirname, 'web')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'web', 'index.html')));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
