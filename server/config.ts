import 'dotenv/config';

const config = {
  database: {
    url: process.env.DATABASE_URL || '',
  },
  auth: {
    jwtSecret: (() => {
      const s = process.env.JWT_SECRET;
      if (!s) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('[gateway] JWT_SECRET env var is required in production.');
        }
        console.warn('[gateway] JWT_SECRET is not set; using a temporary development-only secret.');
        return 'development-preview-secret';
      }
      return s;
    })(),
  },
  port: parseInt(process.env.PORT || '5000', 10),
};

export default config;
