const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const Activity = require('../models/activityModel');
const logger = require('../utils/logger');
const ProfitCalculator = require('../utils/profitCalculator');

// Tüm işlemleri getir
router.get('/', authenticateToken, async (req, res) => {
  try {
    logger.apiRequest('GET', '/transactions', req.user?.id, { queryParams: req.query });
    
    const { page = 1, limit = 20, vehicle_id, personnel_id, category_id, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;
    
    let whereConditions = [];
    let queryParams = [];
    
    if (vehicle_id) {
      whereConditions.push('t.vehicle_id = ?');
      queryParams.push(vehicle_id);
    }
    
    if (personnel_id) {
      whereConditions.push('t.personnel_id = ?');
      queryParams.push(personnel_id);
    }
    
    if (category_id) {
      whereConditions.push('t.category_id = ?');
      queryParams.push(category_id);
    }
    
    if (start_date) {
      whereConditions.push('t.transaction_date >= ?');
      queryParams.push(start_date);
    }
    
    if (end_date) {
      whereConditions.push('t.transaction_date <= ?');
      queryParams.push(end_date);
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    logger.debug('Building transaction query', { whereClause, queryParams });
    
    // First, let's check if the transactions table exists and has data
    logger.debug('Checking transactions table');
    const [tableCheck] = await req.app.locals.pool.promise().query('SHOW TABLES LIKE "transactions"');
    console.log('Transactions table exists:', tableCheck.length > 0);
    
    if (tableCheck.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Transactions table does not exist',
        error: 'Table not found'
      });
    }
    
    // Check if there are any transactions
    const [countCheck] = await req.app.locals.pool.promise().query('SELECT COUNT(*) as total FROM transactions');
    console.log('Total transactions in table:', countCheck[0].total);
    
    // Check table structure
    const [columns] = await req.app.locals.pool.promise().query('DESCRIBE transactions');
    console.log('Transactions table columns:', columns.map(col => col.Field));
    
    const query = `
      SELECT 
        t.id,
        t.personnel_id,
        t.vehicle_id,
        t.description,
        t.amount,
        t.expense,
        t.is_expense,
        t.transaction_date,
        t.category_id,
        t.payment_method,
        t.notes,
        t.status,
        t.status_notes,
        t.status_changed_at,
        t.status_changed_by,
        v.plate as vehicle_plate,
        p.full_name as personnel_name,
        tc.name as category_name,
        status_changer.full_name as status_changed_by_name
      FROM transactions t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN personnel status_changer ON t.status_changed_by = status_changer.id
      ${whereClause}
      ORDER BY t.transaction_date DESC, t.id DESC
      LIMIT ? OFFSET ?
    `;
    
    console.log('Executing query:', query);
    console.log('Final params:', [...queryParams, parseInt(limit), offset]);
    
    const [transactions] = await req.app.locals.pool.promise().query(query, [...queryParams, parseInt(limit), offset]);
    
    console.log('Query executed successfully, found', transactions.length, 'transactions');
    
    // Toplam sayıyı al
    const [countResult] = await req.app.locals.pool.promise().query(`
      SELECT COUNT(*) as total
      FROM transactions t
      ${whereClause}
    `, queryParams);
    
    console.log('Count query executed, total:', countResult[0].total);
    
    res.json({
      success: true,
      transactions: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('İşlemleri getirme hatası:', error);
    console.error('Error stack:', error.stack);
    console.error('Error code:', error.code);
    console.error('Error errno:', error.errno);
    console.error('Error sqlMessage:', error.sqlMessage);
    res.status(500).json({
      success: false,
      message: 'İşlemler alınırken hata oluştu',
      error: error.message,
      details: {
        code: error.code,
        errno: error.errno,
        sqlMessage: error.sqlMessage
      }
    });
  }
});

// Tek işlem getir
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.personnel_id,
        t.vehicle_id,
        t.description,
        t.amount,
        t.expense,
        t.is_expense,
        t.transaction_date,
        t.category_id,
        t.payment_method,
        t.notes,
        t.status,
        t.status_notes,
        t.status_changed_at,
        t.status_changed_by,
        v.plate as vehicle_plate,
        p.full_name as personnel_name,
        tc.name as category_name,
        status_changer.full_name as status_changed_by_name
      FROM transactions t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN personnel status_changer ON t.status_changed_by = status_changer.id
      WHERE t.id = ?
    `, [id]);
    
    if (transactions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'İşlem bulunamadı'
      });
    }
    
    res.json({
      success: true,
      transaction: transactions[0]
    });
  } catch (error) {
    console.error('İşlem getirme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem alınırken hata oluştu',
      error: error.message
    });
  }
});

// Yeni işlem ekle
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { vehicle_id, category_id, transaction_type, description, amount, expense, is_expense, transaction_date, odometer_reading, service_provider, invoice_number, notes } = req.body;
    const userId = req.user.id;

    // Validasyon
    if (!vehicle_id || !amount || !transaction_date) {
      return res.status(400).json({
        success: false,
        message: 'Araç, tutar ve tarih zorunludur'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Tutar 0\'dan büyük olmalıdır'
      });
    }

    // Gider validasyonu
    if (is_expense && (!expense || expense <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'Gider tutarı 0\'dan büyük olmalıdır'
      });
    }

    // Araç var mı kontrol et
    const [vehicle] = await req.app.locals.pool.promise().query(
      'SELECT id FROM vehicles WHERE id = ?',
      [vehicle_id]
    );

    if (vehicle.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Araç bulunamadı'
      });
    }

    // Kategori var mı kontrol et (opsiyonel)
    if (category_id) {
      const [category] = await req.app.locals.pool.promise().query(
        'SELECT id FROM transaction_categories WHERE id = ?',
        [category_id]
      );

      if (category.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'İşlem türü bulunamadı'
        });
      }
    }

    const [result] = await req.app.locals.pool.promise().query(
      'INSERT INTO transactions (vehicle_id, category_id, description, amount, expense, is_expense, transaction_date, personnel_id, status, status_changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [vehicle_id, category_id || null, description || '', amount, expense || null, is_expense !== undefined ? is_expense : true, transaction_date, userId, 'in_progress', userId]
    );

    // İşlem oluşturma history kaydı
    await req.app.locals.pool.promise().query(
      'INSERT INTO transaction_history (transaction_id, personnel_id, action, notes) VALUES (?, ?, ?, ?)',
      [result.insertId, userId, 'created', 'Yeni işlem oluşturuldu']
    );

    const [newTransaction] = await req.app.locals.pool.promise().query(
      'SELECT * FROM transactions WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'İşlem başarıyla eklendi',
      data: newTransaction[0]
    });
    // Activity log
    try { await Activity.create(userId, 'İşlem eklendi', { transaction_id: result.insertId, ...req.body }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('İşlem ekleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem eklenirken hata oluştu',
      error: error.message
    });
  }
});

// İşlem güncelle
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { vehicle_id, personnel_id, category_id, transaction_type, description, amount, expense, is_expense, date, payment_method, notes } = req.body;
    const userId = req.user.id;

    // Validasyon
    if (!vehicle_id || !amount || !date) {
      return res.status(400).json({
        success: false,
        message: 'Araç, tutar ve tarih zorunludur'
      });
    }

    // Gider validasyonu
    if (is_expense && (!expense || expense <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'Gider tutarı 0\'dan büyük olmalıdır'
      });
    }

    // İşlem var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id FROM transactions WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'İşlem bulunamadı'
      });
    }

    // Araç var mı kontrol et
    const [vehicle] = await req.app.locals.pool.promise().query(
      'SELECT id FROM vehicles WHERE id = ?',
      [vehicle_id]
    );

    if (vehicle.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Araç bulunamadı'
      });
    }

    // Eski değerleri al
    const [oldTransaction] = await req.app.locals.pool.promise().query(
      'SELECT vehicle_id, personnel_id, category_id, description, amount, expense, is_expense, transaction_date, payment_method, notes FROM transactions WHERE id = ?',
      [id]
    );

    const oldData = oldTransaction[0];

    // İşlemi güncelle
    await req.app.locals.pool.promise().query(
      'UPDATE transactions SET vehicle_id = ?, personnel_id = ?, category_id = ?, description = ?, amount = ?, expense = ?, is_expense = ?, transaction_date = ?, payment_method = ?, notes = ? WHERE id = ?',
      [vehicle_id, personnel_id || null, category_id || null, description || '', amount, expense || null, is_expense !== undefined ? is_expense : true, date, payment_method || null, notes || null, id]
    );

    // Değişiklikleri history'ye kaydet
    const changes = [];
    if (oldData.vehicle_id !== vehicle_id) {
      changes.push(['vehicle_id', oldData.vehicle_id, vehicle_id]);
    }
    if (oldData.personnel_id !== (personnel_id || null)) {
      changes.push(['personnel_id', oldData.personnel_id, personnel_id || null]);
    }
    if (oldData.category_id !== (category_id || null)) {
      changes.push(['category_id', oldData.category_id, category_id || null]);
    }
    if (oldData.description !== (description || '')) {
      changes.push(['description', oldData.description, description || '']);
    }
    if (oldData.amount !== amount) {
      changes.push(['amount', oldData.amount, amount]);
    }
    if (oldData.expense !== expense) {
      changes.push(['expense', oldData.expense, expense]);
    }
    if (oldData.is_expense !== is_expense) {
      changes.push(['is_expense', oldData.is_expense, is_expense]);
    }
    if (oldData.transaction_date !== date) {
      changes.push(['transaction_date', oldData.transaction_date, date]);
    }
    if (oldData.payment_method !== (payment_method || null)) {
      changes.push(['payment_method', oldData.payment_method, payment_method || null]);
    }
    if (oldData.notes !== (notes || null)) {
      changes.push(['notes', oldData.notes, notes || null]);
    }

    // Her değişiklik için history kaydı oluştur
    for (const [field, oldValue, newValue] of changes) {
      await req.app.locals.pool.promise().query(
        'INSERT INTO transaction_history (transaction_id, personnel_id, action, field_name, old_value, new_value, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, userId, 'updated', field, oldValue?.toString() || '', newValue?.toString() || '', `${field} alanı güncellendi`]
      );
    }

    const [updatedTransaction] = await req.app.locals.pool.promise().query(
      'SELECT * FROM transactions WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'İşlem başarıyla güncellendi',
      data: updatedTransaction[0]
    });
    // Activity log
    try { await Activity.create(userId, 'İşlem güncellendi', { transaction_id: id, ...req.body }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('İşlem güncelleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem güncellenirken hata oluştu',
      error: error.message
    });
  }
});

// İşlem sil
router.delete('/:id', authenticateToken, async (req, res) => {
  let connection;
  try {
    const { id } = req.params;

    // Database connection'ı al
    connection = await req.app.locals.pool.promise().getConnection();
    
    // Transaction başlat
    await connection.beginTransaction();

    // İşlem var mı kontrol et
    const [existing] = await connection.query(
      'SELECT id, description FROM transactions WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'İşlem bulunamadı'
      });
    }

    console.log(`🗑️ Deleting transaction ${id}: ${existing[0].description}`);

    // Önce transaction_history tablosundaki bağlı kayıtları sil
    const [historyDeleteResult] = await connection.query(
      'DELETE FROM transaction_history WHERE transaction_id = ?',
      [id]
    );
    console.log(`📝 Deleted ${historyDeleteResult.affectedRows} history records`);

    // Sonra ana işlemi sil
    const [transactionDeleteResult] = await connection.query(
      'DELETE FROM transactions WHERE id = ?',
      [id]
    );
    console.log(`✅ Deleted transaction ${id}`);

    // Transaction'ı commit et
    await connection.commit();

    res.json({
      success: true,
      message: 'İşlem ve bağlı kayıtlar başarıyla silindi',
      deletedRecords: {
        transaction: transactionDeleteResult.affectedRows,
        history: historyDeleteResult.affectedRows
      }
    });
    
    // Activity log
    try { 
      await Activity.create(req.user.id, 'İşlem silindi', { 
        transaction_id: id, 
        description: existing[0].description,
        deleted_history_records: historyDeleteResult.affectedRows
      }); 
    } catch (e) { 
      console.error('Activity log error:', e); 
    }
    
  } catch (error) {
    // Hata durumunda rollback yap
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }
    
    console.error('İşlem silme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem silinirken hata oluştu',
      error: error.message
    });
  } finally {
    // Connection'ı serbest bırak
    if (connection) {
      connection.release();
    }
  }
});

// İşlem istatistikleri
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let whereClause = '';
    let queryParams = [];
    
    if (start_date && end_date) {
      whereClause = 'WHERE transaction_date BETWEEN ? AND ?';
      queryParams = [start_date, end_date];
    }
    
    const [stats] = await req.app.locals.pool.promise().query(`
      SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(AVG(amount), 0) as average_amount,
        COUNT(DISTINCT vehicle_id) as unique_vehicles,
        COUNT(DISTINCT personnel_id) as unique_personnel
      FROM transactions t
      ${whereClause}
    `, queryParams);
    
    res.json({
      success: true,
      stats: stats[0]
    });
  } catch (error) {
    console.error('İşlem istatistikleri hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İstatistikler alınırken hata oluştu',
      error: error.message
    });
  }
});

// Kategoriye göre işlem istatistikleri
router.get('/stats/by-category', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let whereClause = '';
    let queryParams = [];
    
    if (start_date && end_date) {
      whereClause = 'WHERE t.transaction_date BETWEEN ? AND ?';
      queryParams = [start_date, end_date];
    }
    
    const [categoryStats] = await req.app.locals.pool.promise().query(`
      SELECT 
        tc.name as category_name,
        COUNT(t.id) as transaction_count,
        COALESCE(SUM(t.amount), 0) as total_amount,
        COALESCE(AVG(t.amount), 0) as average_amount
      FROM transaction_categories tc
      LEFT JOIN transactions t ON tc.id = t.category_id
      ${whereClause}
      GROUP BY tc.id, tc.name
      ORDER BY total_amount DESC
    `, queryParams);
    
    res.json({
      success: true,
      categoryStats: categoryStats
    });
  } catch (error) {
    console.error('Kategori istatistikleri hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori istatistikleri alınırken hata oluştu',
      error: error.message
    });
  }
});

// Araca göre işlem listesi (ID ile)
router.get('/by-vehicle/:vehicleId', authenticateToken, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.personnel_id,
        t.vehicle_id,
        t.description,
        t.amount,
        t.expense,
        t.is_expense,
        t.transaction_date,
        t.category_id,
        t.payment_method,
        t.notes,
        t.status,
        t.status_notes,
        t.status_changed_at,
        t.status_changed_by,
        p.full_name as personnel_name,
        tc.name as category_name,
        p.username as created_by_name
      FROM transactions t
      LEFT JOIN personnel p ON t.personnel_id = p.id
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      WHERE t.vehicle_id = ?
      ORDER BY t.transaction_date DESC
      LIMIT ? OFFSET ?
    `, [vehicleId, parseInt(limit), offset]);
    
    const [countResult] = await req.app.locals.pool.promise().query(
      'SELECT COUNT(*) as total FROM transactions WHERE vehicle_id = ?',
      [vehicleId]
    );
    
    res.json({
      success: true,
      transactions: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Araç işlemleri hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Araç işlemleri alınırken hata oluştu',
      error: error.message
    });
  }
});

// Araç plakasına göre işlem listesi
router.get('/by-plate/:plate', authenticateToken, async (req, res) => {
  try {
    const { plate } = req.params;
    
    // Önce araç ID'sini bul
    const [vehicles] = await req.app.locals.pool.promise().query(
      'SELECT id FROM vehicles WHERE plate = ?',
      [plate]
    );
    
    if (vehicles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Araç bulunamadı'
      });
    }
    
    const vehicleId = vehicles[0].id;
    
    // Araç işlemlerini getir
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.personnel_id,
        t.vehicle_id,
        t.description,
        t.amount,
        t.expense,
        t.is_expense,
        t.transaction_date,
        t.category_id,
        t.payment_method,
        t.notes,
        t.status,
        t.status_notes,
        t.status_changed_at,
        t.status_changed_by,
        v.plate as vehicle_plate,
        p.full_name as personnel_name,
        tc.name as category_name
      FROM transactions t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      WHERE t.vehicle_id = ?
      ORDER BY t.transaction_date DESC, t.id DESC
    `, [vehicleId]);
    
    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Araç plakasına göre işlemler hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Araç işlemleri alınırken hata oluştu',
      error: error.message
    });
  }
});

// Kategoriye göre işlem listesi
router.get('/category/:categoryId', authenticateToken, async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.personnel_id,
        t.vehicle_id,
        t.description,
        t.amount,
        t.expense,
        t.is_expense,
        t.transaction_date,
        t.category_id,
        t.payment_method,
        t.notes,
        t.status,
        t.status_notes,
        t.status_changed_at,
        t.status_changed_by,
        v.plate as vehicle_plate,
        p.full_name as personnel_name,
        tc.name as category_name
      FROM transactions t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      WHERE t.category_id = ?
      ORDER BY t.transaction_date DESC, t.id DESC
      LIMIT ? OFFSET ?
    `, [categoryId, parseInt(limit), offset]);
    
    const [countResult] = await req.app.locals.pool.promise().query(
      'SELECT COUNT(*) as total FROM transactions WHERE category_id = ?',
      [categoryId]
    );
    
    res.json({
      success: true,
      transactions: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Kategori işlemleri hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori işlemleri alınırken hata oluştu',
      error: error.message
    });
  }
});

// İşlem geçmişi getir
router.get('/:id/history', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [history] = await req.app.locals.pool.promise().query(`
      SELECT 
        th.*,
        p.full_name as personnel_name,
        p.username as personnel_username
      FROM transaction_history th
      LEFT JOIN personnel p ON th.personnel_id = p.id
      WHERE th.transaction_id = ?
      ORDER BY th.created_at DESC
    `, [id]);
    
    res.json({
      success: true,
      history: history
    });
  } catch (error) {
    console.error('İşlem geçmişi hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem geçmişi alınırken hata oluştu',
      error: error.message
    });
  }
});

// İşlem durumu güncelle
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    console.log('=== STATUS UPDATE REQUEST ===');
    console.log('Transaction ID:', req.params.id);
    console.log('Request body:', req.body);
    console.log('User ID:', req.user.id);
    
    const { id } = req.params;
    const { status, notes } = req.body;
    const userId = req.user.id;

    // Validasyon
    console.log('Status validation:', status);
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      console.log('Invalid status:', status);
      return res.status(400).json({
        success: false,
        message: 'Geçersiz durum değeri'
      });
    }

    // İşlem var mı kontrol et
    console.log('Checking if transaction exists:', id);
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id, status FROM transactions WHERE id = ?',
      [id]
    );

    console.log('Existing transaction:', existing);

    if (existing.length === 0) {
      console.log('Transaction not found');
      return res.status(404).json({
        success: false,
        message: 'İşlem bulunamadı'
      });
    }

    const oldStatus = existing[0].status;
    console.log('Old status:', oldStatus, 'New status:', status);

    // Durumu güncelle
    console.log('Updating transaction status...');
    await req.app.locals.pool.promise().query(
      'UPDATE transactions SET status = ?, status_notes = ?, status_changed_by = ?, status_changed_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, notes || null, userId, id]
    );
    console.log('Transaction status updated successfully');

    // History'ye kaydet
    console.log('Saving to transaction history...');
    await req.app.locals.pool.promise().query(
      'INSERT INTO transaction_history (transaction_id, personnel_id, action, field_name, old_value, new_value, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, userId, 'status_changed', 'status', oldStatus, status, notes || `Durum ${oldStatus} → ${status} olarak değiştirildi`]
    );
    console.log('Transaction history saved successfully');

    console.log('Status update completed successfully');
    res.json({
      success: true,
      message: 'İşlem durumu başarıyla güncellendi'
    });
  } catch (error) {
    console.error('İşlem durumu güncelleme hatası:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'İşlem durumu güncellenirken hata oluştu',
      error: error.message
    });
  }
});

// Mevcut işlemleri kontrol et
router.get('/check-data', authenticateToken, async (req, res) => {
  try {
    // Toplam işlem sayısı
    const [countResult] = await req.app.locals.pool.promise().query(
      'SELECT COUNT(*) as total FROM transactions'
    );
    
    // Son 5 işlem
    const [recentTransactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.amount,
        t.description,
        t.transaction_date,
        t.status,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      ORDER BY t.transaction_date DESC
      LIMIT 5
    `);
    
    // Kategori bazında dağılım
    const [categoryStats] = await req.app.locals.pool.promise().query(`
      SELECT 
        tc.name as category_name,
        COUNT(*) as count,
        SUM(t.amount) as total_amount
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      GROUP BY tc.id, tc.name
      ORDER BY total_amount DESC
    `);
    
    res.json({
      success: true,
      data: {
        totalTransactions: countResult[0].total,
        recentTransactions,
        categoryStats
      }
    });
  } catch (error) {
    console.error('Veri kontrol hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Veri kontrol edilirken hata oluştu',
      error: error.message
    });
  }
});

// Test verileri ekle (sadece development için)
router.post('/add-test-data', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log('=== ADDING TEST DATA ===');
    console.log('User ID:', userId);
    
    // Önce mevcut işlem sayısını kontrol et
    const [existingCount] = await req.app.locals.pool.promise().query(
      'SELECT COUNT(*) as total FROM transactions'
    );
    console.log('Existing transactions before adding:', existingCount[0].total);
    
    // Test işlemleri
    const testTransactions = [
      // Ocak 2024
      { amount: 1500.00, description: 'Yakıt alımı', transaction_date: '2024-01-15', category_id: 1, vehicle_id: 1, personnel_id: 1 },
      { amount: 2500.00, description: 'Bakım onarım', transaction_date: '2024-01-20', category_id: 2, vehicle_id: 2, personnel_id: 2 },
      { amount: 800.00, description: 'Temizlik malzemeleri', transaction_date: '2024-01-25', category_id: 3, vehicle_id: 1, personnel_id: 3 },
      
      // Şubat 2024
      { amount: 1800.00, description: 'Yakıt alımı', transaction_date: '2024-02-10', category_id: 1, vehicle_id: 2, personnel_id: 1 },
      { amount: 3200.00, description: 'Lastik değişimi', transaction_date: '2024-02-18', category_id: 2, vehicle_id: 1, personnel_id: 2 },
      { amount: 1200.00, description: 'Ofis malzemeleri', transaction_date: '2024-02-25', category_id: 3, vehicle_id: 2, personnel_id: 3 },
      
      // Mart 2024
      { amount: 2000.00, description: 'Yakıt alımı', transaction_date: '2024-03-05', category_id: 1, vehicle_id: 1, personnel_id: 1 },
      { amount: 4500.00, description: 'Motor bakımı', transaction_date: '2024-03-15', category_id: 2, vehicle_id: 2, personnel_id: 2 },
      { amount: 900.00, description: 'Temizlik hizmeti', transaction_date: '2024-03-22', category_id: 3, vehicle_id: 1, personnel_id: 3 },
      
      // Nisan 2024
      { amount: 1600.00, description: 'Yakıt alımı', transaction_date: '2024-04-08', category_id: 1, vehicle_id: 2, personnel_id: 1 },
      { amount: 2800.00, description: 'Fren sistemi bakımı', transaction_date: '2024-04-16', category_id: 2, vehicle_id: 1, personnel_id: 2 },
      { amount: 1100.00, description: 'Kırtasiye malzemeleri', transaction_date: '2024-04-25', category_id: 3, vehicle_id: 2, personnel_id: 3 },
      
      // Mayıs 2024
      { amount: 1900.00, description: 'Yakıt alımı', transaction_date: '2024-05-12', category_id: 1, vehicle_id: 1, personnel_id: 1 },
      { amount: 3800.00, description: 'Şanzıman bakımı', transaction_date: '2024-05-20', category_id: 2, vehicle_id: 2, personnel_id: 2 },
      { amount: 950.00, description: 'Temizlik malzemeleri', transaction_date: '2024-05-28', category_id: 3, vehicle_id: 1, personnel_id: 3 },
      
      // Haziran 2024
      { amount: 2200.00, description: 'Yakıt alımı', transaction_date: '2024-06-03', category_id: 1, vehicle_id: 2, personnel_id: 1 },
      { amount: 5200.00, description: 'Klima bakımı', transaction_date: '2024-06-14', category_id: 2, vehicle_id: 1, personnel_id: 2 },
      { amount: 1300.00, description: 'Ofis ekipmanları', transaction_date: '2024-06-25', category_id: 3, vehicle_id: 2, personnel_id: 3 },
      
      // Temmuz 2024
      { amount: 1700.00, description: 'Yakıt alımı', transaction_date: '2024-07-07', category_id: 1, vehicle_id: 1, personnel_id: 1 },
      { amount: 3000.00, description: 'Elektrik sistemi', transaction_date: '2024-07-18', category_id: 2, vehicle_id: 2, personnel_id: 2 },
      { amount: 1000.00, description: 'Temizlik hizmeti', transaction_date: '2024-07-26', category_id: 3, vehicle_id: 1, personnel_id: 3 },
      
      // Ağustos 2024
      { amount: 2100.00, description: 'Yakıt alımı', transaction_date: '2024-08-09', category_id: 1, vehicle_id: 2, personnel_id: 1 },
      { amount: 4200.00, description: 'Süspansiyon bakımı', transaction_date: '2024-08-21', category_id: 2, vehicle_id: 1, personnel_id: 2 },
      { amount: 1150.00, description: 'Kırtasiye malzemeleri', transaction_date: '2024-08-29', category_id: 3, vehicle_id: 2, personnel_id: 3 },
      
      // Eylül 2024
      { amount: 1800.00, description: 'Yakıt alımı', transaction_date: '2024-09-04', category_id: 1, vehicle_id: 1, personnel_id: 1 },
      { amount: 3500.00, description: 'Yağ değişimi', transaction_date: '2024-09-15', category_id: 2, vehicle_id: 2, personnel_id: 2 },
      { amount: 1050.00, description: 'Temizlik malzemeleri', transaction_date: '2024-09-23', category_id: 3, vehicle_id: 1, personnel_id: 3 },
      
      // Ekim 2024
      { amount: 2400.00, description: 'Yakıt alımı', transaction_date: '2024-10-08', category_id: 1, vehicle_id: 2, personnel_id: 1 },
      { amount: 4800.00, description: 'Fren balata değişimi', transaction_date: '2024-10-19', category_id: 2, vehicle_id: 1, personnel_id: 2 },
      { amount: 1250.00, description: 'Ofis malzemeleri', transaction_date: '2024-10-27', category_id: 3, vehicle_id: 2, personnel_id: 3 },
      
      // Kasım 2024
      { amount: 1600.00, description: 'Yakıt alımı', transaction_date: '2024-11-05', category_id: 1, vehicle_id: 1, personnel_id: 1 },
      { amount: 3300.00, description: 'Filtre değişimi', transaction_date: '2024-11-16', category_id: 2, vehicle_id: 2, personnel_id: 2 },
      { amount: 1100.00, description: 'Temizlik hizmeti', transaction_date: '2024-11-24', category_id: 3, vehicle_id: 1, personnel_id: 3 },
      
      // Aralık 2024
      { amount: 2000.00, description: 'Yakıt alımı', transaction_date: '2024-12-02', category_id: 1, vehicle_id: 2, personnel_id: 1 },
      { amount: 5500.00, description: 'Genel bakım', transaction_date: '2024-12-12', category_id: 2, vehicle_id: 1, personnel_id: 2 },
      { amount: 1400.00, description: 'Yıl sonu temizlik', transaction_date: '2024-12-20', category_id: 3, vehicle_id: 2, personnel_id: 3 }
    ];

    let addedCount = 0;
    
    for (const transaction of testTransactions) {
      try {
        const [result] = await req.app.locals.pool.promise().query(
          'INSERT INTO transactions (vehicle_id, category_id, description, amount, expense, is_expense, transaction_date, personnel_id, status, status_changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [transaction.vehicle_id, transaction.category_id, transaction.description, transaction.amount, transaction.amount * 0.7, true, transaction.transaction_date, transaction.personnel_id, 'completed', userId]
        );

        // İşlem oluşturma history kaydı
        await req.app.locals.pool.promise().query(
          'INSERT INTO transaction_history (transaction_id, personnel_id, action, notes) VALUES (?, ?, ?, ?)',
          [result.insertId, userId, 'created', 'Test verisi olarak eklendi']
        );

        addedCount++;
      } catch (error) {
        console.error('Test işlemi ekleme hatası:', error);
      }
    }

    // Son işlem sayısını kontrol et
    const [finalCount] = await req.app.locals.pool.promise().query(
      'SELECT COUNT(*) as total FROM transactions'
    );
    console.log('Final transactions after adding:', finalCount[0].total);
    console.log('Successfully added:', addedCount, 'transactions');

    res.json({
      success: true,
      message: `${addedCount} adet test işlemi eklendi`,
      addedCount
    });
  } catch (error) {
    console.error('Test verileri ekleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Test verileri eklenirken hata oluştu',
      error: error.message
    });
  }
});

// İşlem istatistikleri endpoint'i
router.get('/stats/summary', authenticateToken, async (req, res) => {
  try {
    console.log('=== TRANSACTION STATS API CALL ===');
    console.log('Query params:', req.query);
    
    const { vehicle_id, personnel_id, category_id, start_date, end_date } = req.query;
    
    let whereConditions = [];
    let queryParams = [];
    
    if (vehicle_id) {
      whereConditions.push('t.vehicle_id = ?');
      queryParams.push(vehicle_id);
    }
    
    if (personnel_id) {
      whereConditions.push('t.personnel_id = ?');
      queryParams.push(personnel_id);
    }
    
    if (category_id) {
      whereConditions.push('t.category_id = ?');
      queryParams.push(category_id);
    }
    
    if (start_date) {
      whereConditions.push('t.transaction_date >= ?');
      queryParams.push(start_date);
    }
    
    if (end_date) {
      whereConditions.push('t.transaction_date <= ?');
      queryParams.push(end_date);
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    console.log('Stats where clause:', whereClause);
    console.log('Stats query params:', queryParams);
    
    // İstatistikleri hesapla
    const [statsResult] = await req.app.locals.pool.promise().query(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(amount) as total_amount,
        AVG(amount) as average_amount,
        MIN(amount) as min_amount,
        MAX(amount) as max_amount
      FROM transactions t
      ${whereClause}
    `, queryParams);
    
    console.log('Stats result:', statsResult[0]);
    
    const stats = statsResult[0];
    
    res.json({
      success: true,
      stats: {
        total_transactions: parseInt(stats.total_transactions) || 0,
        total_amount: parseFloat(stats.total_amount) || 0,
        average_amount: parseFloat(stats.average_amount) || 0,
        min_amount: parseFloat(stats.min_amount) || 0,
        max_amount: parseFloat(stats.max_amount) || 0
      }
    });
  } catch (error) {
    console.error('İşlem istatistikleri hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İşlem istatistikleri alınırken hata oluştu',
      error: error.message
    });
  }
});

// Aylık kar (profit) endpointi
router.get('/monthly-profit', authenticateToken, async (req, res) => {
  console.log('🚀 [BACKEND-DEBUG] /monthly-profit route başlatıldı', {
    timestamp: new Date().toISOString(),
    requestUrl: req.originalUrl,
    method: req.method,
    headers: {
      'content-type': req.headers['content-type'] || (req.method === 'GET' ? 'Not needed for GET' : 'Missing'),
      'user-agent': req.headers['user-agent']?.substring(0, 50) + '...',
      authorization: req.headers.authorization ? '[PRESENT]' : '[MISSING]'
    }
  });
  
  try {
    const { year, month } = req.query;
    console.log('📋 [BACKEND-DEBUG] Gelen parametreler detaylı:', { 
      year, 
      month, 
      yearType: typeof year,
      monthType: typeof month,
      allQueryParams: req.query,
      paramCount: Object.keys(req.query).length
    });
    console.log('👤 [BACKEND-DEBUG] Kullanıcı bilgisi detaylı:', { 
      userId: req.user?.id, 
      userRole: req.user?.role,
      userExists: !!req.user,
      tokenPayload: req.user
    });
    
    if (!year || !month) {
      console.error('❌ [BACKEND-DEBUG] Eksik parametreler:', { year, month });
      return res.status(400).json({ success: false, message: 'Yıl ve ay zorunludur' });
    }
    
    // Parametreleri sayıya çevir ve validate et
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    
    console.log('🔢 [BACKEND-DEBUG] Parametre validasyonu:', {
      yearNum,
      monthNum,
      yearValid: !isNaN(yearNum) && yearNum > 2000 && yearNum < 3000,
      monthValid: !isNaN(monthNum) && monthNum >= 1 && monthNum <= 12
    });
    
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      console.error('❌ [BACKEND-DEBUG] Geçersiz parametre formatı:', { yearNum, monthNum });
      return res.status(400).json({ success: false, message: 'Geçersiz yıl veya ay formatı' });
    }
    
    // Ayın ilk ve son günü
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(yearNum, monthNum, 0); // ay 1-12, gün 0 = son gün
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    console.log('📅 [BACKEND-DEBUG] Tarih aralığı hesaplandı:', { 
      startDate, 
      endDateStr,
      dayCount: endDate.getDate(),
      monthName: endDate.toLocaleString('tr-TR', { month: 'long' })
    });

    // Tüm işlemleri çek
    const query = `
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date BETWEEN ? AND ?
        AND t.status != 'cancelled'
      ORDER BY t.transaction_date ASC
    `;
    
    console.log('🔍 [BACKEND-DEBUG] SQL sorgusu hazırlandı:', {
      query: query.replace(/\s+/g, ' ').trim(),
      parametreCount: 2,
      parameters: [startDate, endDateStr]
    });
    
    console.log('💾 [BACKEND-DEBUG] Veritabanı sorgusu başlatılıyor...');
    console.time('DB_QUERY_DURATION');
    
    const [transactions] = await req.app.locals.pool.promise().query(query, [startDate, endDateStr]);
    
    console.timeEnd('DB_QUERY_DURATION');
    console.log('📊 [BACKEND-DEBUG] Sorgu sonucu detaylı:', { 
      transactionCount: transactions.length,
      firstTransaction: transactions[0] || null,
      lastTransaction: transactions[transactions.length - 1] || null,
      sampleTransactions: transactions.slice(0, 3).map(t => ({
        id: t.id,
        amount: t.amount,
        expense: t.expense,
        is_expense: t.is_expense,
        date: t.transaction_date,
        category: t.category_name
      })),
      dateRange: {
        earliest: transactions.length > 0 ? transactions[0]?.transaction_date : 'N/A',
        latest: transactions.length > 0 ? transactions[transactions.length - 1]?.transaction_date : 'N/A'
      }
    });
    
    if (transactions.length === 0) {
      console.warn('⚠️ [BACKEND-DEBUG] Seçilen dönemde hiç işlem bulunamadı:', {
        period: `${startDate} - ${endDateStr}`,
        queryUsed: query.replace(/\s+/g, ' ').trim()
      });
    }

    console.log('🔄 [BACKEND-DEBUG] ProfitCalculator hesaplamaları başlatılıyor...');
    console.time('PROFIT_CALCULATION_DURATION');
    
    // ProfitCalculator ile kar hesaplaması
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    console.log('1️⃣ [BACKEND-DEBUG] Summary hesaplandı:', summary);
    
    const byCategory = ProfitCalculator.calculateSimpleCategoryBreakdown(transactions, summary.totalRevenue);
    console.log('2️⃣ [BACKEND-DEBUG] Category breakdown hesaplandı:', {
      categoryCount: byCategory.length,
      categories: byCategory.map(c => ({ name: c.category, profit: c.profit }))
    });
    
    const byVehicle = ProfitCalculator.calculateSimpleVehicleBreakdown(transactions, summary.totalRevenue);
    console.log('3️⃣ [BACKEND-DEBUG] Vehicle breakdown hesaplandı:', {
      vehicleCount: byVehicle.length,
      vehicles: byVehicle.map(v => ({ plate: v.vehicle, profit: v.profit }))
    });
    
    const byPersonnel = ProfitCalculator.calculateSimplePersonnelBreakdown(transactions, summary.totalRevenue);
    console.log('4️⃣ [BACKEND-DEBUG] Personnel breakdown hesaplandı:', {
      personnelCount: byPersonnel.length,
      personnel: byPersonnel.map(p => ({ name: p.personnel, profit: p.profit }))
    });
    
    console.timeEnd('PROFIT_CALCULATION_DURATION');

    console.log('📈 [BACKEND-DEBUG] ProfitCalculator ile hesaplamalar tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      totalExpense: summary.totalExpense,
      totalProfit: summary.totalProfit,
      profitMargin: summary.profitMargin,
      categoryCount: byCategory.length,
      vehicleCount: byVehicle.length,
      personnelCount: byPersonnel.length
    });

    console.log('📦 [BACKEND-DEBUG] Response objesi hazırlanıyor...');
    console.time('RESPONSE_PREPARATION');
    
    // Response objesini hazırla
    const responseData = {
      success: true,
      message: 'Aylık kar analizi başarıyla alındı',
      data: {
        basicAnalysis: {
          rapor_bölümü: 'Aylık Kar Analizi',
          analiz_periyodu: `${yearNum}/${String(monthNum).padStart(2, '0')}`,
          toplam_gelir: summary.totalRevenue,
          toplam_gider: summary.totalExpense,
          net_kar: summary.totalProfit,
          kar_marji_yuzde: summary.profitMargin,
          toplam_islem_sayisi: summary.transactionCount,
          ortalama_islem_tutari: summary.averageTransaction
        },
        categoryAnalysis: byCategory,
        vehicleAnalysis: byVehicle,
        personnelAnalysis: byPersonnel,
        dailyTrend: [], // Bu özellik henüz implement edilmedi
        topProfitableTransactions: [], // Bu özellik henüz implement edilmedi
        generalStats: {
          rapor_bölümü: 'Genel İstatistikler',
          gelir_islem_sayisi: transactions.filter(t => !t.is_expense).length,
          gider_islem_sayisi: transactions.filter(t => t.is_expense).length,
          max_gelir_islem: Math.max(...transactions.filter(t => !t.is_expense).map(t => t.amount), 0),
          max_gider_islem: Math.max(...transactions.filter(t => t.is_expense).map(t => t.expense || 0), 0),
          ortalama_gelir_islem: transactions.filter(t => !t.is_expense).length > 0 
            ? transactions.filter(t => !t.is_expense).reduce((sum, t) => sum + t.amount, 0) / transactions.filter(t => !t.is_expense).length 
            : 0,
          ortalama_gider_islem: transactions.filter(t => t.is_expense).length > 0 
            ? transactions.filter(t => t.is_expense).reduce((sum, t) => sum + (t.expense || 0), 0) / transactions.filter(t => t.is_expense).length 
            : 0,
          aktif_arac_sayisi: [...new Set(transactions.filter(t => t.vehicle_plate).map(t => t.vehicle_plate))].length,
          aktif_personel_sayisi: [...new Set(transactions.filter(t => t.personnel_name).map(t => t.personnel_name))].length,
          aktif_kategori_sayisi: [...new Set(transactions.filter(t => t.category_name).map(t => t.category_name))].length
        },
        transactions: transactions.map(t => ({
          id: t.id,
          amount: t.amount,
          expense: t.expense,
          profit: (t.amount || 0) - (t.expense || 0),
          description: t.description,
          transaction_date: t.transaction_date,
          category_name: t.category_name,
          vehicle_plate: t.vehicle_plate,
          personnel_name: t.personnel_name,
          is_expense: !!t.is_expense
        })),
        metadata: {
          rapor_tarihi: new Date().toISOString(),
          rapor_saati: new Date().toLocaleTimeString('tr-TR'),
          veri_kaynagi: 'MySQL Database',
          hesaplama_suresi_ms: 'Will be calculated',
          toplam_kayit_sayisi: transactions.length,
          filtre_kriterleri: {
            baslangic_tarihi: startDate,
            bitis_tarihi: endDateStr,
            durum_filtresi: "status != 'cancelled'"
          }
        }
      }
    };
    
    console.timeEnd('RESPONSE_PREPARATION');
    console.log('📦 [BACKEND-DEBUG] Response objesi hazırlandı:', {
      responseStructure: {
        success: responseData.success,
        hasBasicAnalysis: !!responseData.data.basicAnalysis,
        categoryCount: responseData.data.categoryAnalysis.length,
        vehicleCount: responseData.data.vehicleAnalysis.length,
        personnelCount: responseData.data.personnelAnalysis.length,
        transactionCount: responseData.data.transactions.length,
        hasMetadata: !!responseData.data.metadata
      },
      dataSize: JSON.stringify(responseData).length + ' characters'
    });
    
    console.log('✅ [BACKEND-DEBUG] Response basariyla hazirlandi, clienta gonderiliyor...');
    res.json(responseData);
    console.log('🏁 [BACKEND-DEBUG] /monthly-profit route basariyla tamamlandi', {
      totalDuration: Date.now() - (new Date().getTime()),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('💥 [BACKEND-DEBUG] Aylık kar alınırken kritik hata oluştu:', {
      errorMessage: error.message,
      errorName: error.name,
      errorCode: error.code,
      sqlState: error.sqlState,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
      requestParams: { year: req.query.year, month: req.query.month },
      userInfo: { userId: req.user?.id, role: req.user?.role }
    });
    
    // SQL hatasını kontrol et
    if (error.code && error.code.startsWith('ER_')) {
      console.error('🗄️ [BACKEND-DEBUG] MySQL specific error detected:', {
        sqlErrorCode: error.code,
        sqlState: error.sqlState,
        fieldCount: error.fieldCount,
        affectedRows: error.affectedRows
      });
    }
    
    // Connection hatasını kontrol et
    if (error.message && error.message.includes('connection')) {
      console.error('🔌 [BACKEND-DEBUG] Database connection error detected');
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Aylık kar alınırken hata oluştu', 
      error: error.message,
      errorCode: error.code || 'UNKNOWN_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

// Yıllık kar (profit) endpointi
router.get('/yearly-profit', authenticateToken, async (req, res) => {
  try {
    const { year } = req.query;
    if (!year) {
      return res.status(400).json({ success: false, message: 'Yıl zorunludur' });
    }

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    // Tüm işlemleri çek
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name,
        MONTH(t.transaction_date) as month
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date BETWEEN ? AND ?
        AND t.status != 'cancelled'
      ORDER BY t.transaction_date ASC
    `, [startDate, endDate]);

    // ProfitCalculator ile kar hesaplaması
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    const monthlyBreakdown = ProfitCalculator.calculateMonthlyBreakdown(transactions);
    const averageMonthlyProfit = summary.totalProfit / 12;

    res.json({
      success: true,
      data: {
        year: Number(year),
        summary: {
          totalRevenue: summary.totalRevenue,
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          totalTransactions: summary.transactionCount,
          averageMonthlyProfit,
          averageTransactionValue: summary.averageTransaction
        },
        monthlyBreakdown,
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          const profit = revenue - expense;
          
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: profit,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense
          };
        })
      }
    });
  } catch (error) {
    console.error('Yıllık kar alınırken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Yıllık kar alınırken hata oluştu', error: error.message });
  }
});

// Özel tarih aralığı kar (custom-profit) endpointi
router.get('/custom-profit', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, periodType } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Başlangıç ve bitiş tarihi zorunludur' });
    }

    // Tüm işlemleri çek
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name,
        DAYOFWEEK(t.transaction_date) as day_of_week,
        DAYNAME(t.transaction_date) as day_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date BETWEEN ? AND ?
      ORDER BY t.transaction_date ASC
    `, [startDate, endDate]);

    // ProfitCalculator ile kar hesaplaması
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    let dailyBreakdown = {};

    // Günlük dağılım hazırla
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay();
      dailyBreakdown[dateStr] = {
        day: dayOfWeek + 1,
        dayName: dayNames[dayOfWeek],
        date: dateStr,
        revenue: 0,
        expense: 0,
        profit: 0,
        profitMargin: 0,
        transactionCount: 0,
        transactions: []
      };
    }

    transactions.forEach(tx => {
      const dateStr = tx.transaction_date.split('T')[0];
      const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
      
      // Günlük breakdown
      if (dailyBreakdown[dateStr]) {
        dailyBreakdown[dateStr].revenue += revenue;
        dailyBreakdown[dateStr].expense += expense;
        dailyBreakdown[dateStr].transactionCount += 1;
        dailyBreakdown[dateStr].transactions.push({
          id: tx.id,
          amount: revenue,
          expense: expense,
          profit: revenue - expense,
          description: tx.description,
          transaction_date: tx.transaction_date,
          category_name: tx.category_name,
          vehicle_plate: tx.vehicle_plate,
          personnel_name: tx.personnel_name,
          is_expense: !!tx.is_expense
        });
      }
    });

    // Günlük kar ve marj hesapla
    Object.values(dailyBreakdown).forEach(day => {
      day.profit = day.revenue - day.expense;
      day.profitMargin = day.revenue > 0 ? ((day.profit / day.revenue) * 100) : 0;
    });

    res.json({
      success: true,
      data: {
        period: {
          startDate,
          endDate,
          periodType: periodType || 'custom'
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          transactionCount: summary.transactionCount,
          averageTransaction: summary.averageTransaction
        },
        dailyBreakdown: Object.values(dailyBreakdown),
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: revenue - expense,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense
          };
        })
      }
    });
  } catch (error) {
    console.error('Özel tarih kar alınırken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Özel tarih kar alınırken hata oluştu', error: error.message });
  }
});

// Kategori bazında aylık kar endpointi
router.get('/category-monthly-profit', authenticateToken, async (req, res) => {
  console.log('🚀 [BACKEND] /category-monthly-profit route başlatıldı');
  
  try {
    const { year, month, categoryIds } = req.query;
    console.log('📋 [BACKEND] Gelen parametreler:', { year, month, categoryIds, queryParams: req.query });
    
    if (!year || !month || !categoryIds) {
      console.error('❌ [BACKEND] Eksik parametreler:', { year, month, categoryIds });
      return res.status(400).json({ success: false, message: 'Yıl, ay ve kategori ID\'leri zorunludur' });
    }

    const categoryIdList = categoryIds.split(',').map(id => parseInt(id));
    console.log('🔢 [BACKEND] Kategori ID listesi:', categoryIdList);
    
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0);
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    console.log('📅 [BACKEND] Tarih aralığı hesaplandı:', { startDate, endDateStr });

    // Seçilen kategorilerdeki işlemleri çek
    const placeholders = categoryIdList.map(() => '?').join(',');
    const query = `
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        t.category_id,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date BETWEEN ? AND ? AND t.category_id IN (${placeholders})
      ORDER BY t.transaction_date ASC
    `;
    
    const [transactions] = await req.app.locals.pool.promise().query(query, [startDate, endDateStr, ...categoryIdList]);
    
    console.log('📊 [BACKEND] Kategori filtreli sorgu sonucu:', { 
      transactionCount: transactions.length,
      categoryCount: new Set(transactions.map(t => t.category_id)).size
    });

    // ProfitCalculator ile kategori bazında kar hesaplaması
    let categories = {};
    let totalTransactions = transactions.length;
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);

    transactions.forEach(tx => {
      const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
      
      if (!categories[tx.category_id]) {
        categories[tx.category_id] = {
          category_name: tx.category_name,
          totalRevenue: 0,
          totalExpense: 0,
          totalProfit: 0,
          profitMargin: 0,
          totalTransactions: 0
        };
      }
      
      categories[tx.category_id].totalRevenue += revenue;
      categories[tx.category_id].totalExpense += expense;
      categories[tx.category_id].totalTransactions += 1;
    });

    // Kar ve marj hesapla
    Object.values(categories).forEach(cat => {
      cat.totalProfit = cat.totalRevenue - cat.totalExpense;
      cat.profitMargin = cat.totalRevenue > 0 ? ((cat.totalProfit / cat.totalRevenue) * 100) : 0;
    });

    res.json({
      success: true,
      data: {
        period: {
          year: Number(year),
          month: Number(month),
          monthName: new Date(year, month - 1).toLocaleDateString('tr-TR', { month: 'long' })
        },
        categories: Object.values(categories),
        transactionCount: totalTransactions,
        averageTransaction: summary.averageTransaction,
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: revenue - expense,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense
          };
        })
      }
    });
  } catch (error) {
    console.error('Kategori aylık kar alınırken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Kategori aylık kar alınırken hata oluştu', error: error.message });
  }
});

// Kategori bazında yıllık kar endpointi
router.get('/category-yearly-profit', authenticateToken, async (req, res) => {
  try {
    const { year, categoryIds } = req.query;
    if (!year || !categoryIds) {
      return res.status(400).json({ success: false, message: 'Yıl ve kategori ID\'leri zorunludur' });
    }

    const categoryIdList = categoryIds.split(',').map(id => parseInt(id));
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const placeholders = categoryIdList.map(() => '?').join(',');
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        t.category_id,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name,
        MONTH(t.transaction_date) as month
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date BETWEEN ? AND ? AND t.category_id IN (${placeholders})
      ORDER BY t.transaction_date ASC
    `, [startDate, endDate, ...categoryIdList]);

    // ProfitCalculator ile kategori bazında kar hesaplaması
    let categories = {};
    let totalTransactions = transactions.length;
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);

    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
                       'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

    transactions.forEach(tx => {
      const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
      const month = tx.month;
      
      if (!categories[tx.category_id]) {
        categories[tx.category_id] = {
          category_name: tx.category_name,
          totalRevenue: 0,
          totalExpense: 0,
          totalProfit: 0,
          profitMargin: 0,
          totalTransactions: 0,
          monthlyBreakdown: {}
        };
        
        // Aylık breakdown initialize et
        for (let i = 1; i <= 12; i++) {
          categories[tx.category_id].monthlyBreakdown[i] = {
            month: i,
            monthName: monthNames[i - 1],
            revenue: 0,
            expense: 0,
            profit: 0,
            profitMargin: 0,
            transactionCount: 0
          };
        }
      }
      
      categories[tx.category_id].totalRevenue += revenue;
      categories[tx.category_id].totalExpense += expense;
      categories[tx.category_id].monthlyBreakdown[month].revenue += revenue;
      categories[tx.category_id].monthlyBreakdown[month].expense += expense;
      categories[tx.category_id].totalTransactions += 1;
      categories[tx.category_id].monthlyBreakdown[month].transactionCount += 1;
    });

    // Kar ve marj hesapla
    Object.values(categories).forEach(cat => {
      cat.totalProfit = cat.totalRevenue - cat.totalExpense;
      cat.profitMargin = cat.totalRevenue > 0 ? ((cat.totalProfit / cat.totalRevenue) * 100) : 0;
      
      // Aylık breakdown kar ve marj
      Object.values(cat.monthlyBreakdown).forEach(month => {
        month.profit = month.revenue - month.expense;
        month.profitMargin = month.revenue > 0 ? ((month.profit / month.revenue) * 100) : 0;
      });
      
      cat.monthlyBreakdown = Object.values(cat.monthlyBreakdown);
    });

    res.json({
      success: true,
      data: {
        year: Number(year),
        categories: Object.values(categories),
        totalTransactions,
        averageTransactionValue: summary.averageTransaction,
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: revenue - expense,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense
          };
        })
      }
    });
  } catch (error) {
    console.error('Kategori yıllık kar alınırken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Kategori yıllık kar alınırken hata oluştu', error: error.message });
  }
});

// Kategori bazında özel tarih kar endpointi
router.get('/category-custom-profit', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, periodType, categoryIds } = req.query;
    if (!startDate || !endDate || !categoryIds) {
      return res.status(400).json({ success: false, message: 'Başlangıç tarihi, bitiş tarihi ve kategori ID\'leri zorunludur' });
    }

    const categoryIdList = categoryIds.split(',').map(id => parseInt(id));
    const placeholders = categoryIdList.map(() => '?').join(',');

    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        t.category_id,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date BETWEEN ? AND ? AND t.category_id IN (${placeholders})
      ORDER BY t.transaction_date ASC
    `, [startDate, endDate, ...categoryIdList]);

    // ProfitCalculator ile kategori bazında kar hesaplaması
    let categories = {};
    let totalTransactions = transactions.length;
    let dailyBreakdown = {};
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);

    // Günlük dağılım hazırla
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay();
      dailyBreakdown[dateStr] = {
        day: dayOfWeek + 1,
        dayName: dayNames[dayOfWeek],
        date: dateStr,
        revenue: 0,
        expense: 0,
        profit: 0,
        profitMargin: 0,
        transactionCount: 0
      };
    }

    transactions.forEach(tx => {
      const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
      const dateStr = tx.transaction_date.split('T')[0];
      
      if (!categories[tx.category_id]) {
        categories[tx.category_id] = {
          category_name: tx.category_name,
          totalRevenue: 0,
          totalExpense: 0,
          totalProfit: 0,
          profitMargin: 0,
          totalTransactions: 0
        };
      }
      
      categories[tx.category_id].totalRevenue += revenue;
      categories[tx.category_id].totalExpense += expense;
      categories[tx.category_id].totalTransactions += 1;
      
      // Günlük breakdown
      if (dailyBreakdown[dateStr]) {
        dailyBreakdown[dateStr].revenue += revenue;
        dailyBreakdown[dateStr].expense += expense;
        dailyBreakdown[dateStr].transactionCount += 1;
      }
    });

    // Kar ve marj hesapla
    Object.values(categories).forEach(cat => {
      cat.totalProfit = cat.totalRevenue - cat.totalExpense;
      cat.profitMargin = cat.totalRevenue > 0 ? ((cat.totalProfit / cat.totalRevenue) * 100) : 0;
    });

    // Günlük kar ve marj hesapla
    Object.values(dailyBreakdown).forEach(day => {
      day.profit = day.revenue - day.expense;
      day.profitMargin = day.revenue > 0 ? ((day.profit / day.revenue) * 100) : 0;
    });

    res.json({
      success: true,
      data: {
        period: {
          startDate,
          endDate,
          periodType: periodType || 'custom'
        },
        categories: Object.values(categories),
        transactionCount: totalTransactions,
        averageTransaction: summary.averageTransaction,
        dailyBreakdown: Object.values(dailyBreakdown),
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: revenue - expense,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense
          };
        })
      }
    });
  } catch (error) {
    console.error('Kategori özel tarih kar alınırken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Kategori özel tarih kar alınırken hata oluştu', error: error.message });
  }
});

// Haftalık kar (weekly profit) endpointi
router.get('/weekly-profit', authenticateToken, async (req, res) => {
  console.log('🚀 [BACKEND] /weekly-profit route başlatıldı');
  
  try {
    const { startDate, endDate } = req.query;
    console.log('📋 [BACKEND] Gelen parametreler:', { startDate, endDate });
    
    if (!startDate || !endDate) {
      console.error('❌ [BACKEND] Eksik parametreler:', { startDate, endDate });
      return res.status(400).json({ success: false, message: 'Başlangıç ve bitiş tarihi zorunludur' });
    }

    // Haftalık işlemleri çek
    const query = `
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date BETWEEN ? AND ?
        AND t.status != 'cancelled'
      ORDER BY t.transaction_date ASC
    `;
    
    const [transactions] = await req.app.locals.pool.promise().query(query, [startDate, endDate]);
    
    console.log('📊 [BACKEND] Sorgu sonucu:', { 
      transactionCount: transactions.length
    });

    // ProfitCalculator ile kar hesaplaması
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    let dailyBreakdown = {};

    // Günlük breakdown için günleri initialize et
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    const currentDate = new Date(startDate);

    while (currentDate <= endDateObj) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
      
      dailyBreakdown[dateStr] = {
        date: dateStr,
        dayName: dayNames[currentDate.getDay()],
        revenue: 0,
        expense: 0,
        profit: 0,
        transactionCount: 0,
        transactions: []
      };
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log('🧮 [BACKEND] Hesaplamalara başlanıyor...');

    transactions.forEach(tx => {
      const txDate = tx.transaction_date.split('T')[0];
      const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
      
      // Günlük breakdown'a ekle
      if (dailyBreakdown[txDate]) {
        dailyBreakdown[txDate].revenue += revenue;
        dailyBreakdown[txDate].expense += expense;
        dailyBreakdown[txDate].transactionCount += 1;
        dailyBreakdown[txDate].transactions.push({
          id: tx.id,
          amount: revenue,
          expense: expense,
          profit: revenue - expense,
          description: tx.description,
          transaction_date: tx.transaction_date,
          category_name: tx.category_name,
          vehicle_plate: tx.vehicle_plate,
          personnel_name: tx.personnel_name,
          is_expense: !!tx.is_expense
        });
      }
    });

    // Günlük kar hesapla
    Object.values(dailyBreakdown).forEach(day => {
      day.profit = day.revenue - day.expense;
    });

    console.log('📈 [BACKEND] ProfitCalculator ile hesaplamalar tamamlandı');
    
    const responseData = {
      success: true,
      data: {
        period: {
          startDate: startDate,
          endDate: endDate,
          periodType: 'weekly'
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          transactionCount: summary.transactionCount,
          averageTransaction: summary.averageTransaction
        },
        dailyBreakdown: Object.values(dailyBreakdown),
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          const profit = revenue - expense;
          
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: profit,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense
          };
        })
      }
    };
    
    console.log('✅ [BACKEND] Response hazırlandı');
    res.json(responseData);
    console.log('🏁 [BACKEND] /weekly-profit route tamamlandı');
    
  } catch (error) {
    console.error('💥 [BACKEND] Haftalık kar alınırken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Haftalık kar alınırken hata oluştu', error: error.message });
  }
});

// Günlük kar (daily profit) endpointi
router.get('/daily-profit', authenticateToken, async (req, res) => {
  console.log('🚀 [BACKEND] /daily-profit route başlatıldı');
  
  try {
    const { date } = req.query;
    console.log('📋 [BACKEND] Gelen parametreler:', { date });
    
    if (!date) {
      console.error('❌ [BACKEND] Eksik parametreler:', { date });
      return res.status(400).json({ success: false, message: 'Tarih zorunludur' });
    }

    // Günlük işlemleri çek
    const query = `
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE DATE(t.transaction_date) = ?
        AND t.status != 'cancelled'
      ORDER BY t.transaction_date ASC
    `;
    
    const [transactions] = await req.app.locals.pool.promise().query(query, [date]);
    
    console.log('📊 [BACKEND] Sorgu sonucu:', { 
      transactionCount: transactions.length
    });

    // ProfitCalculator ile kar hesaplaması
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);

    console.log('🧮 [BACKEND] ProfitCalculator ile hesaplamalar tamamlandı');

    // Gün adını hesapla
    const dateObj = new Date(date);
    const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const dayName = dayNames[dateObj.getDay()];

    const response = {
      success: true,
      data: {
        period: {
          startDate: date,
          endDate: date,
          periodType: 'daily'
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          transactionCount: summary.transactionCount,
          averageTransaction: summary.averageTransaction
        },
        dailyBreakdown: [{
          date: date,
          dayName: dayName,
          revenue: summary.totalRevenue,
          expense: summary.totalExpense,
          profit: summary.totalProfit,
          transactionCount: summary.transactionCount
        }],
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          const profit = revenue - expense;
          
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: profit,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense
          };
        })
      }
    };

    console.log('✅ [BACKEND] Response hazırlandı');
    res.json(response);
    console.log('🏁 [BACKEND] /daily-profit route tamamlandı');
    
  } catch (error) {
    console.error('💥 [BACKEND] Günlük kar alınırken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Günlük kar alınırken hata oluştu', error: error.message });
  }
});

// Standardize edilmiş aylık kar analizi endpoint'i (profit.js'den taşındı)
router.get('/profit-analysis/monthly/:year/:month', authenticateToken, async (req, res) => {
  console.log('🚀 [BACKEND-DEBUG] /profit-analysis/monthly route başlatıldı', {
    timestamp: new Date().toISOString(),
    requestUrl: req.originalUrl,
    method: req.method,
    params: req.params,
    headers: {
      'content-type': req.headers['content-type'] || (req.method === 'GET' ? 'Not needed for GET' : 'Missing'),
      'user-agent': req.headers['user-agent']?.substring(0, 50) + '...',
      authorization: req.headers.authorization ? '[PRESENT]' : '[MISSING]'
    }
  });

  try {
    const { year, month } = req.params;
    const userId = req.user.id;
    
    console.log('📋 [BACKEND-DEBUG] Gelen parametreler detaylı:', { 
      year, 
      month, 
      yearType: typeof year,
      monthType: typeof month,
      userId,
      userInfo: {
        userId: req.user?.id,
        userRole: req.user?.role,
        userExists: !!req.user
      }
    });
    
    logger.apiRequest('GET', `/transactions/profit-analysis/monthly/${year}/${month}`, userId);

    // Parametreleri doğrula
    const analysisYear = parseInt(year);
    const analysisMonth = parseInt(month);
    
    console.log('🔢 [BACKEND-DEBUG] Parametre validasyonu:', {
      analysisYear,
      analysisMonth,
      yearValid: !isNaN(analysisYear) && analysisYear > 2000 && analysisYear < 3000,
      monthValid: !isNaN(analysisMonth) && analysisMonth >= 1 && analysisMonth <= 12
    });
    
    if (!analysisYear || !analysisMonth || analysisMonth < 1 || analysisMonth > 12) {
      console.error('❌ [BACKEND-DEBUG] Geçersiz parametreler:', { analysisYear, analysisMonth });
      return res.status(400).json({
        success: false,
        message: 'Geçersiz yıl veya ay parametresi'
      });
    }

    // Ayın ilk ve son günü
    const startDate = `${analysisYear}-${String(analysisMonth).padStart(2, '0')}-01`;
    const endDate = new Date(analysisYear, analysisMonth, 0);
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    console.log('📅 [BACKEND-DEBUG] Tarih aralığı hesaplandı:', { 
      startDate, 
      endDateStr,
      dayCount: endDate.getDate(),
      monthName: endDate.toLocaleString('tr-TR', { month: 'long' })
    });

    console.log('💾 [BACKEND-DEBUG] Veritabanı sorgusu başlatılıyor...');
    console.time('DB_QUERY_DURATION');

    // Ham veriyi çek
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        t.payment_method,
        t.status,
        t.vehicle_id,
        t.personnel_id,
        t.category_id,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date BETWEEN ? AND ?
        AND t.status != 'cancelled'
      ORDER BY t.transaction_date DESC
    `, [startDate, endDateStr]);

    console.timeEnd('DB_QUERY_DURATION');
    console.log('📊 [BACKEND-DEBUG] Sorgu sonucu detaylı:', { 
      transactionCount: transactions.length,
      firstTransaction: transactions[0] || null,
      lastTransaction: transactions[transactions.length - 1] || null,
      sampleTransactions: transactions.slice(0, 3).map(t => ({
        id: t.id,
        amount: t.amount,
        expense: t.expense,
        is_expense: t.is_expense,
        date: t.transaction_date,
        category: t.category_name
      })),
      dateRange: {
        earliest: transactions.length > 0 ? transactions[0]?.transaction_date : 'N/A',
        latest: transactions.length > 0 ? transactions[transactions.length - 1]?.transaction_date : 'N/A'
      }
    });
    
    if (transactions.length === 0) {
      console.warn('⚠️ [BACKEND-DEBUG] Seçilen dönemde hiç işlem bulunamadı:', {
        period: `${startDate} - ${endDateStr}`,
        queryUsed: query.replace(/\s+/g, ' ').trim()
      });
    }

    console.log('🔄 [BACKEND-DEBUG] ProfitCalculator hesaplamaları başlatılıyor...');
    console.time('PROFIT_CALCULATION_DURATION');
    
    // ProfitCalculator ile kar hesaplaması
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    console.log('1️⃣ [BACKEND-DEBUG] Summary hesaplandı:', summary);
    
    const byCategory = ProfitCalculator.calculateSimpleCategoryBreakdown(transactions, summary.totalRevenue);
    console.log('2️⃣ [BACKEND-DEBUG] Category breakdown hesaplandı:', {
      categoryCount: byCategory.length,
      categories: byCategory.map(c => ({ name: c.category, profit: c.profit }))
    });
    
    const byVehicle = ProfitCalculator.calculateSimpleVehicleBreakdown(transactions, summary.totalRevenue);
    console.log('3️⃣ [BACKEND-DEBUG] Vehicle breakdown hesaplandı:', {
      vehicleCount: byVehicle.length,
      vehicles: byVehicle.map(v => ({ plate: v.vehicle, profit: v.profit }))
    });
    
    const byPersonnel = ProfitCalculator.calculateSimplePersonnelBreakdown(transactions, summary.totalRevenue);
    console.log('4️⃣ [BACKEND-DEBUG] Personnel breakdown hesaplandı:', {
      personnelCount: byPersonnel.length,
      personnel: byPersonnel.map(p => ({ name: p.personnel, profit: p.profit }))
    });
    
    console.timeEnd('PROFIT_CALCULATION_DURATION');

    console.log('📈 [BACKEND-DEBUG] ProfitCalculator ile hesaplamalar tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      totalExpense: summary.totalExpense,
      netProfit: summary.totalProfit,
      categories: byCategory.length,
      vehicles: byVehicle.length,
      personnel: byPersonnel.length
    });

    console.log('📦 [BACKEND-DEBUG] Response objesi hazırlanıyor...');
    console.time('RESPONSE_PREPARATION');
    
    // Response objesini hazırla
    const responseData = {
      success: true,
      message: 'Kar analizi başarıyla getirildi',
      data: {
        period: {
          year: analysisYear,
          month: analysisMonth,
          monthName: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                     'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][analysisMonth - 1],
          startDate: startDate,
          endDate: endDateStr,
          periodType: 'monthly'
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          transactionCount: summary.transactionCount,
          averageTransaction: summary.averageTransaction
        },
        breakdown: {
          byCategory,
          byVehicle,
          byPersonnel
        },
        dailyTrend: [], // Bu özellik henüz implement edilmedi
        topTransactions: [], // Bu özellik henüz implement edilmedi
        generalStats: {
          revenueTransactionCount: summary.transactionCount,
          expenseTransactionCount: 0,
          maxRevenueTransaction: summary.totalRevenue,
          maxExpenseTransaction: 0,
          averageRevenueTransaction: summary.averageTransaction,
          averageExpenseTransaction: 0,
          activeVehicleCount: 0,
          activePersonnelCount: 0,
          activeCategoryCount: 0
        },
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: revenue - expense,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense,
            payment_method: tx.payment_method,
            status: tx.status
          };
        })
      }
    };
    
    console.timeEnd('RESPONSE_PREPARATION');
    console.log('📦 [BACKEND-DEBUG] Response objesi hazırlandı:', {
      responseStructure: {
        success: responseData.success,
        hasSummary: !!responseData.data.summary,
        categoryCount: responseData.data.breakdown.byCategory.length,
        vehicleCount: responseData.data.breakdown.byVehicle.length,
        personnelCount: responseData.data.breakdown.byPersonnel.length,
        transactionCount: responseData.data.transactions.length,
        hasPeriod: !!responseData.data.period
      },
      dataSize: JSON.stringify(responseData).length + ' characters'
    });
    
         console.log('✅ [BACKEND-DEBUG] Response basariyla hazirlandi, clienta gonderiliyor...');
     res.json(responseData);
     console.log('🏁 [BACKEND-DEBUG] /profit-analysis/monthly route basariyla tamamlandi', {
      totalDuration: Date.now() - (new Date().getTime()),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('💥 [BACKEND-DEBUG] Kar analizi hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kar analizi getirilirken hata oluştu',
      error: error.message
    });
  }
});

// Standardize edilmiş yıllık kar analizi endpoint'i (profit.js'den taşındı)
router.get('/profit-analysis/yearly/:year', authenticateToken, async (req, res) => {
  try {
    const { year } = req.params;
    const userId = req.user.id;
    
    logger.apiRequest('GET', `/transactions/profit-analysis/yearly/${year}`, userId);

    const analysisYear = parseInt(year);
    
    if (!analysisYear) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz yıl parametresi'
      });
    }

    const startDate = `${analysisYear}-01-01`;
    const endDate = `${analysisYear}-12-31`;

    // Ham veriyi çek
    const [transactions] = await req.app.locals.pool.promise().query(`
      SELECT 
        t.id,
        t.amount,
        t.expense,
        t.is_expense,
        t.description,
        t.transaction_date,
        t.payment_method,
        t.status,
        t.vehicle_id,
        t.personnel_id,
        t.category_id,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name,
        MONTH(t.transaction_date) as month
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE YEAR(t.transaction_date) = ?
        AND t.status != 'cancelled'
      ORDER BY t.transaction_date DESC
    `, [analysisYear]);

    console.log(`📊 [BACKEND] ${transactions.length} yıllık transaction bulundu, standardize edilmiş analiz başlatılıyor...`);

    // ProfitCalculator ile yıllık hesaplamalar
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    const monthlyBreakdown = ProfitCalculator.calculateMonthlyBreakdown(transactions);

    console.log('✅ [BACKEND] Standardize edilmiş yıllık kar hesaplamaları tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      totalExpense: summary.totalExpense,
      netProfit: summary.totalProfit,
      monthsWithData: monthlyBreakdown.filter(m => m.transactionCount > 0).length
    });

    // Activity log
    try { 
      await Activity.create(userId, 'Yıllık kar analizi görüntülendi', { 
        year: analysisYear 
      }); 
    } catch (e) { 
      console.error('Activity log error:', e); 
    }

    // Standardize edilmiş response format 
    res.json({
      success: true,
      message: 'Yıllık kar analizi başarıyla getirildi',
      data: {
        period: {
          year: analysisYear,
          startDate: startDate,
          endDate: endDate,
          periodType: 'yearly'
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          totalTransactions: summary.transactionCount,
          averageMonthlyProfit: summary.totalProfit / 12,
          averageTransactionValue: summary.averageTransaction
        },
        monthlyBreakdown,
        transactions: transactions.map(tx => {
          const { revenue, expense } = ProfitCalculator.calculateAmounts(tx);
          return {
            id: tx.id,
            amount: revenue,
            expense: expense,
            profit: revenue - expense,
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name,
            is_expense: !!tx.is_expense,
            payment_method: tx.payment_method,
            status: tx.status
          };
        })
      }
    });

  } catch (error) {
    console.error('💥 [BACKEND] Yıllık kar analizi hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Yıllık kar analizi getirilirken hata oluştu',
      error: error.message
    });
  }
});

module.exports = router; 