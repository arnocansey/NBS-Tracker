require('dotenv').config();

const parseOrigins = (value) => {
  if (!value) return ['http://localhost:3001'];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS || process.env.FRONTEND_URL),
  cleaningSlaMinutes: Number(process.env.CLEANING_SLA_MINUTES || 30),
  allowAdminSignup: process.env.ALLOW_ADMIN_SIGNUP === 'true',
};
