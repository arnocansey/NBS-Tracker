// backend/src/middleware/auth.middleware.js

const jwt = require('jsonwebtoken');

const JWT_SECRET = 'YOUR_SUPER_SECURE_JWT_SECRET_KEY'; // Must match the secret in auth.routes.js

const authMiddleware = (req, res, next) => {
    // 1. Get the token from the Authorization header (e.g., "Bearer TOKEN")
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(403).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1]; // Extract the token part

    try {
        // 2. Verify and decode the token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 3. Attach user info to the request object for use in the route handler
        req.user = decoded; 
        
        // 4. Continue to the next middleware or route handler
        next(); 
    } catch (ex) {
        // If verification fails (e.g., token expired or invalid signature)
        res.status(401).json({ error: 'Invalid token. Please log in again.' });
    }
};

module.exports = authMiddleware;