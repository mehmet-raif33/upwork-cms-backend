const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const Activity = require('../models/activityModel');

// Refresh token oluşturma fonksiyonu
const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

// Refresh token'ı veritabanına kaydetme
const saveRefreshToken = async (userId, refreshToken) => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 gün
  
  // Mevcut refresh token'ları temizle
  await pool.promise().query(
    'DELETE FROM refresh_tokens WHERE user_id = ?',
    [userId]
  );
  
  // Yeni refresh token'ı kaydet
  await pool.promise().query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [userId, refreshToken, expiresAt]
  );
};

// Refresh token'ı doğrulama
const validateRefreshToken = async (refreshToken) => {
  const [tokens] = await pool.promise().query(
    'SELECT rt.*, p.id, p.username, p.email, p.role, p.full_name FROM refresh_tokens rt JOIN personnel p ON rt.user_id = p.id WHERE rt.token = ? AND rt.expires_at > NOW() AND p.is_active = 1',
    [refreshToken]
  );
  
  return tokens.length > 0 ? tokens[0] : null;
};

// Kullanıcı kaydı
exports.register = async (req, res) => {
  try {
    const { full_name, username, email, password, role = 'employee' } = req.body;

    // Gerekli alanları kontrol et
    if (!full_name || !username || !email || !password) {
      return res.status(400).json({
        message: 'Tüm alanlar gerekli (full_name, username, email, password)',
        error: 'MISSING_FIELDS'
      });
    }

    // Email formatını kontrol et
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: 'Geçersiz email formatı',
        error: 'INVALID_EMAIL'
      });
    }

    // Şifre güvenliğini kontrol et
    if (password.length < 6) {
      return res.status(400).json({
        message: 'Şifre en az 6 karakter olmalı',
        error: 'WEAK_PASSWORD'
      });
    }

    // Username ve email benzersizliğini kontrol et
    const [existingUsers] = await pool.promise().query(
      'SELECT id FROM personnel WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        message: 'Bu kullanıcı adı veya email zaten kullanılıyor',
        error: 'DUPLICATE_USER'
      });
    }

    // Şifreyi hash'le
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Kullanıcıyı veritabanına ekle
    const [result] = await pool.promise().query(
      'INSERT INTO personnel (full_name, username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [full_name, username, email, passwordHash, role, true]
    );

    // JWT token oluştur
    const token = jwt.sign(
      { 
        id: result.insertId, 
        username: username, 
        email: email, 
        role: role 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Refresh token oluştur ve kaydet
    const refreshToken = generateRefreshToken();
    await saveRefreshToken(result.insertId, refreshToken);

    res.status(201).json({
      success: true,
      message: 'Kullanıcı başarıyla oluşturuldu',
      user: {
        id: result.insertId,
        full_name: full_name,
        username: username,
        email: email,
        role: role
      },
      token,
      refreshToken
    });

    // Activity log
    try { 
      await Activity.create(result.insertId, 'Yeni kullanıcı kaydı', { 
        username: username, 
        email: email,
        role: role 
      }); 
    } catch (e) { 
      console.error('Activity log error:', e); 
    }

  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({
      message: 'Sunucu hatası',
      error: 'INTERNAL_ERROR'
    });
  }
};

// Kullanıcı girişi
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Gerekli alanları kontrol et
    if (!username || !password) {
      return res.status(400).json({
        message: 'Kullanıcı adı ve şifre gerekli',
        error: 'MISSING_FIELDS'
      });
    }

    // Kullanıcıyı bul
    const [users] = await pool.promise().query(
      'SELECT id, username, email, password_hash, role, is_active, full_name FROM personnel WHERE username = ? OR email = ?',
      [username, username]
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: 'Geçersiz kullanıcı adı veya şifre',
        error: 'INVALID_CREDENTIALS'
      });
    }

    const user = users[0];

    // Hesabın aktif olup olmadığını kontrol et
    if (!user.is_active) {
      return res.status(401).json({
        message: 'Hesabınız devre dışı bırakılmış',
        error: 'ACCOUNT_DISABLED'
      });
    }

    // Şifreyi kontrol et
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        message: 'Geçersiz kullanıcı adı veya şifre',
        error: 'INVALID_CREDENTIALS'
      });
    }

    // JWT token oluştur
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Refresh token oluştur ve kaydet
    const refreshToken = generateRefreshToken();
    await saveRefreshToken(user.id, refreshToken);

    res.json({
      success: true,
      message: 'Giriş başarılı',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        full_name: user.full_name
      },
      token,
      refreshToken
    });
    // Activity log
    try { await Activity.create(user.id, 'Kullanıcı girişi', { username: user.username, email: user.email }); } catch (e) { console.error('Activity log error:', e); }

  } catch (error) {
    console.error('Giriş hatası:', error);
    res.status(500).json({
      message: 'Sunucu hatası',
      error: 'INTERNAL_ERROR'
    });
  }
};

// Token yenileme endpoint'i
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        message: 'Refresh token gerekli',
        error: 'MISSING_REFRESH_TOKEN'
      });
    }

    // Refresh token'ı doğrula
    const tokenData = await validateRefreshToken(refreshToken);
    
    if (!tokenData) {
      return res.status(401).json({
        message: 'Geçersiz veya süresi dolmuş refresh token',
        error: 'INVALID_REFRESH_TOKEN'
      });
    }

    // Yeni access token oluştur
    const newToken = jwt.sign(
      { 
        id: tokenData.id, 
        username: tokenData.username, 
        email: tokenData.email, 
        role: tokenData.role 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Yeni refresh token oluştur ve kaydet
    const newRefreshToken = generateRefreshToken();
    await saveRefreshToken(tokenData.id, newRefreshToken);

    res.json({
      message: 'Token başarıyla yenilendi',
      user: {
        id: tokenData.id,
        username: tokenData.username,
        email: tokenData.email,
        role: tokenData.role,
        full_name: tokenData.full_name
      },
      token: newToken,
      refreshToken: newRefreshToken
    });

    // Activity log
    try { 
      await Activity.create(tokenData.id, 'Token yenilendi', { 
        username: tokenData.username 
      }); 
    } catch (e) { 
      console.error('Activity log error:', e); 
    }

  } catch (error) {
    console.error('Token yenileme hatası:', error);
    res.status(500).json({
      message: 'Sunucu hatası',
      error: 'INTERNAL_ERROR'
    });
  }
};

// Logout endpoint'i - refresh token'ı sil
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const userId = req.user?.id;

    if (refreshToken) {
      // Belirli refresh token'ı sil
      await pool.promise().query(
        'DELETE FROM refresh_tokens WHERE token = ?',
        [refreshToken]
      );
    } else if (userId) {
      // Kullanıcının tüm refresh token'larını sil
      await pool.promise().query(
        'DELETE FROM refresh_tokens WHERE user_id = ?',
        [userId]
      );
    }

    res.json({
      message: 'Başarıyla çıkış yapıldı'
    });

    // Activity log
    if (userId) {
      try { 
        await Activity.create(userId, 'Kullanıcı çıkışı', {}); 
      } catch (e) { 
        console.error('Activity log error:', e); 
      }
    }

  } catch (error) {
    console.error('Logout hatası:', error);
    res.status(500).json({
      message: 'Sunucu hatası',
      error: 'INTERNAL_ERROR'
    });
  }
};

// Kullanıcı profilini getir
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const [users] = await pool.promise().query(
      'SELECT id, username, email, role, full_name, created_at FROM personnel WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        message: 'Kullanıcı bulunamadı',
        error: 'USER_NOT_FOUND'
      });
    }

    res.json({
      user: users[0]
    });

  } catch (error) {
    console.error('Profil getirme hatası:', error);
    res.status(500).json({
      message: 'Sunucu hatası',
      error: 'INTERNAL_ERROR'
    });
  }
};

// Şifre değiştirme
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    // Frontend hem oldPassword hem currentPassword gönderebilir
    const { currentPassword, newPassword, oldPassword } = req.body;
    const passwordToCheck = currentPassword || oldPassword;

    if (!passwordToCheck || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Mevcut şifre ve yeni şifre gerekli',
        error: 'MISSING_FIELDS'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Yeni şifre en az 6 karakter olmalı',
        error: 'WEAK_PASSWORD'
      });
    }

    // Mevcut şifreyi kontrol et
    const [users] = await pool.promise().query(
      'SELECT password_hash FROM personnel WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
        error: 'USER_NOT_FOUND'
      });
    }

    const isValidPassword = await bcrypt.compare(passwordToCheck, users[0].password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Mevcut şifre yanlış',
        error: 'INVALID_PASSWORD'
      });
    }

    // Yeni şifreyi hash'le ve güncelle
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    await pool.promise().query(
      'UPDATE personnel SET password_hash = ? WHERE id = ?',
      [newPasswordHash, userId]
    );

    res.json({
      success: true,
      message: 'Şifre başarıyla değiştirildi'
    });
    // Activity log
    try { await Activity.create(userId, 'Şifre değiştirildi', {}); } catch (e) { console.error('Activity log error:', e); }

  } catch (error) {
    console.error('Şifre değiştirme hatası:', error);
    res.status(500).json({
      message: 'Sunucu hatası',
      error: 'INTERNAL_ERROR'
    });
  }
}; 