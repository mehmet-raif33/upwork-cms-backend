const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const Activity = require('../models/activityModel');

// Tüm personeli getir (pagination ile)
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('=== PERSONNEL API CALL ===');
    console.log('Personnel GET endpoint called by user:', req.user.id);
    console.log('User role:', req.user.role);
    console.log('Request headers:', req.headers);
    
    const { page = 1, limit = 20, search = '', status = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT id, full_name, username, email, phone, hire_date, status, notes, is_active, role, created_at, updated_at FROM personnel';
    let countQuery = 'SELECT COUNT(*) as total FROM personnel';
    let queryParams = [];
    let countParams = [];
    
    // Search and status filters
    let whereConditions = [];
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push('(full_name LIKE ? OR username LIKE ? OR email LIKE ? OR phone LIKE ?)');
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    if (status && status.trim()) {
      whereConditions.push('status = ?');
      queryParams.push(status.trim());
      countParams.push(status.trim());
    }
    
    if (whereConditions.length > 0) {
      const whereClause = ' WHERE ' + whereConditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    queryParams.push(parseInt(limit), offset);
    
    const [personnel] = await req.app.locals.pool.promise().query(query, queryParams);
    const [countResult] = await req.app.locals.pool.promise().query(countQuery, countParams);
    
    console.log('Personnel query result:', personnel.length, 'personnel found');
    console.log('Total personnel:', countResult[0].total);
    
    res.json({
      success: true,
      data: personnel,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / parseInt(limit))
      }
    });
    
    console.log('=== PERSONNEL API RESPONSE SENT ===');
  } catch (error) {
    console.error('Personeli getirme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Personel alınırken hata oluştu',
      error: error.message
    });
  }
});

// Tek personel getir
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [personnel] = await req.app.locals.pool.promise().query(
      'SELECT * FROM personnel WHERE id = ?',
      [id]
    );
    
    if (personnel.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Personel bulunamadı'
      });
    }
    
    res.json({
      success: true,
      data: personnel[0]
    });
  } catch (error) {
    console.error('Personel getirme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Personel alınırken hata oluştu',
      error: error.message
    });
  }
});

// Yeni personel ekle
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Admin kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gereklidir'
      });
    }

    const { full_name, email, phone, hire_date, status, notes, is_active, username, password, role } = req.body;
    const userId = req.user.id;

    // Validasyon
    if (!full_name) {
      return res.status(400).json({
        success: false,
        message: 'Ad Soyad zorunludur'
      });
    }

    // Email formatını kontrol et (opsiyonel)
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz email formatı'
        });
      }

      // Aynı email'de personel var mı kontrol et
      const [existingEmail] = await req.app.locals.pool.promise().query(
        'SELECT id FROM personnel WHERE email = ?',
        [email]
      );

      if (existingEmail.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Bu email adresi zaten kullanımda'
        });
      }
    }

    // Username kontrolü
    if (username) {
      const [existingUsername] = await req.app.locals.pool.promise().query(
        'SELECT id FROM personnel WHERE username = ?',
        [username]
      );

      if (existingUsername.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Bu kullanıcı adı zaten kullanımda'
        });
      }
    }

    // Şifre hash'leme
    let passwordHash = null;
    if (password) {
      const bcrypt = require('bcryptjs');
      const saltRounds = 12;
      passwordHash = await bcrypt.hash(password, saltRounds);
    }

    const [result] = await req.app.locals.pool.promise().query(
      'INSERT INTO personnel (full_name, email, phone, hire_date, status, notes, is_active, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [full_name, email || null, phone || null, hire_date || null, status || 'active', notes || '', is_active !== undefined ? is_active : 1, username || null, passwordHash, role || 'personnel']
    );

    const [newPersonnel] = await req.app.locals.pool.promise().query(
      'SELECT * FROM personnel WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Personel başarıyla eklendi',
      data: newPersonnel[0]
    });
    // Activity log
    try { await Activity.create(userId, 'Personel eklendi', { full_name, email }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('Personel ekleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Personel eklenirken hata oluştu',
      error: error.message
    });
  }
});

// Personel güncelle
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    // Admin kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gereklidir'
      });
    }

    const { id } = req.params;
    const { full_name, email, phone, hire_date, status, notes, is_active, username, password, role } = req.body;
    const userId = req.user.id;

    // Düzenlenecek personeli getir
    const [targetPersonnel] = await req.app.locals.pool.promise().query(
      'SELECT id, role, updated_at FROM personnel WHERE id = ?',
      [id]
    );

    if (targetPersonnel.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Personel bulunamadı'
      });
    }

    const targetPerson = targetPersonnel[0];

    // Yönetici düzenleme kontrolü - Yöneticiler sadece normal personeli düzenleyebilir
    if (targetPerson.role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Yönetici hesapları düzenlenemez'
      });
    }



    // Validasyon
    if (!full_name) {
      return res.status(400).json({
        success: false,
        message: 'Ad Soyad zorunludur'
      });
    }

    // Personel var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id FROM personnel WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Personel bulunamadı'
      });
    }

    // Email kontrolü
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz email formatı'
        });
      }

      // Aynı email'de başka personel var mı kontrol et
      const [duplicateEmail] = await req.app.locals.pool.promise().query(
        'SELECT id FROM personnel WHERE email = ? AND id != ?',
        [email, id]
      );

      if (duplicateEmail.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Bu email adresi başka bir personel tarafından kullanılıyor'
        });
      }
    }

    // Username kontrolü
    if (username) {
      const [existingUsername] = await req.app.locals.pool.promise().query(
        'SELECT id FROM personnel WHERE username = ? AND id != ?',
        [username, id]
      );

      if (existingUsername.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Bu kullanıcı adı zaten kullanımda'
        });
      }
    }

    // Şifre hash'leme
    let passwordHash = null;
    if (password) {
      const bcrypt = require('bcryptjs');
      const saltRounds = 12;
      passwordHash = await bcrypt.hash(password, saltRounds);
    }

    // Güncelleme sorgusu
    let updateQuery = 'UPDATE personnel SET full_name = ?, email = ?, phone = ?, hire_date = ?, status = ?, notes = ?, is_active = ?';
    let updateParams = [full_name, email || null, phone || null, hire_date || null, status || 'active', notes || '', is_active !== undefined ? is_active : 1];

    if (username !== undefined) {
      updateQuery += ', username = ?';
      updateParams.push(username || null);
    }

    if (passwordHash !== null) {
      updateQuery += ', password_hash = ?';
      updateParams.push(passwordHash);
    }

    if (role !== undefined) {
      updateQuery += ', role = ?';
      updateParams.push(role || 'personnel');
    }

    updateQuery += ' WHERE id = ?';
    updateParams.push(id);

    await req.app.locals.pool.promise().query(updateQuery, updateParams);

    const [updatedPersonnel] = await req.app.locals.pool.promise().query(
      'SELECT * FROM personnel WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Personel başarıyla güncellendi',
      data: updatedPersonnel[0]
    });
    // Activity log
    try { await Activity.create(userId, 'Personel güncellendi', { id, full_name, email }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('Personel güncelleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Personel güncellenirken hata oluştu',
      error: error.message
    });
  }
});

// Personel durumu güncelle (aktif/pasif)
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    // Admin kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gereklidir'
      });
    }

    const { id } = req.params;
    const { is_active } = req.body;

    // Validasyon
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'is_active değeri boolean olmalıdır'
      });
    }

    // Personel var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id, full_name, username, role, is_active FROM personnel WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Personel bulunamadı'
      });
    }

    // Kendi durumunu değiştirmeye çalışıyor mu kontrol et
    if (existing[0].id == req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Kendi hesabınızın durumunu değiştiremezsiniz'
      });
    }

    // Mevcut durumla aynıysa güncelleme yapma
    if (existing[0].is_active === is_active) {
      return res.status(400).json({
        success: false,
        message: `Personel zaten ${is_active ? 'aktif' : 'pasif'} durumda`
      });
    }

    console.log(`🔄 Admin ${req.user.username} changing status of ${existing[0].full_name}: ${existing[0].is_active ? 'aktif' : 'pasif'} → ${is_active ? 'aktif' : 'pasif'}`);

    // Durumu güncelle
    await req.app.locals.pool.promise().query(
      'UPDATE personnel SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [is_active, id]
    );

    res.json({
      success: true,
      message: `${existing[0].full_name} ${is_active ? 'aktif' : 'pasif'} duruma getirildi`,
      personnel: {
        id: existing[0].id,
        full_name: existing[0].full_name,
        username: existing[0].username,
        role: existing[0].role,
        is_active: is_active,
        old_status: existing[0].is_active
      }
    });

    // Activity log
    try { 
      await Activity.create(req.user.id, 'Personel durumu güncellendi', { 
        personnel_id: id,
        personnel_name: existing[0].full_name,
        old_status: existing[0].is_active ? 'aktif' : 'pasif',
        new_status: is_active ? 'aktif' : 'pasif'
      }); 
    } catch (e) { 
      console.error('Activity log error:', e); 
    }

  } catch (error) {
    console.error('Personel durum güncelleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Personel durumu güncellenirken hata oluştu',
      error: error.message
    });
  }
});

// Personel istatistikleri
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const [stats] = await req.app.locals.pool.promise().query(`
      SELECT 
        COUNT(*) as total_personnel,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_personnel,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_personnel
      FROM personnel
    `);
    
    res.json({
      success: true,
      stats: stats[0]
    });
  } catch (error) {
    console.error('Personel istatistikleri hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İstatistikler alınırken hata oluştu',
      error: error.message
    });
  }
});

module.exports = router; 