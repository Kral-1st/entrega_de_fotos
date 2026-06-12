module.exports = {
  apps: [
    {
      name: 'entrega-fotos-api',
      script: 'server/index.js',
      cwd: '/mnt/almacenamiento/server/entrega_de_fotos',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/mnt/almacenamiento/server/entrega_de_fotos/logs/error.log',
      out_file: '/mnt/almacenamiento/server/entrega_de_fotos/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
}
