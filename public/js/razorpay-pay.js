(function () {
  function qs(name) {
    const p = new URLSearchParams(location.search);
    return p.get(name);
  }

  function ensure(val, msg) {
    if (!val) throw new Error(msg);
    return val;
  }

  document.addEventListener('DOMContentLoaded', function () {
    try {
      // Required params from query
      const order_id = ensure(qs('order_id'), 'Missing order_id');
      const name     = ensure(qs('name'),     'Missing name');
      const number   = ensure(qs('number'),   'Missing number');
      const email    = ensure(qs('email'),    'Missing email');
      const amount   = ensure(qs('amount'),   'Missing amount'); // in paise or rupees? keep same as server-created order
      const userid   = qs('userid') || '';
      const address  = qs('address') || '';
      const type     = qs('type') || 'subscription';

      const key = 'rzp_test_htmhBsjoS9btm0' ; // optional if you inject globally; otherwise hardcode in HTML via EJS
      const options = {
        key: key || "rzp_test_htmhBsjoS9btm0",
        order_id,
        name: 'MyApp',
        description: 'Order ' + order_id,
        image: '/images/logo.jpg',
        amount: amount, // Razorpay ignores this when order_id present; fine to pass
        currency: 'INR',
        prefill: { name, email, contact: number },
        notes: { address, userid, type },
        theme: { color: '#c9a03b' },
        handler: function (resp) {
          // Success: redirect to your success page (or call a verify endpoint)
          const url = `/payment/razorpay-success?orderid=${encodeURIComponent(order_id)}`
                    + `&amount=${encodeURIComponent(amount)}&name=${encodeURIComponent(name)}`
                    + `&userid=${encodeURIComponent(userid)}&address=${encodeURIComponent(address)}`
                    + `&razorpay_payment_id=${encodeURIComponent(resp.razorpay_payment_id)}`
                    + `&razorpay_signature=${encodeURIComponent(resp.razorpay_signature)}`
                    + `&razorpay_order_id=${encodeURIComponent(resp.razorpay_order_id)}`
                    + `&type=${encodeURIComponent(type)}`;
          location.href = url;
        },
        modal: {
          ondismiss: function () {
            // User closed the modal
            location.href = '/payment/razorpay-response';
          }
        }
      };

      const rzp = new Razorpay(options);
      rzp.on('payment.failed', function (res) {
        alert(res.error.description || 'Payment failed');
      });
      rzp.open();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Could not start payment');
    } finally {
      const overlay = document.getElementById('loader-overlay');
      if (overlay) overlay.style.display = 'none';
    }
  });
})();
