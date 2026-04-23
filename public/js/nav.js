/**
 * Shared sidebar behavior:
 * - Hamburger toggle on mobile
 * - Collapse/expand toggle on desktop
 * - Persists collapse state in localStorage
 * - Brand logo switching: swaps sidebar logo to active advertiser's logo
 * - Geo/marketplace selector: appears when advertiser has >1 marketplace
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

  // ── Geo / Marketplace Selector ──────────────────────────────────────────
  // Fetches the available marketplaces for the active advertiser and populates
  // #geo-selector. Hidden by default; only shown when >1 marketplace exists.
  // On change: calls POST /manager/set-marketplace, then reloads page data.
  async function loadGeoSelector() {
    const geoSelector = document.getElementById('geo-selector');
    if (!geoSelector) return;
    try {
      const resp = await fetch('/manager/active-advertiser/marketplaces', { credentials: 'include' });
      if (!resp.ok) return;
      const data = await resp.json();
      const { marketplaces = [], activeMarketplace = 'US' } = data;
      // Only show if >1 marketplace
      if (marketplaces.length <= 1) return;
      // Rebuild options (keep 'All Marketplaces' as first option)
      geoSelector.innerHTML = '<option value="all">🌐 All</option>';
      const countryFlag = {
        US: '🇺🇸', CA: '🇨🇦', UK: '🇬🇧', GB: '🇬🇧',
        DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸',
        JP: '🇯🇵', AU: '🇦🇺', IN: '🇮🇳', MX: '🇲🇽', BR: '🇧🇷'
      };
      for (const mp of marketplaces) {
        const opt = document.createElement('option');
        opt.value = mp;
        opt.textContent = (countryFlag[mp] || '') + ' ' + mp;
        if (mp === activeMarketplace) opt.selected = true;
        geoSelector.appendChild(opt);
      }
      geoSelector.style.display = '';
      geoSelector.addEventListener('change', async () => {
        const chosen = geoSelector.value;
        try {
          await fetch('/manager/set-marketplace', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketplace: chosen }),
          });
        } catch (e) {
          console.warn('[geo-selector] set-marketplace failed:', e);
        }
        // Reload page data if the page exposes a loadAll() function
        if (typeof window.loadAll === 'function') {
          window.loadAll();
        } else {
          window.location.reload();
        }
      });
    } catch (e) {
      // Silently ignore — geo selector is non-critical infrastructure
    }
  }

  // ── Nav config: lock unavailable sections ──────────────────────────────
  /**
   * Fetches /nav-config and grays out nav items that require a connection
   * the client hasn't made yet. Non-fatal — nav still works without it.
   *
   * Path → selector mapping reflects the actual nav HTML:
   *   /advertising → a[href="/advertising.html"] + a[href="/campaigns.html"] (both ads)
   *   /pacing      → a[data-section="pacing"] (dashboard #pacing anchor)
   *   /forecasting → a[data-section="forecast"] (dashboard #forecast anchor)
   *   /vendor      → a[data-section="vendor"] (future page, no-op until added)
   *   /cogs        → a[data-section="cogs"] (future page, no-op until added)
   */
  async function applyNavConfig() {
    try {
      const res = await fetch('/nav-config', { credentials: 'include' });
      if (!res.ok) return; // Not authenticated or server error — leave nav as-is
      const { config, reasons } = await res.json();

      // Map nav-config path → CSS selectors that match real nav <a> elements
      const pathSelectors = {
        '/advertising': [
          'a[href="/advertising.html"]',
          'a[href="/campaigns.html"]',        // Campaigns is also ads-gated
        ],
        '/pacing':      ['a[data-section="pacing"]'],
        '/forecasting': ['a[data-section="forecast"]'],
        '/vendor':      ['a[data-section="vendor"]',  'a[href*="vendor.html"]'],
        '/cogs':        ['a[data-section="cogs"]',    'a[href*="cogs.html"]'],
      };

      for (const [path, visibility] of Object.entries(config)) {
        const selectors = pathSelectors[path];
        if (!selectors) continue;

        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(link => {
            if (visibility === 'locked') {
              link.classList.add('nav-locked');
              link.style.opacity      = '0.45';
              link.style.pointerEvents = 'none';
              link.style.cursor       = 'not-allowed';
              // Add lock icon once
              if (!link.querySelector('.nav-lock-icon')) {
                const icon = document.createElement('span');
                icon.className   = 'nav-lock-icon';
                icon.textContent = ' 🔒';
                icon.style.fontSize = '10px';
                link.appendChild(icon);
              }
              // Tooltip with reason
              const reason = reasons && reasons[path];
              if (reason) link.title = reason;
            } else {
              // Visible — remove any previously applied locked state
              link.classList.remove('nav-locked');
              link.style.opacity      = '';
              link.style.pointerEvents = '';
              link.style.cursor       = '';
              link.title              = '';
              const icon = link.querySelector('.nav-lock-icon');
              if (icon) icon.remove();
            }
          });
        });
      }
    } catch (e) {
      // Non-fatal — nav still works, just without locked states
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Load brand logo, geo selector, and nav-config locks after DOM is ready
    loadActiveBrand();
    loadGeoSelector();
    applyNavConfig();
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
