const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');

// Routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authenticateToken, authController.logout); // Optional auth for logout
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/change-password', authenticateToken, authController.changePassword);

// Test kullanıcısı oluştur (sadece geliştirme ortamında)
router.post('/create-test-user', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { pool } = require('../config/db');
    
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash('password123', saltRounds);
    
    const [result] = await pool.promise().query(
      'INSERT INTO personnel (full_name, username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      ['Test Manager', 'manager', 'manager@ulas.com', passwordHash, 'manager', 1]
    );
    
    res.status(201).json({
      message: 'Test kullanıcısı oluşturuldu',
      user: {
        id: result.insertId,
        username: 'manager',
        email: 'manager@ulas.com',
        role: 'manager'
      }
    });
  } catch (error) {
    console.error('Test kullanıcısı oluşturma hatası:', error);
    res.status(500).json({
      message: 'Test kullanıcısı oluşturulamadı',
      error: error.message
    });
  }
});

module.exports = router; 