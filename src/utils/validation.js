const BED_STATUSES = new Set(['AVAILABLE', 'OCCUPIED', 'CLEANING']);
const TRANSFER_STATUSES = new Set(['PENDING', 'APPROVED', 'IN_TRANSIT', 'COMPLETED', 'REJECTED']);
const PRIORITIES = new Set(['Low', 'Medium', 'High', 'Emergency']);
const ROLES = new Set(['STAFF', 'ADMIN']);

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const requireFields = (body, fields) => {
  const missing = fields.filter((field) => !normalizeString(body[field]));
  return missing.length ? `Missing required field(s): ${missing.join(', ')}` : null;
};

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

module.exports = {
  BED_STATUSES,
  TRANSFER_STATUSES,
  PRIORITIES,
  ROLES,
  normalizeString,
  requireFields,
  parsePositiveInt,
};
