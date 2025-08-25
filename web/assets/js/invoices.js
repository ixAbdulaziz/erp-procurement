// invoices.js — عرض الموردين كبطاقات مع تثبيت وبحث
const el = s => document.querySelector(s);
const fmtSAR = n => Number(n||0).toLocaleString('ar-SA',{style:'currency',currency:'SAR'});

const pinnedKey = 'erp-pinned-suppliers';

// اقرأ/اكتب المثبتين من localStorage
function getPinned(){
  try{ return JSON.parse(localStorage.getItem(pinnedKey)||'[]'); }catch{ return []; }
}
function setPinned(list){
  localStorage.setItem(pinnedKey, JSON.stringify(Array.from(new Set(list))));
}

// تحميل الموردين مع الإحصائيات
async function loadSuppliers(){
  const r = await fetch('/api/suppliers/with-stats');
  const out = await r.json();
  if(!out.ok){ console.error(out.error); return {pinned:[], others:[]}; }

  const pinnedIds = new Set(getPinned());
  const pinned = [];
  const others = [];

  // قسّم حسب التثبيت
  out.data.forEach(s=>{
    const card = {
      id: s.id,
      name: s.name,
      totalInvoices: Number(s.totalInvoices||0),
      totalPaid: Number(s.totalPaid||0),
      due: Number((s.totalInvoices||0) - (s.totalPaid||0))
    };
    if (pinnedIds.has(s.id)) pinned.push(card); else others.push(card);
  });

  // رتّب: المستحق الأعلى أولًا
  pinned.sort((a,b)=> b.due - a.due || a.name.localeCompare(b.name,'ar'));
  others.sort((a,b)=> b.due - a.due || a.name.localeCompare(b.name,'ar'));

  return { pinned, others };
}

// يبني بطاقة مورد
function supplierCard(s, isPinned){
  const pinTitle = isPinned ? 'إزالة التثبيت' : 'تثبيت المورد';
  const pinClass = 'supplier-pin' + (isPinned ? ' active' : '');
  const link = `/supplier.html?id=${s.id}`;
  const wrap = document.createElement('div');
  wrap.className = 'supplier-card';
  wrap.dataset.sid = s.id;

  wrap.innerHTML = `
    <div class="supplier-head">
      <div class="supplier-name">${s.name}</div>
      <div class="${pinClass}" title="${pinTitle}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2l-1 5 5 5-3 3-5-5-5 1 8-8zM5 21l6-6"/></svg>
        <span>${isPinned ? 'مثبّت' : 'تثبيت'}</span>
      </div>
    </div>

    <div class="metric count">
      <span class="label">عدد الفواتير</span>
      <span class="value" data-k="count">—</span>
    </div>
    <div class="metric bill">
      <span class="label">إجمالي الفواتير</span>
      <span class="value">${fmtSAR(s.totalInvoices)}</span>
    </div>
    <div class="metric paid">
      <span class="label">المدفوعات</span>
      <span class="value">${fmtSAR(s.totalPaid)}</span>
    </div>
    <div class="metric due">
      <span class="label">المستحق</span>
      <span class="value">${fmtSAR(s.due)}</span>
    </div>

    <div class="card-actions">
      <a class="btn" href="${link}" title="عرض التفاصيل">
        عرض التفاصيل
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l1.41 1.41L8.83 10H20v2H8.83l4.58 4.59L12 18l-8-8z"/></svg>
      </a>
    </div>
  `;

  // زر التثبيت
  const pin = wrap.querySelector('.supplier-pin');
  pin.addEventListener('click', ()=>{
    const list = getPinned();
    if (isPinned) {
      setPinned(list.filter(id=> id !== s.id));
    } else {
      list.push(s.id); setPinned(list);
    }
    render(); // أعدّ التحميل
  });

  // تحميل عدد الفواتير لاحقًا لتقليل الضغط
  fetch(`/api/suppliers/${s.id}/summary`)
    .then(r=>r.json())
    .then(o=>{
      if(o.ok){
        const c = o.invoices?.length ?? 0;
        const span = wrap.querySelector('[data-k="count"]');
        if (span) span.textContent = c;
      }
    })
    .catch(()=>{});

  return wrap;
}

// يرسم الصفحة كاملة
async function render(){
  const { pinned, others } = await loadSuppliers();

  const pinnedWrap = el('#pinnedWrap');
  const othersWrap = el('#othersWrap');
  pinnedWrap.innerHTML = ''; othersWrap.innerHTML = '';

  pinned.forEach(s=> pinnedWrap.appendChild(supplierCard(s, true)));
  others.forEach(s=> othersWrap.appendChild(supplierCard(s, false)));

  el('#pinnedEmpty').style.display = pinned.length ? 'none' : '';
  el('#othersEmpty').textContent = others.length ? '' : 'لا يوجد موردون.';
}

// بحث محلي على المسميات
function bindSearch(){
  const Q = el('#search');
  Q.addEventListener('input', ()=>{
    const v = Q.value.trim();
    document.querySelectorAll('.supplier-card').forEach(card=>{
      const name = (card.querySelector('.supplier-name')?.textContent || '').trim();
      card.style.display = v && !name.includes(v) ? 'none' : '';
    });
  });
}

el('#btnRefresh')?.addEventListener('click', render);
el('#btnAll')?.addEventListener('click', ()=>{
  el('#search').value = ''; document.querySelectorAll('.supplier-card').forEach(c=> c.style.display='');
});

bindSearch();
render();
