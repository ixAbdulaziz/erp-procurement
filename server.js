const path = require('path');
const express = require('express');
require('dotenv').config();

const prisma = require('./db'); // اتصال قاعدة البيانات

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// صحة خدمة الـ API
app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'erp-procurement',
    time: new Date().toISOString()
  });
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

// تقديم الواجهة
app.use(express.static(path.join(__dirname, 'web')));

// fallback لأي مسار آخر
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
