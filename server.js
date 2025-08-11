const path = require('path');
const express = require('express');
require('dotenv').config();
const prisma = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// صحة الـ API
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'erp-procurement', time: new Date().toISOString() });
});

// صحة قاعدة البيانات
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

/* -------- Suppliers -------- */

// إنشاء مورد (مع منع التكرار بالاسم بدون حساسية أحرف)
app.post('/api/suppliers', async (req, res) => {
  try {
    const { name, vatNumber, contactName, phone, email, address, status } = req.body || {};
    const cleanName = (name || '').trim();
    if (!cleanName) return res.status(400).json({ ok: false, error: 'اسم المورد مطلوب' });

    const exists = await prisma.supplier.findFirst({
      where: { name: { equals: cleanName, mode: 'insensitive' } }
    });
    if (exists) return res.status(409).json({ ok: false, error: 'المورد موجود مسبقًا' });

    const supplier = await prisma.supplier.create({
      data: { name: cleanName, vatNumber, contactName, phone, email, address, status: status || 'active' }
    });
    res.status(201).json({ ok: true, data: supplier });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// قائمة الموردين + بحث
app.get('/api/suppliers', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const where = search
      ? { name: { contains: String(search), mode: 'insensitive' } }
      : {};
    const items = await prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    res.json({ ok: true, data: items, total: items.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// تعديل مورد
app.patch('/api/suppliers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, vatNumber, contactName, phone, email, address, status } = req.body || {};

    if (name) {
      const cleanName = String(name).trim();
      const exists = await prisma.supplier.findFirst({
        where: { id: { not: id }, name: { equals: cleanName, mode: 'insensitive' } }
      });
      if (exists) return res.status(409).json({ ok: false, error: 'اسم المورد مستخدم' });
    }

    const updated = await prisma.supplier.update({
      where: { id },
      data: { name, vatNumber, contactName, phone, email, address, status }
    });
    res.json({ ok: true, data: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* -------- Categories -------- */

// إنشاء فئة (إن وُجدت يرجّع الموجودة)
app.post('/api/categories', async (req, res) => {
  try {
    const { name } = req.body || {};
    const clean = (name || '').trim();
    if (!clean) return res.status(400).json({ ok: false, error: 'اسم الفئة مطلوب' });

    const existed = await prisma.category.findFirst({
      where: { name: { equals: clean, mode: 'insensitive' } }
    });
    if (existed) return res.json({ ok: true, data: existed, existed: true });

    const cat = await prisma.category.create({ data: { name: clean } });
    res.status(201).json({ ok: true, data: cat });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// قائمة الفئات
app.get('/api/categories', async (_req, res) => {
  try {
    const items = await prisma.category.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, data: items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* -------- Static UI -------- */
app.use(express.static(path.join(__dirname, 'web')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'web', 'index.html')));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
