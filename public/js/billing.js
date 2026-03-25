
    // ── Auth / sidebar bootstrap ────────────────────────────────────────────
    (async () => {
      try {
        const r = await fetch('/auth/me', { credentials: 'include' });
        if (!r.ok) { window.location.href = '/'; return; }
        const { client } = await r.json();
        document.getElementById('client-name').textContent = client.name;
      } catch { window.location.href = '/'; }
    })();

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/';
    });

    // ── Check for redirect status from Stripe ──────────────────────────────
    const urlParams = new URLSearchParams(window.location.search);
    const statusParam = urlParams.get('status');
    const noticeEl = document.getElementById('billing-notice');

    if (statusParam === 'success') {
      noticeEl.textContent = '🎉 Your subscription is now active! Welcome aboard.';
      noticeEl.style.background = 'var(--success-bg)';
      noticeEl.style.color = 'var(--success)';
      noticeEl.style.borderLeftColor = 'var(--success)';
      noticeEl.classList.remove('hidden');
    } else if (statusParam === 'cancelled') {
      noticeEl.textContent = 'Checkout was cancelled. No changes were made.';
      noticeEl.classList.remove('hidden');
    } else if (statusParam === 'error') {
      noticeEl.textContent = '⚠️ Something went wrong processing your payment. Please try again or contact support.';
      noticeEl.style.background = 'var(--danger-bg)';
      noticeEl.style.color = 'var(--danger)';
      noticeEl.style.borderLeftColor = 'var(--danger)';
      noticeEl.classList.remove('hidden');
    }

    // Remove query param from URL without reload
    if (statusParam) {
      window.history.replaceState({}, '', '/billing.html');
    }

    // ── Load plans and current subscription ────────────────────────────────
    let currentPlan = null;
    let billingConfigured = true;

    async function loadBillingStatus() {
      try {
        const r = await fetch('/billing/status', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        currentPlan = data.plan;

        const badgeEl  = document.getElementById('current-plan-badge');
        const statusEl = document.getElementById('billing-status-text');

        if (data.plan) {
          badgeEl.textContent = data.plan.charAt(0).toUpperCase() + data.plan.slice(1);
          badgeEl.className = `plan-badge plan-badge-${data.plan}`;
          const statusText = data.status === 'active' ? 'Active' :
                             data.status === 'past_due' ? '⚠️ Payment overdue' :
                             data.status === 'cancelled' ? 'Cancelled' : data.status;
          const endsAt = data.subscriptionEndsAt
            ? new Date(data.subscriptionEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : null;
          statusEl.textContent = endsAt
            ? `${statusText} · Renews ${endsAt}`
            : statusText;
        } else {
          badgeEl.textContent = 'No Active Plan';
          badgeEl.className = 'plan-badge plan-badge-none';
          statusEl.textContent = 'You are not currently subscribed to a plan. Choose one below to get started.';
        }
      } catch (err) {
        console.warn('[Billing] Status load failed:', err);
      }
    }

    async function loadPlans() {
      try {
        const r = await fetch('/billing/plans');
        if (!r.ok) throw new Error('Failed to load plans');
        const { plans } = await r.json();
        renderPlans(plans);
      } catch (err) {
        console.error('[Billing] Plans load failed:', err);
      }
    }

    function renderPlans(plans) {
      const grid = document.getElementById('plans-grid');
      grid.innerHTML = plans.map((plan, i) => {
        const isCurrent    = plan.id === currentPlan;
        const isRecommended = plan.id === 'growth' && !currentPlan;
        return `
          <div class="plan-card ${isCurrent ? 'current-plan' : ''} ${isRecommended ? 'recommended' : ''}" style="position:relative;">
            ${isRecommended ? '<span class="recommended-badge">Most Popular</span>' : ''}
            <div class="plan-name">${plan.name}</div>
            <div class="plan-price">${plan.priceMonthly.split('/')[0]}<span>/mo</span></div>
            <div class="plan-desc">${plan.description}</div>
            <ul class="plan-features">
              ${plan.features.map(f => `<li>${f}</li>`).join('')}
            </ul>
            ${isCurrent
              ? `<button class="btn-plan btn-plan-current" disabled>✓ Current Plan</button>`
              : `<button class="btn-plan btn-plan-upgrade" onclick="startCheckout('${plan.id}')">
                   ${currentPlan ? 'Switch to ' + plan.name : 'Get Started'}
                 </button>`
            }
          </div>
        `;
      }).join('');
    }

    async function startCheckout(planId) {
      try {
        const r = await fetch('/billing/create-checkout', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ planId }),
          credentials: 'include'
        });
        const data = await r.json();
        if (r.status === 503) {
          document.getElementById('billing-unconfigured').classList.remove('hidden');
          return;
        }
        if (!r.ok) {
          alert(data.error || 'Failed to start checkout');
          return;
        }
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        }
      } catch (err) {
        alert('An error occurred. Please try again.');
        console.error('[Billing] Checkout error:', err);
      }
    }

    // Boot
    Promise.all([loadBillingStatus(), loadPlans()]).then(() => {
      // Re-render plans once status is known (to mark current plan correctly)
      loadPlans();
    });
  