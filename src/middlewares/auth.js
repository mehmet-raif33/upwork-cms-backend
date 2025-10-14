const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

// JWT token doğrulama middleware'i
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      message: 'Access token gerekli',
      error: 'TOKEN_MISSING'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ 
        message: 'Geçersiz token',
        error: 'TOKEN_INVALID'
      });
    }
    req.user = user;
    next();
  });
};

// Manager yetkisi kontrolü
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      message: 'Kullanıcı bilgisi bulunamadı',
      error: 'USER_NOT_FOUND'
    });
  }

  if (req.user.role !== 'manager') {
    return res.status(403).json({ 
      message: 'Bu işlem için manager yetkisi gerekli',
      error: 'MANAGER_REQUIRED'
    });
  }

  next();
};

// Personel yetkisi kontrolü (manager veya personnel)
const requireEmployee = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      message: 'Kullanıcı bilgisi bulunamadı',
      error: 'USER_NOT_FOUND'
    });
  }

  if (req.user.role !== 'manager' && req.user.role !== 'personnel') {
    return res.status(403).json({ 
      message: 'Bu işlem için personel yetkisi gerekli',
      error: 'PERSONNEL_REQUIRED'
    });
  }

  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireEmployee
}; 