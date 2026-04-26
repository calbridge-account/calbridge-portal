module.exports = {
  apps: [{
    name: 'vendor-backfill',
    script: './run_vendor_backfill.js',
    autorestart: false,
    watch: false,
    output: '/tmp/vendor_backfill.log',
    error: '/tmp/vendor_backfill_err.log',
    env: { NODE_ENV: 'production' }
  }]
};
