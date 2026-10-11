module.exports = {
  apps: [
    {
      name: '180socialstudio-backend',
      script: 'node_modules/.bin/tsx',
      args: 'apps/180-social-studio-backend/src/server.ts',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 4005,
      },
    },
  ],
};
