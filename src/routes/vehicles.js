const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const Activity = require('../models/activityModel');
const logger = require('../utils/logger');

// Tüm araçları getir (pagination ile)
router.get('/', authenticateToken, async (req, res) => {
  try {
    logger.apiRequest('GET', '/vehicles', req.user?.id, { 
      role: req.user?.role,
      queryParams: req.query 
    });
    
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT id, plate, year, customer_email, customer_phone, created_at FROM vehicles';
    let countQuery = 'SELECT COUNT(*) as total FROM vehicles';
    let queryParams = [];
    let countParams = [];
    
    // Search filter
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      query += ' WHERE plate LIKE ?';
      countQuery += ' WHERE plate LIKE ?';
      queryParams = [searchTerm];
      countParams = [searchTerm];
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    queryParams.push(parseInt(limit), offset);
    
    const [vehicles] = await req.app.locals.pool.promise().query(query, queryParams);
    const [countResult] = await req.app.locals.pool.promise().query(countQuery, countParams);
    
    console.log('Vehicles query result:', vehicles.length, 'vehicles found');
    console.log('Total vehicles:', countResult[0].total);
    
    res.json({
      success: true,
      data: vehicles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / parseInt(limit))
      }
    });
    
    console.log('=== VEHICLES API RESPONSE SENT ===');
  } catch (error) {
    console.error('Araçları getirme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Araçlar alınırken hata oluştu',
      error: error.message
    });
  }
});

// Tüm müşterileri listele
router.get('/customers', authenticateToken, async (req, res) => {
  try {
    console.log('=== CUSTOMERS API CALL ===');
    console.log('Request headers:', req.headers);
    
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = `
      SELECT 
        v.customer_email,
        v.customer_phone,
        COUNT(DISTINCT v.id) as vehicle_count,
        COUNT(DISTINCT t.id) as transaction_count,
        COALESCE(SUM(t.amount), 0) as total_revenue,
        MIN(v.created_at) as first_registration_date,
        MAX(t.transaction_date) as last_transaction_date,
        GROUP_CONCAT(DISTINCT v.plate ORDER BY v.plate SEPARATOR ', ') as vehicle_plates
      FROM vehicles v
      LEFT JOIN transactions t ON v.id = t.vehicle_id
      WHERE v.customer_email IS NOT NULL AND v.customer_email != ''
    `;
    
    let countQuery = `
      SELECT COUNT(DISTINCT v.customer_email) as total
      FROM vehicles v
      WHERE v.customer_email IS NOT NULL AND v.customer_email != ''
    `;
    
    let queryParams = [];
    let countParams = [];
    
    // Search filter
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      const searchCondition = `AND (v.customer_email LIKE ? OR v.customer_phone LIKE ? OR v.plate LIKE ?)`;
      query += ' ' + searchCondition;
      countQuery += ' ' + searchCondition;
      queryParams = [searchTerm, searchTerm, searchTerm];
      countParams = [searchTerm, searchTerm, searchTerm];
    }
    
    query += ' GROUP BY v.customer_email, v.customer_phone ORDER BY total_revenue DESC, first_registration_date DESC LIMIT ? OFFSET ?';
    queryParams.push(parseInt(limit), offset);
    
    console.log('Executing query:', query);
    console.log('Query params:', queryParams);
    
    const [customers] = await req.app.locals.pool.promise().query(query, queryParams);
    const [countResult] = await req.app.locals.pool.promise().query(countQuery, countParams);
    
    console.log('Customers found:', customers.length);
    console.log('Total customers:', countResult[0].total);
    
    res.json({
      success: true,
      data: customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('Müşteri listesi hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Müşteri listesi alınırken hata oluştu',
      error: error.message
    });
  }
});

// Tek araç getir
router.get('/:plate', authenticateToken, async (req, res) => {
  try {
    const { plate } = req.params;
    
    const [vehicles] = await req.app.locals.pool.promise().query(
      'SELECT * FROM vehicles WHERE plate = ?',
      [plate]
    );
    
    if (vehicles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Araç bulunamadı'
      });
    }
    
    res.json({
      success: true,
      data: vehicles[0]
    });
  } catch (error) {
    console.error('Araç getirme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Araç alınırken hata oluştu',
      error: error.message
    });
  }
});

// Yeni araç ekle
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { plate, year, customer_email, customer_phone } = req.body;
    const userId = req.user.id;

    // Validasyon
    if (!plate || !year) {
      return res.status(400).json({
        success: false,
        message: 'Plaka ve yıl zorunludur'
      });
    }

    // Plaka formatını kontrol et (geçici olarak kaldırıldı)
    // const plateRegex = /^[0-9]{1,2}[A-Z]{1,3}[0-9]{2,4}$/;
    // if (!plateRegex.test(plate.toUpperCase())) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Geçersiz plaka formatı. Örnek: 34ABC123, 06XYZ45'
    //   });
    // }

    // Aynı plakada araç var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id FROM vehicles WHERE plate = ?',
      [plate.toUpperCase()]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Bu plakaya sahip bir araç zaten mevcut'
      });
    }

    await req.app.locals.pool.promise().query(
      'INSERT INTO vehicles (plate, year, customer_email, customer_phone) VALUES (?, ?, ?, ?)',
      [plate.toUpperCase(), year, customer_email || null, customer_phone || null]
    );

    const [newVehicle] = await req.app.locals.pool.promise().query(
      'SELECT * FROM vehicles WHERE plate = ?',
      [plate.toUpperCase()]
    );

    res.status(201).json({
      success: true,
      message: 'Araç başarıyla eklendi',
      data: newVehicle[0]
    });
    // Activity log
    try { await Activity.create(userId, 'Araç eklendi', { vehicle_id: newVehicle[0].id, plate: plate.toUpperCase() }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('Araç ekleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Araç eklenirken hata oluştu',
      error: error.message
    });
  }
});

// Araç güncelle
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { plate, year, customer_email, customer_phone } = req.body;
    const userId = req.user.id;

    // Validasyon
    if (!plate || !year) {
      return res.status(400).json({
        success: false,
        message: 'Plaka ve yıl zorunludur'
      });
    }

    // Plaka formatını kontrol et (geçici olarak kaldırıldı)
    // const plateRegex = /^[0-9]{1,2}[A-Z]{1,3}[0-9]{2,4}$/;
    // if (!plateRegex.test(plate.toUpperCase())) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Geçersiz plaka formatı. Örnek: 34ABC123, 06XYZ45'
    //   });
    // }

    // Araç var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id FROM vehicles WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Araç bulunamadı'
      });
    }

    // Aynı plakada başka araç var mı kontrol et
    const [duplicate] = await req.app.locals.pool.promise().query(
      'SELECT id FROM vehicles WHERE plate = ? AND id != ?',
      [plate.toUpperCase(), id]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Bu plakaya sahip başka bir araç zaten mevcut'
      });
    }

    await req.app.locals.pool.promise().query(
      'UPDATE vehicles SET plate = ?, year = ?, customer_email = ?, customer_phone = ? WHERE id = ?',
      [plate.toUpperCase(), year, customer_email || null, customer_phone || null, id]
    );

    const [updatedVehicle] = await req.app.locals.pool.promise().query(
      'SELECT * FROM vehicles WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Araç başarıyla güncellendi',
      data: updatedVehicle[0]
    });
    // Activity log
    try { await Activity.create(userId, 'Araç güncellendi', { vehicle_id: id, plate: plate.toUpperCase() }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('Araç güncelleme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Araç güncellenirken hata oluştu',
      error: error.message
    });
  }
});

// Araç sil
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Araç var mı kontrol et
    const [existing] = await req.app.locals.pool.promise().query(
      'SELECT id FROM vehicles WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Araç bulunamadı'
      });
    }

    // Bu araçla ilgili işlemler var mı kontrol et
    const [transactions] = await req.app.locals.pool.promise().query(
      'SELECT id FROM transactions WHERE vehicle_id = ? LIMIT 1',
      [id]
    );

    if (transactions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Bu araçla ilgili işlemler bulunduğu için silinemez'
      });
    }

    await req.app.locals.pool.promise().query(
      'DELETE FROM vehicles WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Araç başarıyla silindi'
    });
    // Activity log
    try { await Activity.create(req.user.id, 'Araç silindi', { id }); } catch (e) { console.error('Activity log error:', e); }
  } catch (error) {
    console.error('Araç silme hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Araç silinirken hata oluştu',
      error: error.message
    });
  }
});

// Araç istatistikleri
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const [stats] = await req.app.locals.pool.promise().query(`
      SELECT 
        COUNT(*) as total_vehicles,
        COUNT(*) as active_vehicles,
        0 as maintenance_vehicles,
        0 as inactive_vehicles
      FROM vehicles
    `);
    
    res.json({
      success: true,
      stats: stats[0]
    });
  } catch (error) {
    console.error('Araç istatistikleri hatası:', error);
    res.status(500).json({
      success: false,
      message: 'İstatistikler alınırken hata oluştu',
      error: error.message
    });
  }
});

// Müşteri istatistikleri
router.get('/customer-stats', authenticateToken, async (req, res) => {
  try {
    console.log('=== CUSTOMER STATS API DEBUG ===');
    
    // Toplam müşteri sayısı (benzersiz e-posta adresleri)
    const [totalCustomers] = await req.app.locals.pool.promise().query(`
      SELECT COUNT(DISTINCT customer_email) as totalCustomers
      FROM vehicles 
      WHERE customer_email IS NOT NULL AND customer_email != ''
    `);

    console.log('Total customers query result:', totalCustomers[0]);

    // Bu ay yeni müşteri sayısı
    const [newCustomersThisMonth] = await req.app.locals.pool.promise().query(`
      SELECT COUNT(DISTINCT customer_email) as newCustomersThisMonth
      FROM vehicles 
      WHERE customer_email IS NOT NULL 
        AND customer_email != '' 
        AND YEAR(created_at) = YEAR(CURRENT_DATE())
        AND MONTH(created_at) = MONTH(CURRENT_DATE())
    `);

    console.log('New customers this month query result:', newCustomersThisMonth[0]);

    const response = {
      success: true,
      totalCustomers: totalCustomers[0].totalCustomers || 0,
      newCustomersThisMonth: newCustomersThisMonth[0].newCustomersThisMonth || 0
    };

    console.log('Customer stats response:', response);
    res.json(response);
  } catch (error) {
    console.error('Müşteri istatistikleri hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Müşteri istatistikleri alınırken hata oluştu',
      error: error.message
    });
  }
});

// En çok işlem yapan müşteriler
router.get('/top-customers', authenticateToken, async (req, res) => {
  try {
    console.log('=== TOP CUSTOMERS API DEBUG ===');
    const { limit = 5 } = req.query;
    console.log('Limit:', limit);
    
    const [topCustomers] = await req.app.locals.pool.promise().query(`
      SELECT 
        v.customer_email,
        COUNT(t.id) as transaction_count,
        COUNT(DISTINCT v.id) as vehicle_count,
        COALESCE(SUM(t.amount), 0) as total_revenue
      FROM vehicles v
      LEFT JOIN transactions t ON v.id = t.vehicle_id
      WHERE v.customer_email IS NOT NULL AND v.customer_email != ''
      GROUP BY v.customer_email
      HAVING transaction_count > 0
      ORDER BY total_revenue DESC, transaction_count DESC
      LIMIT ?
    `, [parseInt(limit)]);

    console.log('Top customers query result:', topCustomers);

    const response = {
      success: true,
      data: topCustomers.map(customer => ({
        customer_email: customer.customer_email,
        transaction_count: parseInt(customer.transaction_count),
        vehicle_count: parseInt(customer.vehicle_count),
        total_revenue: parseFloat(customer.total_revenue)
      }))
    };

    console.log('Top customers response:', response);
    res.json(response);
  } catch (error) {
    console.error('En çok işlem yapan müşteriler hatası:', error);
    res.status(500).json({
      success: false,
      message: 'En çok işlem yapan müşteriler alınırken hata oluştu',
      error: error.message
    });
  }
});

// Müşteri ciro payları
router.get('/customer-revenue-share', authenticateToken, async (req, res) => {
  try {
    // Toplam ciro
    const [totalRevenue] = await req.app.locals.pool.promise().query(`
      SELECT COALESCE(SUM(amount), 0) as total_revenue
      FROM transactions
    `);

    const total = parseFloat(totalRevenue[0].total_revenue);

    // Müşteri bazında ciro payları
    const [customerRevenue] = await req.app.locals.pool.promise().query(`
      SELECT 
        v.customer_email,
        COALESCE(SUM(t.amount), 0) as revenue
      FROM vehicles v
      LEFT JOIN transactions t ON v.id = t.vehicle_id
      WHERE v.customer_email IS NOT NULL AND v.customer_email != ''
      GROUP BY v.customer_email
      HAVING revenue > 0
      ORDER BY revenue DESC
    `);

    const customerRevenueShare = customerRevenue.map(customer => ({
      customer_email: customer.customer_email,
      revenue: parseFloat(customer.revenue),
      percentage: total > 0 ? ((parseFloat(customer.revenue) / total) * 100).toFixed(2) : '0.00'
    }));

    res.json({
      success: true,
      data: customerRevenueShare
    });
  } catch (error) {
    console.error('Müşteri ciro payları hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Müşteri ciro payları alınırken hata oluştu',
      error: error.message
    });
  }
});

module.exports = router; 