(async () => {
  const box = document.getElementById('healthBox');
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    box.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    box.textContent = 'فشل الوصول إلى /api/health: ' + e.message;
  }
})();
