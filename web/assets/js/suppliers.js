const $ = (s) => document.querySelector(s);

async function listSuppliers(q='') {
  const r = await fetch('/api/suppliers?search=' + encodeURIComponent(q));
  return r.json();
}
async function addSupplier(name) {
  const r = await fetch('/api/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  return r.json();
}

async function refresh(q='') {
  const tBody = $('#tbl tbody');
  tBody.innerHTML = '<tr><td colspan="3">جارٍ التحميل...</td></tr>';
  const out = await listSuppliers(q);
  if (!out.ok) { tBody.innerHTML = `<tr><td colspan="3">${out.error||'خطأ'}</td></tr>`; return; }
  if (out.data.length === 0) { tBody.innerHTML = '<tr><td colspan="3">لا يوجد بيانات</td></tr>'; return; }
  tBody.innerHTML = out.data.map((r, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${r.name}</td>
      <td>${new Date(r.createdAt).toLocaleString('ar-SA')}</td>
    </tr>
  `).join('');
}

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#name').value.trim();
  if (!name) return;
  $('#msg').textContent = 'جارٍ الحفظ...';
  const out = await addSupplier(name);
  if (out.ok) {
    $('#msg').textContent = 'تم الحفظ ✅';
    e.target.reset();
    refresh();
  } else {
    $('#msg').textContent = out.error || 'فشل الحفظ';
  }
});

$('#search').addEventListener('input', (e)=> refresh(e.target.value));
refresh();
