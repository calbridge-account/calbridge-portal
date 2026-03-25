// Auth check
(async () => {
  try {
    const r = await fetch('/auth/me', { credentials: 'include' });
    if (!r.ok) { window.location.href = '/'; return; }
    const { client } = await r.json();
    document.getElementById('client-name').textContent = client.name || client.email;

    // Load logo
    const profileRes = await fetch('/account/profile', { credentials: 'include' });
    const profile = await profileRes.json();
    if (profile.logoUrl) {
      const logoEl = document.getElementById('sidebar-logo-img');
      if (logoEl) logoEl.src = profile.logoUrl;
    }
  } catch { window.location.href = '/'; }
})();

// Logout
document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/';
});

// Search
const searchInput = document.getElementById('glossary-search-input');
const noResults   = document.getElementById('no-results');
const searchQuery = document.getElementById('search-query');
const terms       = document.querySelectorAll('.glossary-term');
const categories  = document.querySelectorAll('.glossary-category');

searchInput?.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();

  if (!q) {
    terms.forEach(t => t.style.display = '');
    categories.forEach(c => c.style.display = '');
    noResults.style.display = 'none';
    return;
  }

  let totalVisible = 0;
  categories.forEach(cat => {
    let visibleInCat = 0;
    cat.querySelectorAll('.glossary-term').forEach(term => {
      const text = term.textContent.toLowerCase();
      if (text.includes(q)) {
        term.style.display = '';
        visibleInCat++;
        totalVisible++;
      } else {
        term.style.display = 'none';
      }
    });
    cat.style.display = visibleInCat > 0 ? '' : 'none';
  });

  if (totalVisible === 0) {
    noResults.style.display = 'block';
    searchQuery.textContent = searchInput.value;
  } else {
    noResults.style.display = 'none';
  }
});
