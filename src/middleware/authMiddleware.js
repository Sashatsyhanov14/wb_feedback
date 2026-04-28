const jwt = require('jsonwebtoken');
const config = require('../config');

const authMiddleware = (req, res, next) => {
  // Check cookie first, then Authorization header
  let token = req.cookies.auth_token;
  
  if (!token && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    console.log('[AuthMiddleware] No token found in cookies or Authorization header');
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    console.log('[AuthMiddleware] Token verified for sellerId:', decoded.sellerId);
    req.user = decoded; // { sellerId: ... }
    next();
  } catch (error) {
    console.error('[AuthMiddleware] Invalid token:', error.message);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

module.exports = authMiddleware;
