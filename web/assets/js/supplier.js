const $ = (s)=> document.querySelector(s);
const params = new URLSearchParams(location.search);
const supplierId = Number(params.get('id'));
const fmt = (n)=> Number(n).toFixed(2);

async function load(){
  const r = await fetch(`/api/suppliers/${supplierId}/summary`);
  const out = await r.json();
  if(!out.ok){ $('#title').textContent = 'خطأ'; return; }
  $('#title').textContent = `المورد: ${out.supplier.name}`;

  // --- المدفوعات (أعلى الصفحة) ---
  const payBody = $('#payTbl tbody');
  if(out.payments.length === 0){
    payBody.innerHTML = '<tr><td colspan="3">لا يوجد مدفوعات</td></tr>';
  } else {
    payBody.innerHTML = out.payments.map(p=>`
      <tr>
        <td>${new Date(p.paidAt).toLocaleDateString('ar-SA')}</td>
        <td>${fmt(p.amount)}</td>
        <td class="wrap">${p.note || ''}</td>
      </tr>
    `).join('');
  }
  $('#totals').textContent =
    `إجمالي الفواتير: ${fmt(out.totals.totalInvoices)} — إجمالي المدفوع: ${fmt(out.totals.totalPaid)} — المستحق: ${fmt(out.totals.due)}`;
  $('#payDate').value = new Date().toISOString().slice(0,10);

  // --- الفواتير (تأكد من ترتيب الأعمدة) ---
  const invBody = $('#invTbl tbody');
  if(out.invoices.length === 0){
    invBody.innerHTML = '<tr><td colspan="9">لا يوجد فواتير</td></tr>';
    return;
  }

  invBody.innerHTML = out.invoices.map(x=>{
    const fileCell = x.fileUrl
      ? `<a href="${x.fileUrl}" target="_blank" rel="noopener">عرض${x.filesCount>1?` (+${x.filesCount-1})`:''}</a>`
      : '—';
    // الترتيب هنا يطابق الهيدر 100%
    const cols = [
      new Date(x.invoiceDate).toLocaleDateString('ar-SA'),    // التاريخ
      x.invoiceNumber,                                        // رقم الفاتورة
      x.categoryName || '',                                   // الفئة
      x.description || '',                                    // البيان
      x.notes || '',                                          // الملاحظات
      fmt(x.amountBeforeTax),                                 // قبل الضريبة
      fmt(x.taxAmount),                                       // الضريبة
      fmt(x.totalAmount),                                     // الإجمالي
      fileCell                                                // الملف
    ];
    return `<tr>
      <td>${cols[0]}</td>
      <td>${cols[1]}</td>
      <td>${cols[2]}</td>
      <td class="wrap">${cols[3]}</td>
      <td class="wrap">${cols[4]}</td>
      <td>${cols[5]}</td>
      <td>${cols[6]}</td>
      <td>${cols[7]}</td>
      <td>${cols[8]}</td>
    </tr>`;
  }).join('');
}

// إضافة دفعة على المورد
$('#payForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('#payMsg').textContent = 'جارٍ الحفظ...';
  const body = {
    amount: Number($('#payAmount').value),
    paidAt: $('#payDate').value,
    note: $('#payNote').value || null
  };
  const r = await fetch(`/api/suppliers/${supplierId}/payments`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const out = await r.json();
  if(out.ok){ $('#payMsg').textContent = 'تمت إضافة الدفعة ✅'; $('#payForm').reset(); load(); }
  else { $('#payMsg').textContent = out.error || 'فشل الإضافة'; }
});

load();
