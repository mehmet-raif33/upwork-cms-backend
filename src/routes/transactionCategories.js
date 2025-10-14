const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const Activity = require('../models/activityModel');

// Tüm işlem türlerini getir
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [categories] = await req.app.locals.pool.promise().query(
      `SELECT 
        tc.id, 
        tc.name, 
        tc.description, 
        tc.created_at,
        COUNT(t.id) as transaction_count
      FROM transaction_categories tc
      LEFT JOIN transactions t ON tc.id = t.category_id
      GROUP BY tc.id, tc.name, tc.description, tc.created_at
      ORDER BY tc.created_at DESC`
    );
    
    res.json({
      success: true,
      data: categories.map(cat => ({
        ...cat,
        transaction_count: parseInt(cat.transaction_count || 0)
      }))
    });
  } catch (error) {
    console.error('İşlem türlerini getirme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem türleri alınırken hata oluştu',
      error: error.message
    });
  }
});

// Yeni işlem türü ekle
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Manager kontrolü
    if (req.user.role !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için manager yetkisi gereklidir'
      });
    }

    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Kategori adı zorunludur'
      });
    }

    // Aynı isimde işlem türü var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id FROM transaction_categories WHERE name = ?',
      [name.trim()]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Bu isimde bir işlem türü zaten mevcut'
      });
    }

    const [result] = await req.app.locals.pool.promise().query(
      'INSERT INTO transaction_categories (name) VALUES (?)',
      [name.trim()]
    );

    const [newCategory] = await req.app.locals.pool.promise().query(
      'SELECT id, name, created_at FROM transaction_categories WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'İşlem türü başarıyla eklendi',
      data: newCategory[0]
    });
    // Activity log
    try { await Activity.create(req.user.id, 'İşlem türü eklendi', { name }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('İşlem türü ekleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem türü eklenirken hata oluştu',
      error: error.message
    });
  }
});

// İşlem türü güncelle
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    // Manager kontrolü
    if (req.user.role !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için manager yetkisi gereklidir'
      });
    }

    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Kategori adı zorunludur'
      });
    }

    // İşlem türü var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id FROM transaction_categories WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'İşlem türü bulunamadı'
      });
    }

    // Aynı isimde başka işlem türü var mı kontrol et
    const [duplicate] = await req.app.locals.pool.promise().query(
      'SELECT id FROM transaction_categories WHERE name = ? AND id != ?',
      [name.trim(), id]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Bu isimde başka bir işlem türü zaten mevcut'
      });
    }

    await req.app.locals.pool.promise().query(
      'UPDATE transaction_categories SET name = ? WHERE id = ?',
      [name.trim(), id]
    );

    const [updatedCategory] = await req.app.locals.pool.promise().query(
      'SELECT id, name, created_at FROM transaction_categories WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'İşlem türü başarıyla güncellendi',
      data: updatedCategory[0]
    });
    // Activity log
    try { await Activity.create(req.user.id, 'İşlem türü güncellendi', { id, name }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('İşlem türü güncelleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem türü güncellenirken hata oluştu',
      error: error.message
    });
  }
});

// İşlem türü sil
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // Manager kontrolü
    if (req.user.role !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için manager yetkisi gereklidir'
      });
    }

    const { id } = req.params;

    // İşlem türü var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id, name FROM transaction_categories WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'İşlem türü bulunamadı'
      });
    }

    // Bu kategoriye bağlı işlemler var mı kontrol et
    const [relatedTransactions] = await req.app.locals.pool.promise().query(
      'SELECT COUNT(*) as count FROM transactions WHERE category_id = ?',
      [id]
    );

    if (relatedTransactions[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: `Bu işlem türü "${existing[0].name}" kullanımda olduğu için silinemez. Önce bu kategoriye ait işlemleri silin veya başka bir kategoriye taşıyın.`
      });
    }

    await req.app.locals.pool.promise().query(
      'DELETE FROM transaction_categories WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'İşlem türü başarıyla silindi'
    });
    // Activity log
    try { await Activity.create(req.user.id, 'İşlem türü silindi', { id, name: existing[0].name }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('İşlem türü silme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem türü silinirken hata oluştu',
      error: error.message
    });
  }
});

module.exports = router; 