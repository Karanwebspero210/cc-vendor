const jwt = require('jsonwebtoken');
const logger = require('./logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate a JWT token for a user
 * @param {string} userId - The user ID
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {string} JWT token
 */
const generateToken = (userId, isAdmin = false) => {
  if (!userId) {
    throw new Error('User ID is required to generate token');
  }

  return jwt.sign(
    { 
      userId,
      isAdmin,
      // Add any additional claims here
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

/**
 * Verify and decode a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
const verifyToken = (token) => {
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    logger.error('JWT verification failed:', error.message);
    
    // Map JWT errors to more user-friendly messages
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    
    throw error;
  }
};

/**
 * Middleware to verify JWT token from socket connection
 * @param {string} token - The JWT token from client
 * @returns {object} User information if token is valid
 */
const verifySocketToken = (token) => {
  try {
    const decoded = verifyToken(token);
    return {
      userId: decoded.userId,
      isAdmin: decoded.isAdmin || false,
      authenticated: true
    };
  } catch (error) {
    logger.warn('Socket authentication failed:', error.message);
    return {
      authenticated: false,
      error: error.message
    };
  }
};

module.exports = {
  generateToken,
  verifyToken,
  verifySocketToken,
  JWT_SECRET,
  JWT_EXPIRES_IN
};
