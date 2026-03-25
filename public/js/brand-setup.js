
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    let planInfo = null;      // { plan, brandCount, limits, canAddBrand }
    let brands = [];          // array of brand objects
    let activeBrandId = null; // currently editing / viewing
    let adProfiles = [];      // discovered ad profiles
    let dspAdvertisers = [];  // discovered DSP advertisers

    // -------------------------------------------------------------------------
    // Bootstrap
    // -------------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', async () => {
      document.getElementById('logout-btn').addEventListener('click', logout);
      await loadClientName();
      await loadPlanInfo();
      await loadBrands();
      await loadAdProfiles();
      await loadDspAdvertisers();
      renderPage();
    });

    async function loadClientName() {
      try {
        const r = await fetch('/auth/me', { credentials: 'include' });
        if (!r.ok) { window.location.href = '/'; return; }
        const d = await r.json();
        document.getElementById('client-name').textContent = d.client?.name || d.name || '';
      } catch { /* silent */ }
    }

    async function loadPlanInfo() {
      try {
        const r = await fetch('/brands/plan-info', { credentials: 'include' });
        if (r.ok) planInfo = await r.json();
      } catch { /* use defaults */ }
      if (!planInfo) planInfo = { plan: 'starter', brandCount: 0, limits: { brands: 1, dsp: false, whiteLabel: false }, canAddBrand: true };
    }

    async function loadBrands() {
      try {
        const r = await fetch('/brands', { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          brands = d.brands || [];
        }
      } catch { /* silent */ }
    }

    async function loadAdProfiles() {
      try {
        const r = await fetch('/amazon/profiles', { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          adProfiles = d.profiles || [];
        }
      } catch { /* endpoint may not exist yet — TODO: implement /amazon/profiles */ }
    }

    async function loadDspAdvertisers() {
      if (!planInfo?.limits?.dsp) return;
      try {
        const r = await fetch('/amazon/dsp-advertisers', { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          dspAdvertisers = d.advertisers || [];
        }
      } catch { /* endpoint may not exist yet — TODO: implement /amazon/dsp-advertisers */ }
    }

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------
    function renderPage() {
      const plan = planInfo?.plan || 'starter';
      const isPro = ['pro', 'scale', 'enterprise'].includes(plan);
      const isScale = ['scale', 'enterprise'].includes(plan);

      // Sidebar brand switcher — Pro+ only
      if (isPro && brands.length > 0) {
        document.getElementById('brand-switcher-section').classList.remove('hidden');
        renderBrandSwitcher();
      }

      // Hide loading
      document.getElementById('loading-state').classList.add('hidden');

      if (brands.length === 0) {
        document.getElementById('no-brands-state').classList.remove('hidden');
        return;
      }

      // Show form for first (or active) brand
      activeBrandId = activeBrandId || brands[0].brandId;
      showBrandForm(activeBrandId);

      // Starter: show brand name badge in header
      if (!isPro) {
        document.getElementById('starter-brand-header').classList.remove('hidden');
        document.getElementById('starter-brand-name').textContent = brands[0]?.name || '—';
      }

      // DSP card
      if (isScale) {
        document.getElementById('dsp-gate').classList.add('hidden');
        document.getElementById('dsp-enabled').classList.remove('hidden');
        populateDspSelect();
      }

      // White-label card — Scale+
      if (isScale) {
        document.getElementById('wl-card').style.display = 'block';
      }

      // Ads profile select
      populateAdsProfileSelect();
    }

    function renderBrandSwitcher() {
      const list = document.getElementById('brand-switcher-list');
      list.innerHTML = '';
      brands.forEach(b => {
        const li = document.createElement('li');
        li.className = 'brand-switcher-item' + (b.brandId === activeBrandId ? ' active' : '');
        li.innerHTML = `<span class="brand-dot"></span>${escHtml(b.name)}`;
        li.onclick = () => switchBrand(b.brandId);
        list.appendChild(li);
      });

      const limit = planInfo.limits.brands;
      const used = planInfo.brandCount;
      const label = limit === Infinity ? `${used} brand${used !== 1 ? 's' : ''}` : `${used} of ${limit} brands used`;
      document.getElementById('brand-usage-label').textContent = label;

      // Hide add button if at limit
      const addBtn = document.getElementById('brand-add-btn');
      addBtn.style.display = planInfo.canAddBrand ? 'block' : 'none';
    }

    function showBrandForm(brandId) {
      activeBrandId = brandId;
      const brand = brands.find(b => b.brandId === brandId);
      if (!brand) return;

      document.getElementById('brand-form-section').classList.remove('hidden');
      document.getElementById('no-brands-state').classList.add('hidden');

      document.getElementById('brand-name').value = brand.name || '';
      document.getElementById('brand-marketplace').value = brand.marketplace || 'US';

      // Update active state in switcher
      document.querySelectorAll('.brand-switcher-item').forEach((el, i) => {
        el.classList.toggle('active', brands[i]?.brandId === brandId);
      });

      // Update header subtitle
      document.getElementById('page-sub').textContent = `Editing: ${brand.name}`;

      // Starter header badge
      document.getElementById('starter-brand-name').textContent = brand.name || '—';
    }

    function switchBrand(brandId) {
      showBrandForm(brandId);
      // Re-select ads profile / dsp advertiser for this brand
      const brand = brands.find(b => b.brandId === brandId);
      if (brand) {
        document.getElementById('ads-profile-select').value = brand.adsProfileId || '';
        if (planInfo?.limits?.dsp) {
          document.getElementById('dsp-advertiser-select').value = brand.dspAdvertiserId || '';
        }
      }
    }

    function showNewBrandForm() {
      activeBrandId = null;
      document.getElementById('brand-form-section').classList.remove('hidden');
      document.getElementById('no-brands-state').classList.add('hidden');
      document.getElementById('brand-name').value = '';
      document.getElementById('brand-marketplace').value = 'US';
      document.getElementById('ads-profile-select').value = '';
      document.getElementById('page-sub').textContent = 'New brand';
      document.getElementById('save-status').textContent = '';
    }

    function populateAdsProfileSelect() {
      const sel = document.getElementById('ads-profile-select');
      // Keep the "none" option
      sel.innerHTML = '<option value="">— None / Not connected yet —</option>';
      if (adProfiles.length === 0) {
        document.getElementById('ads-profiles-empty').classList.remove('hidden');
      } else {
        document.getElementById('ads-profiles-empty').classList.add('hidden');
        adProfiles.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.profileId || p.profile_id;
          opt.textContent = `${p.name || p.profileId} (${p.marketplace || ''} ${p.type || ''})`.trim();
          sel.appendChild(opt);
        });
      }
      // Set current brand's value
      const brand = brands.find(b => b.brandId === activeBrandId);
      if (brand?.adsProfileId) sel.value = brand.adsProfileId;
    }

    function populateDspSelect() {
      const sel = document.getElementById('dsp-advertiser-select');
      sel.innerHTML = '<option value="">— None / Not connected yet —</option>';
      dspAdvertisers.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.advertiserId || a.advertiser_id;
        opt.textContent = a.name || a.advertiserId;
        sel.appendChild(opt);
      });
      const brand = brands.find(b => b.brandId === activeBrandId);
      if (brand?.dspAdvertiserId) sel.value = brand.dspAdvertiserId;
    }

    // -------------------------------------------------------------------------
    // Save
    // -------------------------------------------------------------------------
    async function saveBrand() {
      const name = document.getElementById('brand-name').value.trim();
      if (!name) { showToast('Brand name is required', 'error'); return; }

      const payload = {
        name,
        marketplace:     document.getElementById('brand-marketplace').value,
        adsProfileId:    document.getElementById('ads-profile-select').value || null,
        dspAdvertiserId: planInfo?.limits?.dsp ? (document.getElementById('dsp-advertiser-select').value || null) : null,
      };

      toggleSaving(true);

      try {
        let res, data;
        if (activeBrandId) {
          res  = await fetch(`/brands/${activeBrandId}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        } else {
          res  = await fetch('/brands', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        }
        data = await res.json();

        if (!res.ok) {
          const msg = data.message || data.error || 'Save failed';
          showToast(msg, 'error');
          document.getElementById('save-status').textContent = msg;
          document.getElementById('save-status').className = 'save-status error';
          toggleSaving(false);
          return;
        }

        // Update local state
        const savedBrand = data.brand;
        if (activeBrandId) {
          const idx = brands.findIndex(b => b.brandId === activeBrandId);
          if (idx >= 0) brands[idx] = savedBrand;
        } else {
          brands.push(savedBrand);
          activeBrandId = savedBrand.brandId;
        }

        // Reload plan info for updated count
        await loadPlanInfo();
        renderBrandSwitcher();

        document.getElementById('save-status').textContent = '✓ Saved';
        document.getElementById('save-status').className = 'save-status success';
        document.getElementById('starter-brand-name').textContent = savedBrand.name;
        showToast('Brand saved!', 'success');
      } catch (err) {
        showToast('Network error — please try again', 'error');
      }

      toggleSaving(false);
    }

    function toggleSaving(on) {
      document.getElementById('save-brand-btn').style.display = on ? 'none' : '';
      document.getElementById('saving-btn').style.display = on ? '' : 'none';
    }

    // -------------------------------------------------------------------------
    // Auth
    // -------------------------------------------------------------------------
    async function logout() {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/';
    }

    // -------------------------------------------------------------------------
    // Utils
    // -------------------------------------------------------------------------
    function escHtml(str) {
      return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function showToast(msg, type = 'info') {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = `toast ${type} show`;
      setTimeout(() => t.classList.remove('show'), 3000);
    }
  