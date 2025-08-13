// web/assets/js/invoice_new.js
const $ = (s) => document.querySelector(s);

async function fillLists() {
  const s = await fetch('/api/suppliers').then(r => r.json()).catch(()=>({ok:false}));
  if (s?.ok) $('#suppliersList').innerHTML = s.data.map(x => `<option value="${x.name}">`).join('');
  const c = await fetch('/api/categories').then(r => r.json()).catch(()=>({ok:false}));
  if (c?.ok) $('#catsList').innerHTML = c.data.map(x => `<option value="${x.name}">`).join('');
}

function recalc() {
  const amt = Number($('#amountBeforeTax').value || 0);
  const tax = Number($('#taxAmount').value || 0);
  const total = Math.round((amt + tax) * 100) / 100;
  $('#totalAmount').textContent = total.toFixed(2);
}

['amountBeforeTax', 'taxAmount'].forEach(id => $('#' + id).addEventListener('input', recalc));

$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#f button[type="submit"]');
  btn.disabled = true;
  $('#msg').textContent = 'جارٍ الحفظ...';

  try {
    // 1) إنشاء الفاتورة
    const body = {
      supplierName: $('#supplierName').value.trim(),
      invoiceNumber: $('#invoiceNumber').value.trim(),
      description: $('#description').value || null,
      notes: $('#notes').value || null,
      categoryName: $('#categoryName').value || null,
      invoiceDate: $('#invoiceDate').value,
      amountBeforeTax: Number($('#amountBeforeTax').value),
      taxAmount: Number($('#taxAmount').value || 0)
    };

    const invRes = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const invOut = await invRes.json().catch(() => ({}));
    if (!invRes.ok || !invOut.ok) {
      $('#msg').textContent = invOut.error || 'فشل حفظ الفاتورة';
      btn.disabled = false;
      return;
    }

    // 2) رفع الملف (اختياري) مع فحص النوع/الحجم
    const f = $('#file').files[0];
    if (f) {
      const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
      const maxBytes = 20 * 1024 * 1024; // 20MB - مطابق للسيرفر
      if (!allowed.includes(f.type)) {
        $('#msg').textContent = 'تم حفظ الفاتورة لكن نوع الملف غير مدعوم (PDF/PNG/JPG/WEBP)';
        btn.disabled = false;
        return;
      }
      if (f.size > maxBytes) {
        $('#msg').textContent = 'تم حفظ الفاتورة لكن حجم الملف أكبر من 20MB';
        btn.disabled = false;
        return;
      }

      const fd = new FormData();
      fd.append('file', f);

      const upRes = await fetch(`/api/invoices/${invOut.data.id}/files`, { method: 'POST', body: fd });
      let upOut = {};
      try { upOut = await upRes.json(); } catch {}
      if (!upRes.ok || !upOut.ok) {
        const why = (upOut && upOut.error) ? `: ${upOut.error}` : '';
        $('#msg').textContent = 'تم حفظ الفاتورة لكن فشل رفع الملف' + why;
        btn.disabled = false;
        return;
      }
    } // <-- كان هذا القوس مفقود

    // 3) نجاح كامل
    $('#msg').textContent = 'تم إنشاء الفاتورة ✅';
    e.target.reset();
    recalc();
  } catch (err) {
    console.error(err);
    $('#msg').textContent = 'حدث خطأ غير متوقع';
  } finally {
    btn.disabled = false;
  }
});

fillLists();
recalc();
