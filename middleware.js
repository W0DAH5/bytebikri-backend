const jwt = require('jsonwebtoken');
const rateLimits = new Map();

function getTierLimits(tier) {
  const TIERS = {
    basic: { uploadsPerDay: 5, purchasesPerMinute: 5, proposalsPerHour: 2, loginAttempts: 5 },
    premium: { uploadsPerDay: 50, purchasesPerMinute: 20, proposalsPerHour: 10, loginAttempts: 10 }
  };
  return TIERS[tier] || TIERS.basic;
}

function checkRateLimit(userId, action) {
  const now = Date.now();
  const key = `${userId}:${action}`;
  const rec = rateLimits.get(key) || { count:0, last: now };
  const limits = getTierLimits('basic');
  let limit = 10, windowMs = 60*1000;
  switch(action){
    case 'upload': limit = limits.uploadsPerDay; windowMs = 24*60*60*1000; break;
    case 'purchase': limit = limits.purchasesPerMinute; windowMs = 60*1000; break;
    case 'proposal': limit = limits.proposalsPerHour; windowMs = 60*60*1000; break;
    case 'login': limit = limits.loginAttempts; windowMs = 60*60*1000; break;
  }
  if (Date.now() - rec.last > windowMs) { rec.count = 0; rec.last = Date.now(); }
  rec.count += 1;
  rateLimits.set(key, rec);
  return rec.count <= limit;
}

async function verifyJWT(token) {
  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    return decoded;
  } catch (e) {
    throw new Error('Invalid token');
  }
}

module.exports = { rateLimits, getTierLimits, checkRateLimit, verifyJWT };