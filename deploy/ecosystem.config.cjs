// Configuração do PM2 para o Portal Geoespacial Arqueo.
// Uso na VPS (a partir de /var/www/geoportal):
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save && pm2 startup   (siga a linha que o startup imprimir)
//
// Segredos (DATABASE_URL, JWT_SECRET, VITE_APP_ID) vêm do arquivo .env,
// carregado pelo próprio app via dotenv. Aqui só definimos variáveis não
// sensíveis; o que estiver no process.env tem precedência sobre o .env.
module.exports = {
  apps: [
    {
      name: "geoportal",
      cwd: "/var/www/geoportal",
      script: "dist/index.js",
      // Runtime puro de Node (o build já foi feito com esbuild/vite).
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: "8002",
        HOST: "127.0.0.1",
      },
    },
  ],
};
