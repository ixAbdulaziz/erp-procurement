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
    const { name, vatNumber, contactNam
