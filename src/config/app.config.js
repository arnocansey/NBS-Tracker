require('dotenv').config();

const parseOrigins = (value) => {
  const defaults = ['http://localhost:3001', 'http://127.0.0.1:3001'];
  const configured = value
    ? value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    : [];

  return Array.from(new Set([...defaults, ...configured]));
};

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS || process.env.FRONTEND_URL),
  cleaningSlaMinutes: Number(process.env.CLEANING_SLA_MINUTES || 30),
  allowAdminSignup: process.env.ALLOW_ADMIN_SIGNUP === 'true',
};
