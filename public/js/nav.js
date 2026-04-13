/**
 * Shared sidebar behavior:
 * - Hamburger toggle on mobile
 * - Collapse/expand toggle on desktop
 * - Persists collapse state in localStorage
 * - Brand logo switching: swaps sidebar logo to active advertiser's logo
 */
(function() {
  // ── Brand logo helpers ────────────────────────────────────────────────────
  const CALBRIDGE_LOGO = '/images/calbridge-logo.png';
  const CALBRIDGE_ALT  = 'Calbridge';

  /**
   * Update the sidebar logo element to the given src/alt.
   * Uses both `id="brand-logo"` (new) and legacy `id="sidebar-logo"` /
   * `id="sidebar-logo-img"` selectors for backward compat.
   */
  function setBrandLogo(src, alt) {
    const el = document.getElementById('brand-logo')
            || document.getElementById('sidebar-logo')
            || document.getElementById('sidebar-logo-img');
    if (!el) return;
    el.src = src || CALBRIDGE_LOGO;
    el.alt = alt || CALBRIDGE_ALT;
  }

  /**
   * Fetch the active advertiser from the server and apply its logo.
   * Stores the result in window.__activeBrand for other scripts.
   */
  async function loadActiveBrand() {
    try {
      const res = await fetch('/manager/active-advertiser', { credentials: 'include' });
      if (!res.ok) return;
      const brand = await res.json();
      window.__activeBrand = brand;
      if (brand && brand.logoUrl) {
        setBrandLogo(brand.logoUrl, brand.advertiserName || CALBRIDGE_ALT);
      }
    } catch (e) {
      // Graceful fallback — keep Calbridge logo
    }
  }

  /**
   * Switch the active advertiser via the nav selector and update the logo.
   * Exported as window.__switchAdvertiser for nav HTML to call.
   */
  window.__switchAdvertiser = async function(advertiserId, advertiserName, logoUrl) {
    try {
      await fetch(`/manager/advertisers/list?advertiserId=${encodeURIComponent(advertiserId)}`, {
        credentials: 'include',
      });
    } catch (e) {
      // Non-fatal — session is updated server-side on the list call
    }
    if (logoUrl) {
      setBrandLogo(logoUrl, advertiserName || CALBRIDGE_ALT);
      if (window.__activeBrand) {
        window.__activeBrand.logoUrl        = logoUrl;
        window.__activeBrand.advertiserName = advertiserName;
        window.__activeBrand.advertiserId   = advertiserId;
      }
    } else {
      // Switching back to "All" / agency view
      setBrandLogo(CALBRIDGE_LOGO, CALBRIDGE_ALT);
      window.__activeBrand = null;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Load brand logo after DOM is ready
    loadActiveBrand();
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
      const newWidth = isCollapsed ? '60px' : 'var(--sidebar-w)';
      if (main) main.style.marginLeft = newWidth;
      toggle.style.left = isCollapsed ? 'calc(60px - 12px)' : 'calc(var(--sidebar-w) - 12px)';
      toggle.textContent = isCollapsed ? '▶' : '◀';
      toggle.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
      localStorage.setItem('sidebar-collapsed', isCollapsed);
    });

    // Set initial toggle position
    const initCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    toggle.style.left = initCollapsed ? 'calc(60px - 12px)' : 'calc(var(--sidebar-w) - 12px)';
  });
})();
