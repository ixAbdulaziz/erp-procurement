const path = require('path');
const express = require('express');
require('dotenv').config();
const prisma = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// -------- Helpers --------
async function findOrCreateSupplierByName(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('اسم المورد مطلوب');
  const existed = await prisma.supplier.findFirst({
    where: { name: { equals: clean, mode: 'insensitive' } }
  });
  if (existed) return existed;
  return prisma.supplier.create({ data: { name: clean } });
}
async function findOrCreateCategoryByName(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existed = await prisma.category.findFirst({
    where: { name: { equals: clean, mode: 'insensitive' } }
  });
  if (existed) return existed;
  return prisma.category.create({ data: { name: clean } });
}
function round2(n) { return Math.round(Number(n) * 100) / 100; }

// -------- Health --------
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'erp-procurement', time: new Date().toISOString() });
});
app.get('/api/db/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [suppliers, invoices, pos] = await prisma.$transaction([
      prisma.supplier.count(),
      prisma.invoice.count(),
      prisma.purchaseOrder.count()
    ]);
    res.json({ ok: true, counts: { suppliers, invoices, purchaseOrders: pos } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------- Suppliers (اسم فقط) --------
app.post('/api/suppliers', async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'اسم المورد مطلوب' });
    const exists = await prisma.supplier.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } }
    });
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

// -------- Categories --------
app.post('/api/categories', async (req, res) => {
  try {
    const clean = String(req.body?.name || '').trim();
    if (!clean) return res.status(400).json({ ok: false, error: 'اسم الفئة مطلوب' });
    const existed = await prisma.category.findFirst({
      where: { name: { equals: clean, mode: 'insensitive' } }
    });
    if (existed) return res.json({ ok: true, data: existed, existed: true });
    const cat = await prisma.category.create({ data: { name: clean } });
    res.status(201).json({ ok: true, data: cat });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/categories', async (_req, res) => {
  try {
    const items = await prisma.category.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, data: items });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// -------- Invoices --------
// إنشاء فاتورة (مع إنشاء مورد/فئة تلقائيًا)
app.post('/api/invoices', async (req, res) => {
  try {
    const {
      supplierName, invoiceNumber, description, categoryName,
      invoiceDate, amountBeforeTax, vatRate
    } = req.body || {};
    if (!supplierName || !invoiceNumber || !invoiceDate || amountBeforeTax == null)
      return res.status(400).json({ ok: false, error: 'حقول مطلوبة: اسم المورد، رقم الفاتورة، التاريخ، المبلغ قبل الضريبة' });

    const supplier = await findOrCreateSupplierByName(supplierName);
    const category = await findOrCreateCategoryByName(categoryName);

    const amt = Number(amountBeforeTax);
    const vat = vatRate == null ? 0.15 : Number(vatRate);
    if (Number.isNaN(amt) || amt < 0) return res.status(400).json({ ok: false, error: 'المبلغ غير صالح' });

    const taxAmount = round2(amt * vat);
    const totalAmount = round2(amt + taxAmount);

    let inv;
    try {
      inv = await prisma.invoice.create({
        data: {
          supplierId: supplier.id,
          categoryId: category?.id || null,
          invoiceNumber: String(invoiceNumber).trim(),
          description: description || null,
          invoiceDate: new Date(invoiceDate),
          amountBeforeTax: amt,
          vatRate: vat,
          taxAmount,
          totalAmount
        }
      });
    } catch (err) {
      // Prisma unique constraint
      if (err?.code === 'P2002') {
        return res.status(409).json({ ok: false, error: 'رقم الفاتورة مكرر لهذا المورد' });
      }
      throw err;
    }

    res.status(201).json({ ok: true, data: inv, computed: { taxAmount, totalAmount } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// قائمة الفواتير + ملخص المدفوعات
app.get('/api/invoices', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const where = search
      ? { OR: [
          { invoiceNumber: { contains: String(search), mode: 'insensitive' } },
          { supplier: { name: { contains: String(search), mode: 'insensitive' } } }
        ] }
      : {};
    const items = await prisma.invoice.findMany({
      where,
      include: {
        supplier: { select: { name: true } },
        category: { select: { name: true } },
        payments: { select: { amount: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    const data = items.map(x => {
      const paid = round2(x.payments.reduce((s,p)=> s + Number(p.amount), 0));
      const due = round2(Number(x.totalAmount) - paid);
      return {
        id: x.id,
        invoiceNumber: x.invoiceNumber,
        supplierName: x.supplier.name,
        categoryName: x.category?.name || null,
        invoiceDate: x.invoiceDate,
        amountBeforeTax: Number(x.amountBeforeTax),
        vatRate: Number(x.vatRate),
        taxAmount: Number(x.taxAmount),
        totalAmount: Number(x.totalAmount),
        paid, due
      };
    });
    res.json({ ok: true, data, total: data.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// تفاصيل فاتورة مختصرة
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const x = await prisma.invoice.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true } },
        category: { select: { name: true } },
        payments: true
      }
    });
    if (!x) return res.status(404).json({ ok: false, error: 'غير موجودة' });
    const paid = round2(x.payments.reduce((s,p)=> s + Number(p.amount), 0));
    const due = round2(Number(x.totalAmount) - paid);
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
    const newTotal = alreadyPaid + a;
    if (round2(newTotal) - Number(inv.totalAmount) > 0.0001) {
      return res.status(400).json({ ok: false, error: 'إجمالي المدفوعات يتجاوز إجمالي الفاتورة' });
    }

    await prisma.payment.create({
      data: {
        invoiceId: id,
        amount: a,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        note: note || null
      }
    });

    const paid = round2(newTotal);
    const due = round2(Number(inv.totalAmount) - paid);
    res.status(201).json({ ok: true, paid, due });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// -------- Static UI --------
app.use(express.static(path.join(__dirname, 'web')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'web', 'index.html')));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
