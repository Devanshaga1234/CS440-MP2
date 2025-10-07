const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/fd',
    createProxyMiddleware({
      target: 'https://financialdata.net',
      changeOrigin: true,
      pathRewrite: { '^/fd': '' },
      secure: true,
    })
  );

  app.use(
    '/logokit',
    createProxyMiddleware({
      target: 'https://api.logokit.com',
      changeOrigin: true,
      pathRewrite: { '^/logokit': '' },
      secure: true,
    })
  );
};



