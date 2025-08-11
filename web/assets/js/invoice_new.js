const $ = (s)=> document.querySelector(s);
async function fillLists(){
  const s = await fetch('/api/suppliers').then(r=>r.json());
  if(s.ok) $('#suppliersList').innerHTML = s.data.map(x=>`<option value="${x.name}">`).join('');
  const c = await fetch('/api/categories').then(r=>r.json());
  if(c.ok) $('#catsList').innerHTML = c.data.map(x=>`<option value="${x.name}">`).join('');
}
function recalc(){
  const amt = Number($('#amountBeforeTax').value || 0);
  const rate = Number($('#vatRate').value || 0);
  const tax = Math.round(amt * rate * 100)/100;
  const total = Math.round((amt + tax) * 100)/100;
  $('#taxAmount').textContent = tax.toFixed(2);
  $('#totalAmount').textContent = total.toFixed(2);
}
['amountBeforeTax','vatRate'].forEach(id=> $('#'+id).addEventListener('input', recalc));

$('#f').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('#msg').textContent = 'جارٍ الحفظ...';
  const body = {
    supplierName: $('#supplierName').value.trim(),
    invoiceNumber: $('#invoiceNumber').value.trim(),
    description: $('#description').value || null,
    categoryName: $('#categoryName').value || null,
    invoiceDate: $('#invoiceDate').value,
    amountBeforeTax: Number($('#amountBeforeTax').value),
    vatRate: Number($('#vatRate').value || 0)
  };
  const res = await fetch('/api/invoices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const out = await res.json();
  if(out.ok){
    $('#msg').textContent = 'تم إنشاء الفاتورة ✅';
    e.target.reset(); recalc();
  } else {
    $('#msg').textContent = out.error || 'فشل الحفظ';
  }
});

fillLists(); recalc();
