/* Contact form handler — used on teamcalbridge.com and calbridge.ai */
(function () {
  function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    const btn     = form.querySelector('.form-submit');
    const success = document.getElementById('contact-success');
    const error   = document.getElementById('contact-error');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      if (success) success.style.display = 'none';
      if (error)   error.style.display   = 'none';

      const data = {
        name:     form.querySelector('[name="name"]')?.value?.trim()    || '',
        email:    form.querySelector('[name="email"]')?.value?.trim()   || '',
        company:  form.querySelector('[name="company"]')?.value?.trim() || '',
        interest: form.querySelector('[name="interest"]')?.value        || '',
        message:  form.querySelector('[name="message"]')?.value?.trim() || '',
      };

      try {
        const res = await fetch('/contact', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(data),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Something went wrong');

        form.reset();
        if (success) {
          success.textContent = '✅ Message sent! We\'ll be in touch shortly.';
          success.style.display = 'block';
        }
      } catch (err) {
        if (error) {
          error.textContent = '❌ ' + (err.message || 'Failed to send. Please email ash@teamcalbridge.com directly.');
          error.style.display = 'block';
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Send Message →'; }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContactForm);
  } else {
    initContactForm();
  }
})();
