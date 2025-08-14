const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmt = n => Number(n||0).toFixed(2);

// ------- قائمة أوامر الشراء -------
async function loadPOs(){
  const r = await fetch('/api/purchase-orders'); const out = await r.json();
  const t = $('#tbl tbody');
  if(!out.ok){ t.innerHTML = `<tr><td colspan="6">${out.error||'خطأ'}</td></tr>`; return; }
  if(out.data.length===0){ t.innerHTML = '<tr><td colspan="6">لا يوجد أوامر شراء</td></tr>'; return; }
  t.innerHTML = out.data.map(x=>`
    <tr>
      <td>${new Date(x.poDate).toLocaleDateString('ar-SA')}</td>
      <td>${x.poNumber}</td>
      <td>${x.supplierName}</td>
      <td>${fmt(x.amount)}</td>
      <td>${fmt(x.sumInvoices)}</td>
      <td>${x.status}</td>
    </tr>
  `).join('');
}

// ------- فتح/إغلاق المودال -------
const open = ()=> { $('#backdrop').style.display='flex'; resetForm(); preloadSuppliers(); setToday(); };
const close = ()=> { $('#backdrop').style.display='none'; };
$('#openModal').addEventListener('click', open);
$('#closeModal').addEventListener('click', close);
$('#backdrop').addEventListener('click', e=> { if(e.target.id==='backdrop') close(); });

// ------- تحميل الموردين والفواتير غير المربوطة -------
async function preloadSuppliers(){
  const r = await fetch('/api/suppliers'); const out = await r.json();
  if(out.ok) $('#suppliersList').innerHTML = out.data.map(x=>`<option value="${x.name}">`).join('');
}
async function loadUnlinkedInvoicesFor(name){
  $('#invoiceIds').innerHTML = '<option disabled>جارٍ التحميل...</option>';
  const s = await fetch('/api/suppliers?search='+encodeURIComponent(name)).then(r=>r.json());
  if(!s.ok || !s.data.length){ $('#invoiceIds').innerHTML = ''; $('#sum').textContent=''; return; }
  const id = s.data[0].id;
  const r = await fetch(`/api/suppliers/${id}/unlinked-invoices`); const out = await r.json();
  if(!out.ok){ $('#invoiceIds').innerHTML = ''; return; }
  $('#invoiceIds').innerHTML = out.data.map(x=>`
    <option value="${x.id}" data-total="${x.totalAmount}">
      ${x.invoiceNumber} — ${new Date(x.invoiceDate).toLocaleDateString('ar-SA')} — ${fmt(x.totalAmount)}
    </option>`).join('');
  updateSum();
}
function updateSum(){
  const totals = $$('#invoiceIds option:checked').map(o=> Number(o.dataset.total||0));
  const sum = totals.reduce((s,x)=> s+x, 0);
  $('#sum').textContent = `مجموع الفواتير المحددة: ${fmt(sum)}`;
}
$('#supplierName').addEventListener('change', e=> loadUnlinkedInvoicesFor(e.target.value));
$('#invoiceIds').addEventListener('change', updateSum);

function setToday(){ $('#poDate').value = new Date().toISOString().slice(0,10); }
function resetForm(){ $('#poForm').reset(); $('#invoiceIds').innerHTML=''; $('#sum').textContent=''; $('#msg').textContent=''; }

// ------- حفظ أمر الشراء (رقم تلقائي) -------
$('#poForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('#msg').textContent = 'جارٍ الحفظ...';

  // 1) إنشاء PO (بدون poNumber)
  const body = {
    supplierName: $('#supplierName').value.trim(),
    poDate: $('#poDate').value,
    amount: Number($('#amount').value),
    description: $('#description').value || null
  };
  const r1 = await fetch('/api/purchase-orders', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const o1 = await r1.json();
  if(!o1.ok){ $('#msg').textContent = o1.error || 'فشل إنشاء أمر الشراء'; return; }

  // 2) رفع ملف إن وجد
  const f = $('#file').files[0];
  if (f){
    const fd = new FormData(); fd.append('file', f);
    const r2 = await fetch(`/api/purchase-orders/${o1.data.id}/files`, { method:'POST', body: fd });
    const o2 = await r2.json().catch(()=>({}));
    if(!r2.ok || !o2.ok){ $('#msg').textContent = 'تم إنشاء أمر الشراء لكن فشل رفع الملف: '+(o2.error||''); return; }
  }

  // 3) ربط الفواتير (إن اختيرت)
  const ids = $$('#invoiceIds option:checked').map(o=> Number(o.value));
  if(ids.length){
    const r3 = await fetch(`/api/purchase-orders/${o1.data.id}/link-invoices`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ invoiceIds: ids })
    });
    const o3 = await r3.json();
    if(!o3.ok){ $('#msg').textContent = o3.error || 'فشل ربط الفواتير'; return; }
  }

  $('#msg').textContent = `تم الحفظ ✅ (رقم أمر الشراء: ${o1.data.poNumber})`;
  await loadPOs();          // حدّث القائمة
  setTimeout(()=> close(), 600); // اغلق المودال بعد لحظة
});

// تحميل القائمة عند الدخول
loadPOs();
