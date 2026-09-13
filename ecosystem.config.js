module.exports = {
  apps: [
    {
      name: process.env.NAME,
      script: 'server/index.js',
      cwd: process.env.CWD,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: process.env.NODE_ENV
      },
      error_file: process.env.ERROR_FILE,
      out_file: process.env.OUT_FILE,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
}
