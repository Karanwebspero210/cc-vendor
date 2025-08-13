const crypto = require('crypto');
const logger = require('./logger');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-cbc';
    this.secretKey = process.env.ENCRYPTION_KEY;
    
    if (!this.secretKey) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }
    
    // Ensure key is 32 bytes for AES-256
    this.key = crypto.scryptSync(this.secretKey, 'salt', 32);
  }

  /**
   * Encrypt a string
   * @param {string} text - Text to encrypt
   * @returns {string} - Encrypted text with IV prepended
   */
  encrypt(text) {
    try {
      if (!text) return text;
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Prepend IV to encrypted text
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      logger.error('Encryption failed:', error);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt a string
   * @param {string} encryptedText - Encrypted text with IV prepended
   * @returns {string} - Decrypted text
   */
  decrypt(encryptedText) {
    try {
      if (!encryptedText) return encryptedText;
      
      const textParts = encryptedText.split(':');
      // If not in expected iv:cipher format, assume it's already plaintext and return as-is
      if (textParts.length !== 2) {
        return encryptedText;
      }
      
      const iv = Buffer.from(textParts[0], 'hex');
      const encrypted = textParts[1];
      
      // Use the same algorithm and IV that were used during encryption
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      // Be graceful: if decryption fails (e.g., legacy/plaintext/rotated key), return original text
      logger.error('Decryption failed:', error);
      return encryptedText;
    }
  }

  /**
   * Hash a password with salt
   * @param {string} password - Password to hash
   * @returns {string} - Hashed password
   */
  hashPassword(password) {
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
      return `${salt}:${hash}`;
    } catch (error) {
      logger.error('Password hashing failed:', error);
      throw new Error('Password hashing failed');
    }
  }

  /**
   * Verify a password against a hash
   * @param {string} password - Password to verify
   * @param {string} hashedPassword - Hashed password to verify against
   * @returns {boolean} - True if password matches
   */
  verifyPassword(password, hashedPassword) {
    try {
      const [salt, hash] = hashedPassword.split(':');
      const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
      return hash === verifyHash;
    } catch (error) {
      logger.error('Password verification failed:', error);
      return false;
    }
  }

  /**
   * Generate a random token
   * @param {number} length - Token length in bytes
   * @returns {string} - Random token
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }
}

module.exports = new EncryptionService();
