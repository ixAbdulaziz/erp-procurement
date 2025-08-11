const $ = (s)=> document.querySelector(s);
const params = new URLSearchParams(location.search);
const supplierId = Number(params.get('id'));

function fmt(n){ return Number(n).toFixed(2); }

async function load(){
  const r = await fetch(`/api/suppliers/${supplierId}/summary`);
  const out = await r.json();
  if(!out.ok){ $('#title').textContent = 'خطأ'; return; }
  $('#title').textContent = `المورد: ${out.supplier.name}`;

  // فواتير
  const invBody = $('#invTbl tbody');
  if(out.invoices.length === 0){ invBody.innerHTML = '<tr><td colspan="8">لا يوجد فواتير</td></tr>'; }
  else {
    invBody.innerHTML = out.invoices.map(x=>`
      <tr>
        <td>${new Date(x.invoiceDate).toLocaleDateString('ar-SA')}</td>
        <td>${x.invoiceNumber}</td>
        <td>${x.categoryName || ''}</td>
        <td>${fmt(x.amountBeforeTax)}</td>
        <td>${fmt(x.taxAmount)}</td>
        <td>${fmt(x.totalAmount)}</td>
        <td>${fmt(x.paid)}</td>
        <td>${fmt(x.due)}</td>
      </tr>
    `).join('');
  }

  // قائمة الفواتير في نموذج السداد
  $('#invoiceId').innerHTML = out.invoices.map(x => `<option value="${x.id}">${x.invoiceNumber}</option>`).join('');

  // المدفوعات
  const payBody = $('#payTbl tbody');
  if(out.payments.length === 0){ payBody.innerHTML = '<tr><td colspan="4">لا يوجد مدفوعات</td></tr>'; }
  else {
    payBody.innerHTML = out.payments.map(p=>`
      <tr>
        <td>${new Date(p.paidAt).toLocaleDateString('ar-SA')}</td>
        <td>${p.invoiceNumber}</td>
        <td>${fmt(p.amount)}</td>
        <td>${p.note || ''}</td>
      </tr>
    `).join('');
  }

  // المجاميع
  $('#totals').textContent =
    `إجمالي الفواتير: ${fmt(out.totals.totalInvoices)} — إجمالي المدفوع: ${fmt(out.totals.totalPaid)} — المستحق: ${fmt(out.totals.due)}`;

  // حدّد تاريخ اليوم لنموذج السداد
  $('#payDate').value = new Date().toISOString().slice(0,10);
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
  const id = $('#invoiceId').value;
  const r = await fetch(`/api/invoices/${id}/payments`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const out = await r.json();
  if(out.ok){ $('#payMsg').textContent = 'تمت إضافة الدفعة ✅'; $('#payForm').reset(); load(); }
  else { $('#payMsg').textContent = out.error || 'فشل الإضافة'; }
});

load();
