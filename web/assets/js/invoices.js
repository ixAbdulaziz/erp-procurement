const $ = (s)=> document.querySelector(s);
async function load(){
  const r = await fetch('/api/suppliers/with-stats'); const out = await r.json();
  const t = $('#tbl tbody');
  if(!out.ok){ t.innerHTML = `<tr><td colspan="4">${out.error||'خطأ'}</td></tr>`; return; }
  if(out.data.length===0){ t.innerHTML = '<tr><td colspan="4">لا يوجد موردون</td></tr>'; return; }
  t.innerHTML = out.data.map(x=>`
    <tr class="clickable" data-id="${x.id}">
      <td>${x.name}</td>
      <td>${x.totalInvoices.toFixed(2)}</td>
      <td>${x.totalPaid.toFixed(2)}</td>
      <td>${x.due.toFixed(2)}</td>
    </tr>
  `).join('');
  t.querySelectorAll('.clickable').forEach(tr=>{
    tr.addEventListener('click', ()=> location.href = `/supplier.html?id=${tr.dataset.id}`);
  });
}
load();
