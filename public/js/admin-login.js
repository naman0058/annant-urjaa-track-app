(function () {
  'use strict';

  const form = document.getElementById('adminLoginForm');
  if (!form) return;

  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const submitBtn = document.getElementById('loginSubmit');
  const submitLabel = document.getElementById('loginSubmitLabel');
  const toggle = document.getElementById('passwordToggle');

  function setFieldError(input, el, message) {
    if (!input || !el) return;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      el.textContent = message;
    } else {
      input.removeAttribute('aria-invalid');
      el.textContent = '';
    }
  }

  function validateClient() {
    let ok = true;
    const emailVal = (email.value || '').trim();
    if (!emailVal) {
      setFieldError(email, emailError, 'Work email is required.');
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setFieldError(email, emailError, 'Enter a valid email address.');
      ok = false;
    } else {
      setFieldError(email, emailError, '');
    }

    const passVal = password.value || '';
    if (!passVal) {
      setFieldError(password, passwordError, 'Password is required.');
      ok = false;
    } else if (passVal.length < 6) {
      setFieldError(password, passwordError, 'Password must be at least 6 characters.');
      ok = false;
    } else {
      setFieldError(password, passwordError, '');
    }
    return ok;
  }

  if (toggle && password) {
    toggle.addEventListener('click', () => {
      const show = password.type === 'password';
      password.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
  }

  email.addEventListener('input', () => setFieldError(email, emailError, ''));
  password.addEventListener('input', () => setFieldError(password, passwordError, ''));

  let submitting = false;
  form.addEventListener('submit', (e) => {
    if (!validateClient()) {
      e.preventDefault();
      return;
    }
    if (submitting) {
      e.preventDefault();
      return;
    }
    submitting = true;
    submitBtn.disabled = true;
    submitLabel.textContent = 'Signing in...';
    const spinner = document.createElement('span');
    spinner.className = 'admin-login-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    submitBtn.insertBefore(spinner, submitBtn.firstChild);
  });
})();