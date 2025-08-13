const $ = (s)=> document.querySelector(s);
const params = new URLSearchParams(location.search);
const supplierId = Number(params.get('id'));
const fmt = (n)=> Number(n).toFixed(2);

async function load(){
  const r = await fetch(`/api/suppliers/${supplierId}/summary`);
  const out = await r.json();
  if(!out.ok){ $('#title').textContent = 'خطأ'; return; }
  $('#title').textContent = `المورد: ${out.supplier.name}`;

  // المدفوعات
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

  // الفواتير
  const invBody = $('#invTbl tbody');
  if(out.invoices.length === 0){
    invBody.innerHTML = '<tr><td colspan="9">لا يوجد فواتير</td></tr>';
    return;
  }

  invBody.innerHTML = out.invoices.map(x=>{
    const filesHtml = (x.files && x.files.length)
      ? x.files.map(f => `<a href="${f.url}" target="_blank" rel="noopener">${f.name || 'ملف'}</a>`).join('<br>')
      : '—';
    return `
      <tr>
        <td>${new Date(x.invoiceDate).toLocaleDateString('ar-SA')}</td>
        <td>${x.invoiceNumber}</td>
        <td>${x.categoryName || ''}</td>
        <td class="wrap">${x.description || ''}</td>
        <td class="wrap">${x.notes || ''}</td>
        <td>${fmt(x.amountBeforeTax)}</td>
        <td>${fmt(x.taxAmount)}</td>
        <td>${fmt(x.totalAmount)}</td>
        <td>${filesHtml}</td>
      </tr>
    `;
  }).join('');
}

// إضافة دفعة
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
