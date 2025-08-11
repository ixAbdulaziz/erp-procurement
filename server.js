const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config();
const prisma = require('./db');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// ====== Uploads (مؤقت على السيرفر) ======
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('صيغة ملف غير مدعومة (PDF/PNG/JPG/WEBP فقط)'));
  }
});
app.use('/uploads', express.static(uploadDir));

// ====== Helpers ======
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
const r2 = (n)=> Math.round(Number(n) * 100) / 100;

// ====== Health ======
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

// ====== Suppliers (اسم فقط) ======
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

// قائمة الموردين مع إحصائيات (إجمالي فواتير/مدفوع/مستحق)
app.get('/api/suppliers/with-stats', async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT s.id, s.name, s."createdAt",
             COALESCE(SUM(i."totalAmount"),0) AS "totalInvoices",
             COALESCE(SUM(p.amount),0)        AS "totalPaid"
      FROM "Supplier" s
      LEFT JOIN "Invoice"  i ON i."supplierId" = s.id
      LEFT JOIN "Payment"  p ON p."invoiceId"  = i.id
      GROUP BY s.id, s.name, s."createdAt"
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

// ملخص مورد: فواتير + مدفوعات + مجاميع
app.get('/api/suppliers/:id/summary', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) return res.status(404).json({ ok: false, error: 'المورد غير موجود' });

    const invoices = await prisma.invoice.findMany({
      where: { supplierId: id },
      include: { category: true, payments: true },
      orderBy: { invoiceDate: 'desc' }
    });

    const invData = invoices.map(x => {
      const paid = r2(x.payments.reduce((s,p)=> s + Number(p.amount), 0));
      const due = r2(Number(x.totalAmount) - paid);
      return {
        id: x.id, invoiceNumber: x.invoiceNumber, categoryName: x.category?.name || null,
        invoiceDate: x.invoiceDate,
        amountBeforeTax: Number(x.amountBeforeTax),
        taxAmount: Number(x.taxAmount),
        totalAmount: Number(x.totalAmount),
        notes: x.notes || null,
        paid, due
      };
    });

    const payments = invoices.flatMap(x => x.payments.map(p => ({
      id: p.id, invoiceId: x.id, invoiceNumber: x.invoiceNumber,
      amount: Number(p.amount), paidAt: p.paidAt, note: p.note || null
    }))).sort((a,b)=> new Date(b.paidAt) - new Date(a.paidAt));

    const totals = {
      totalInvoices: r2(invData.reduce((s,x)=> s + x.totalAmount, 0)),
      totalPaid: r2(payments.reduce((s,p)=> s + p.amount, 0)),
      due: 0
    };
    totals.due = r2(totals.totalInvoices - totals.totalPaid); // الصيغة الصحيحة

    res.json({ ok: true, supplier: { id: supplier.id, name: supplier.name }, invoices: invData, payments, totals });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ====== Categories ======
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

// ====== Invoices ======
// إنشاء فاتورة (مبلغ ضريبة مباشرة + ملاحظات + يحسب المجموع)
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
    const vatRate = amt > 0 ? r2(tax / amt) : 0; // نخزن النسبة للاستفادة لاحقًا فقط

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

// قائمة فواتير عامة (لو احتجناها)
app.get('/api/invoices', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const where = search
      ? { OR: [{ invoiceNumber: { contains: String(search), mode: 'insensitive' } },
               { supplier: { name: { contains: String(search), mode: 'insensitive' } } }] }
      : {};
    const items = await prisma.invoice.findMany({
      where,
      include: { supplier: { select: { name: true } }, category: { select: { name: true } }, payments: { select: { amount: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const data = items.map(x => {
      const paid = r2(x.payments.reduce((s,p)=> s + Number(p.amount), 0));
      const due  = r2(Number(x.totalAmount) - paid);
      return {
        id: x.id, supplierName: x.supplier.name, invoiceNumber: x.invoiceNumber,
        categoryName: x.category?.name || null, invoiceDate: x.invoiceDate,
        amountBeforeTax: Number(x.amountBeforeTax), taxAmount: Number(x.taxAmount),
        totalAmount: Number(x.totalAmount), notes: x.notes || null, paid, due
      };
    });
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

// تفاصيل فاتورة + مدفوعات
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const x = await prisma.invoice.findUnique({
      where: { id },
      include: { supplier: { select: { name: true } }, category: { select: { name: true } }, payments: true, files: true }
    });
    if (!x) return res.status(404).json({ ok: false, error: 'غير موجودة' });
    const paid = r2(x.payments.reduce((s,p)=> s + Number(p.amount), 0));
    const due  = r2(Number(x.totalAmount) - paid);
    res.json({ ok: true, data: x, summary: { paid, due } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// إضافة دفعة
app.post('/api/invoices/:id/payments', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { amount, paidAt, note } = req.body || {};
    const a = Number(amount);
    if (Number.isNaN(a) || a <= 0) return res.status(400).json({ ok: false, error: 'مبلغ غير صالح' });

    const inv = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!inv) return res.status(404).json({ ok: false, error: 'الفاتورة غير موجودة' });

    const alreadyPaid = inv.payments.reduce((s,p)=> s + Number(p.amount), 0);
    if (r2(alreadyPaid + a) - Number(inv.totalAmount) > 0.0001)
      return res.status(400).json({ ok: false, error: 'إجمالي المدفوعات يتجاوز إجمالي الفاتورة' });

    await prisma.payment.create({ data: { invoiceId: id, amount: a, paidAt: paidAt ? new Date(paidAt) : new Date(), note: note || null } });
    const paid = r2(alreadyPaid + a);
    const due  = r2(Number(inv.totalAmount) - paid);
    res.status(201).json({ ok: true, paid, due });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ====== Static UI ======
app.use(express.static(path.join(__dirname, 'web')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'web', 'index.html')));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
