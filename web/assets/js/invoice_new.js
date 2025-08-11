const $ = (s)=> document.querySelector(s);
async function fillLists(){
  const s = await fetch('/api/suppliers').then(r=>r.json());
  if(s.ok) $('#suppliersList').innerHTML = s.data.map(x=>`<option value="${x.name}">`).join('');
  const c = await fetch('/api/categories').then(r=>r.json());
  if(c.ok) $('#catsList').innerHTML = c.data.map(x=>`<option value="${x.name}">`).join('');
}
function recalc(){
  const amt = Number($('#amountBeforeTax').value || 0);
  const tax = Number($('#taxAmount').value || 0);
  const total = Math.round((amt + tax) * 100)/100;
  $('#totalAmount').textContent = total.toFixed(2);
}
['amountBeforeTax','taxAmount'].forEach(id=> $('#'+id).addEventListener('input', recalc));

$('#f').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('#msg').textContent = 'جارٍ الحفظ...';

  // 1) أنشئ الفاتورة (JSON)
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
  const invRes = await fetch('/api/invoices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const invOut = await invRes.json();
  if(!invOut.ok){ $('#msg').textContent = invOut.error || 'فشل حفظ الفاتورة'; return; }

  // 2) ارفع الملف إن وُجد
  const f = $('#file').files[0];
  if (f){
    const fd = new FormData(); fd.append('file', f);
    await fetch(`/api/invoices/${invOut.data.id}/files`, { method: 'POST', body: fd });
  }

  $('#msg').textContent = 'تم إنشاء الفاتورة ✅';
  e.target.reset(); recalc();
});

fillLists(); recalc();
