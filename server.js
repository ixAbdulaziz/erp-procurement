const path = require('path');
const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API صحية
app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'erp-procurement',
    time: new Date().toISOString()
  });
});

// تقديم ملفات الواجهة
app.use(express.static(path.join(__dirname, 'web')));

// fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
