/**
 * Shared sidebar behavior:
 * - Hamburger toggle on mobile
 * - Collapse/expand toggle on desktop
 * - Persists collapse state in localStorage
 */
(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const sidebar  = document.querySelector('.sidebar');
    const main     = document.querySelector('.main-content');
    if (!sidebar) return;

    // ---- Inject hamburger (mobile) ----
    const hamburger = document.createElement('button');
    hamburger.className = 'hamburger';
    hamburger.setAttribute('aria-label', 'Menu');
    hamburger.innerHTML = '<span></span><span></span><span></span>';
    document.body.appendChild(hamburger);

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
      overlay.classList.toggle('active');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('active');
    });

    // Close mobile sidebar on nav click
    sidebar.querySelectorAll('.nav-item').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('mobile-open');
          overlay.classList.remove('active');
        }
      });
    });

    // ---- Desktop collapse toggle ----
    const toggle = document.createElement('button');
    toggle.className = 'sidebar-toggle';
    toggle.title = 'Collapse sidebar';
    toggle.textContent = '◀';
    sidebar.appendChild(toggle);

    // Restore saved state
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
      sidebar.classList.add('collapsed');
      if (main) main.style.marginLeft = '60px';
      toggle.textContent = '▶';
      toggle.title = 'Expand sidebar';
    }

    toggle.addEventListener('click', () => {
      const isCollapsed = sidebar.classList.toggle('collapsed');
      if (main) main.style.marginLeft = isCollapsed ? '60px' : 'var(--sidebar-w)';
      toggle.textContent = isCollapsed ? '▶' : '◀';
      toggle.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
      localStorage.setItem('sidebar-collapsed', isCollapsed);
    });
  });
})();
