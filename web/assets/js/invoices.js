const $ = (s)=> document.querySelector(s);

async function fetchList(q=''){
  const r = await fetch('/api/invoices?search='+encodeURIComponent(q));
  return r.json();
}
async function pay(id, amount){
  const r = await fetch(`/api/invoices/${id}/payments`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ amount: Number(amount), paidAt: new Date().toISOString().slice(0,10) })
  });
  return r.json();
}

async function render(q=''){
  const t = $('#tbl tbody');
  t.innerHTML = '<tr><td colspan="10">جارٍ التحميل...</td></tr>';
  const out = await fetchList(q);
  if (!out.ok) { t.innerHTML = `<tr><td colspan="10">${out.error||'خطأ'}</td></tr>`; return; }
  if (out.data.length === 0) { t.innerHTML = '<tr><td colspan="10">لا يوجد فواتير</td></tr>'; return; }
  t.innerHTML = out.data.map(x=>`
    <tr>
      <td>${new Date(x.invoiceDate).toLocaleDateString('ar-SA')}</td>
      <td>${x.supplierName}</td>
      <td>${x.invoiceNumber}</td>
      <td>${x.categoryName || ''}</td>
      <td>${x.amountBeforeTax.toFixed(2)}</td>
      <td>${x.taxAmount.toFixed(2)}</td>
      <td>${x.totalAmount.toFixed(2)}</td>
      <td>${x.paid.toFixed(2)}</td>
      <td>${x.due.toFixed(2)}</td>
      <td><button data-id="${x.id}" class="paybtn">سداد</button></td>
    </tr>
  `).join('');

  t.querySelectorAll('.paybtn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      const amount = prompt('قيمة الدفعة؟');
      if (!amount) return;
      $('#msg').textContent = 'جارٍ تسجيل الدفعة...';
      const out = await pay(id, amount);
      if(out.ok){ $('#msg').textContent = 'تم السداد ✅'; render($('#q').value); }
      else { $('#msg').textContent = out.error || 'فشل السداد'; }
    });
  });
}

$('#q').addEventListener('input', e=> render(e.target.value));
render();
