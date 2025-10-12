const express = require('express');
const router = express.Router();
const { getRecentActivities, getPersonnelActivities } = require('../controllers/activityController');
const { authenticateToken } = require('../middlewares/auth');

router.get('/', authenticateToken, getRecentActivities);
router.get('/personnel/:personnelId', authenticateToken, getPersonnelActivities);

// Toplam ciro hesaplama (anasayfa için)
router.get('/total-revenue', authenticateToken, async (req, res) => {
  try {
    console.log('=== TOTAL REVENUE API DEBUG ===');
    
    // Toplam ciro hesapla
    const [totalRevenueResult] = await req.app.locals.pool.promise().query(
      'SELECT COALESCE(SUM(amount), 0) as total_revenue FROM transactions'
    );
    
    const totalRevenue = parseFloat(totalRevenueResult[0].total_revenue);
    
    console.log('Total revenue calculated:', totalRevenue);
    
    res.json({
      success: true,
      data: {
        totalRevenue: totalRevenue
      }
    });
    
  } catch (error) {
    console.error('Toplam ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Toplam ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Aylık ciro hesaplama
router.get('/monthly-revenue', authenticateToken, async (req, res) => {
  try {
    const { year, month } = req.query;
    const userId = req.user.id;

    // Yıl ve ay parametrelerini kontrol et
    const targetYear = year || new Date().getFullYear();
    const targetMonth = month || new Date().getMonth() + 1;

    console.log('=== MONTHLY REVENUE API DEBUG ===');
    console.log('Requested Year:', targetYear, 'Month:', targetMonth);

    // Önce toplam işlem sayısını kontrol et
    const [totalCount] = await req.app.locals.pool.promise().query(
      'SELECT COUNT(*) as total FROM transactions'
    );
    console.log('Total transactions in DB:', totalCount[0].total);

    // İşlemleri getir ve ciro hesapla
    const [transactions] = await req.app.locals.pool.promise().query(
      `SELECT 
        t.id,
        t.amount,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE YEAR(t.transaction_date) = ? AND MONTH(t.transaction_date) = ?
      ORDER BY t.transaction_date DESC`,
      [targetYear, targetMonth]
    );

    console.log('Found transactions for period:', transactions.length);
    console.log('Sample transaction:', transactions[0]);

    // Toplam ciro hesapla
    const totalRevenue = transactions.reduce((sum, transaction) => sum + parseFloat(transaction.amount || 0), 0);

    // Kategori bazında ciro hesapla
    const categoryRevenue = {};
    transactions.forEach(transaction => {
      const category = transaction.category_name || 'Kategorisiz';
      if (!categoryRevenue[category]) {
        categoryRevenue[category] = 0;
      }
      categoryRevenue[category] += parseFloat(transaction.amount || 0);
    });

    // Araç bazında ciro hesapla
    const vehicleRevenue = {};
    transactions.forEach(transaction => {
      const vehicle = transaction.vehicle_plate || 'Araçsız';
      if (!vehicleRevenue[vehicle]) {
        vehicleRevenue[vehicle] = 0;
      }
      vehicleRevenue[vehicle] += parseFloat(transaction.amount || 0);
    });

    // Personel bazında ciro hesapla
    const personnelRevenue = {};
    transactions.forEach(transaction => {
      const personnel = transaction.personnel_name || 'Personelsiz';
      if (!personnelRevenue[personnel]) {
        personnelRevenue[personnel] = 0;
      }
      personnelRevenue[personnel] += parseFloat(transaction.amount || 0);
    });

    res.json({
      success: true,
      data: {
        period: {
          year: parseInt(targetYear),
          month: parseInt(targetMonth),
          monthName: new Date(targetYear, targetMonth - 1).toLocaleDateString('tr-TR', { month: 'long' })
        },
        summary: {
          totalRevenue: totalRevenue,
          transactionCount: transactions.length,
          averageTransaction: transactions.length > 0 ? totalRevenue / transactions.length : 0
        },
        breakdown: {
          byCategory: Object.entries(categoryRevenue).map(([category, revenue]) => ({
            category,
            revenue,
            percentage: totalRevenue > 0 ? (revenue / totalRevenue * 100).toFixed(2) : 0
          })),
          byVehicle: Object.entries(vehicleRevenue).map(([vehicle, revenue]) => ({
            vehicle,
            revenue,
            percentage: totalRevenue > 0 ? (revenue / totalRevenue * 100).toFixed(2) : 0
          })),
          byPersonnel: Object.entries(personnelRevenue).map(([personnel, revenue]) => ({
            personnel,
            revenue,
            percentage: totalRevenue > 0 ? (revenue / totalRevenue * 100).toFixed(2) : 0
          }))
        },
        transactions: transactions
      }
    });

  } catch (error) {
    console.error('Ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Yıllık ciro hesaplama
router.get('/yearly-revenue', authenticateToken, async (req, res) => {
  try {
    const { year } = req.query;
    const userId = req.user.id;

    const targetYear = year || new Date().getFullYear();

    console.log('=== YEARLY REVENUE API DEBUG ===');
    console.log('Requested Year:', targetYear);

    // Önce toplam işlem sayısını kontrol et
    const [totalCount] = await req.app.locals.pool.promise().query(
      'SELECT COUNT(*) as total FROM transactions'
    );
    console.log('Total transactions in DB:', totalCount[0].total);

    // Aylık ciro verilerini getir
    const [monthlyData] = await req.app.locals.pool.promise().query(
      `SELECT 
        MONTH(transaction_date) as month,
        SUM(amount) as totalRevenue,
        COUNT(*) as transactionCount
      FROM transactions 
      WHERE YEAR(transaction_date) = ?
      GROUP BY MONTH(transaction_date)
      ORDER BY month`,
      [targetYear]
    );

    console.log('Monthly data found:', monthlyData.length);
    console.log('Sample monthly data:', monthlyData[0]);

    // Toplam yıllık ciro
    const totalYearlyRevenue = monthlyData.reduce((sum, month) => sum + parseFloat(month.totalRevenue || 0), 0);
    const totalYearlyTransactions = monthlyData.reduce((sum, month) => sum + parseInt(month.transactionCount || 0), 0);

    // 12 ay için tam veri oluştur
    const monthlyRevenue = [];
    for (let month = 1; month <= 12; month++) {
      const monthData = monthlyData.find(m => m.month === month);
      monthlyRevenue.push({
        month,
        monthName: new Date(targetYear, month - 1).toLocaleDateString('tr-TR', { month: 'long' }),
        revenue: monthData ? parseFloat(monthData.totalRevenue) : 0,
        transactionCount: monthData ? parseInt(monthData.transactionCount) : 0
      });
    }

    // Yıl içindeki tüm işlemleri getir
    const [yearlyTransactions] = await req.app.locals.pool.promise().query(
      `SELECT 
        t.id,
        t.amount,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE YEAR(t.transaction_date) = ?
      ORDER BY t.transaction_date DESC`,
      [targetYear]
    );

    res.json({
      success: true,
      data: {
        year: parseInt(targetYear),
        summary: {
          totalRevenue: totalYearlyRevenue,
          totalTransactions: totalYearlyTransactions,
          averageMonthlyRevenue: totalYearlyRevenue / 12,
          averageTransactionValue: totalYearlyTransactions > 0 ? totalYearlyRevenue / totalYearlyTransactions : 0
        },
        monthlyBreakdown: monthlyRevenue,
        transactions: yearlyTransactions
      }
    });

  } catch (error) {
    console.error('Yıllık ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Yıllık ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Haftalık ciro hesaplama
router.get('/weekly-revenue', authenticateToken, async (req, res) => {
  try {
    const { year, week } = req.query;
    const userId = req.user.id;

    const targetYear = year || new Date().getFullYear();
    const targetWeek = week || Math.ceil((new Date().getTime() - new Date(targetYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    console.log('=== WEEKLY REVENUE API DEBUG ===');
    console.log('Requested Year:', targetYear, 'Week:', targetWeek);

    // Haftanın başlangıç ve bitiş tarihlerini hesapla
    const startOfYear = new Date(targetYear, 0, 1);
    const startOfWeek = new Date(startOfYear.getTime() + (targetWeek - 1) * 7 * 24 * 60 * 60 * 1000);
    const endOfWeek = new Date(startOfWeek.getTime() + 6 * 24 * 60 * 60 * 1000);

    console.log('Week start:', startOfWeek.toISOString().split('T')[0]);
    console.log('Week end:', endOfWeek.toISOString().split('T')[0]);

    // Haftalık işlemleri getir
    const [transactions] = await req.app.locals.pool.promise().query(
      `SELECT 
        t.id,
        t.amount,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date >= ? AND t.transaction_date <= ?
      ORDER BY t.transaction_date DESC`,
      [startOfWeek.toISOString().split('T')[0], endOfWeek.toISOString().split('T')[0]]
    );

    console.log('Found transactions for week:', transactions.length);

    // Toplam ciro hesapla
    const totalRevenue = transactions.reduce((sum, transaction) => sum + parseFloat(transaction.amount || 0), 0);

    // Günlük ciro hesapla
    const dailyRevenue = {};
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startOfWeek.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayTransactions = transactions.filter(t => {
        // transaction_date'i Türkiye saati ile karşılaştır
        let transactionDate;
        if (typeof t.transaction_date === 'string') {
          transactionDate = new Date(t.transaction_date);
        } else if (t.transaction_date instanceof Date) {
          transactionDate = t.transaction_date;
        } else {
          transactionDate = new Date(t.transaction_date);
        }
        
        // Türkiye saati için +3 saat ekle
        const turkeyDate = new Date(transactionDate.getTime() + (3 * 60 * 60 * 1000));
        const transactionDateStr = turkeyDate.toISOString().split('T')[0];
        
        return transactionDateStr === dateStr;
      });
      
      dailyRevenue[dateStr] = {
        day: i + 1,
        dayName: currentDate.toLocaleDateString('tr-TR', { weekday: 'long' }),
        date: dateStr,
        revenue: dayTransactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0),
        transactionCount: dayTransactions.length
      };
    }

    res.json({
      success: true,
      data: {
        period: {
          year: parseInt(targetYear),
          week: parseInt(targetWeek),
          startDate: startOfWeek.toISOString().split('T')[0],
          endDate: endOfWeek.toISOString().split('T')[0]
        },
        summary: {
          totalRevenue: totalRevenue,
          transactionCount: transactions.length,
          averageTransaction: transactions.length > 0 ? totalRevenue / transactions.length : 0
        },
        dailyBreakdown: Object.values(dailyRevenue)
      }
    });

  } catch (error) {
    console.error('Haftalık ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Haftalık ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Özel tarih aralığı ciro hesaplama
router.get('/custom-revenue', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, periodType } = req.query;
    const userId = req.user.id;

    console.log('=== CUSTOM REVENUE API DEBUG ===');
    console.log('Start Date:', startDate, 'End Date:', endDate, 'Period Type:', periodType);
    console.log('Start Date Type:', typeof startDate, 'End Date Type:', typeof endDate);

    // 🔧 FIX: Adjust date range to account for Turkey timezone (UTC+3)
    // When filtering for a specific day like '2024-07-20', we need to include transactions
    // from '2024-07-19 21:00:00' UTC to '2024-07-20 20:59:59' UTC
    // because these represent the full day in Turkey timezone
    
    let adjustedStartDate, adjustedEndDate;
    
    if (startDate === endDate) {
      // For daily queries, adjust the date range to include the full Turkey day
      const startDateObj = new Date(startDate + 'T00:00:00.000Z');
      const endDateObj = new Date(endDate + 'T23:59:59.999Z');
      
      // Subtract 3 hours to get the UTC equivalent of Turkey timezone start/end
      adjustedStartDate = new Date(startDateObj.getTime() - (3 * 60 * 60 * 1000)).toISOString().split('T')[0] + ' ' + 
                         new Date(startDateObj.getTime() - (3 * 60 * 60 * 1000)).toTimeString().split(' ')[0];
      adjustedEndDate = new Date(endDateObj.getTime() - (3 * 60 * 60 * 1000)).toISOString().split('T')[0] + ' ' + 
                       new Date(endDateObj.getTime() - (3 * 60 * 60 * 1000)).toTimeString().split(' ')[0];
      
      console.log('🔧 TIMEZONE FIX - Daily query adjusted dates:', {
        originalStart: startDate,
        originalEnd: endDate,
        adjustedStart: adjustedStartDate,
        adjustedEnd: adjustedEndDate
      });
    } else {
      // For weekly/range queries, use DATE() function to compare dates in Turkey timezone
      adjustedStartDate = startDate;
      adjustedEndDate = endDate;
    }

    // Tarih aralığındaki işlemleri getir
    let query, queryParams;
    
    if (startDate === endDate) {
      // For daily queries, use the adjusted UTC range
      query = `SELECT 
        t.id,
        t.amount,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE t.transaction_date >= ? AND t.transaction_date <= ?
      ORDER BY t.transaction_date DESC`;
      queryParams = [adjustedStartDate, adjustedEndDate];
    } else {
      // For range queries, use DATE() with timezone adjustment
      query = `SELECT 
        t.id,
        t.amount,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE DATE(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) >= ? 
        AND DATE(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) <= ?
      ORDER BY t.transaction_date DESC`;
      queryParams = [startDate, endDate];
    }

    const [transactions] = await req.app.locals.pool.promise().query(query, queryParams);

    console.log('Found transactions for period:', transactions.length);
    console.log('Sample transactions:', transactions.slice(0, 3));

    // Toplam ciro hesapla
    const totalRevenue = transactions.reduce((sum, transaction) => sum + parseFloat(transaction.amount || 0), 0);

    // Günlük ciro hesapla
    const dailyRevenue = {};
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    console.log('Date range:', startDate, 'to', endDate);
    console.log('Start date object:', start);
    console.log('End date object:', end);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayTransactions = transactions.filter(t => {
        // transaction_date'i Türkiye saati ile karşılaştır
        let transactionDate;
        if (typeof t.transaction_date === 'string') {
          transactionDate = new Date(t.transaction_date);
        } else if (t.transaction_date instanceof Date) {
          transactionDate = t.transaction_date;
        } else {
          transactionDate = new Date(t.transaction_date);
        }
        
        // Türkiye saati için +3 saat ekle
        const turkeyDate = new Date(transactionDate.getTime() + (3 * 60 * 60 * 1000));
        const transactionDateStr = turkeyDate.toISOString().split('T')[0];
        
        return transactionDateStr === dateStr;
      });
      
      console.log(`Date ${dateStr}: ${dayTransactions.length} transactions`);
      console.log(`  Looking for date: ${dateStr}`);
      console.log(`  Transaction dates:`, transactions.map(t => {
        let transactionDate;
        if (typeof t.transaction_date === 'string') {
          transactionDate = new Date(t.transaction_date);
        } else if (t.transaction_date instanceof Date) {
          transactionDate = t.transaction_date;
        } else {
          transactionDate = new Date(t.transaction_date);
        }
        
        const turkeyDate = new Date(transactionDate.getTime() + (3 * 60 * 60 * 1000));
        const transactionDateStr = turkeyDate.toISOString().split('T')[0];
        
        return { id: t.id, original: t.transaction_date, converted: transactionDateStr };
      }));
      
      dailyRevenue[dateStr] = {
        day: d.getDay() + 1,
        dayName: d.toLocaleDateString('tr-TR', { weekday: 'long' }),
        date: dateStr,
        revenue: dayTransactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0),
        transactionCount: dayTransactions.length
      };
    }
    
    console.log('Daily revenue calculated:', dailyRevenue);

    res.json({
      success: true,
      data: {
        period: {
          startDate: startDate,
          endDate: endDate,
          periodType: periodType
        },
        summary: {
          totalRevenue: totalRevenue,
          transactionCount: transactions.length,
          averageTransaction: transactions.length > 0 ? totalRevenue / transactions.length : 0
        },
        dailyBreakdown: Object.values(dailyRevenue),
        transactions: transactions
      }
    });

  } catch (error) {
    console.error('Özel tarih aralığı ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Kategori bazında özel tarih aralığı ciro hesaplama
router.get('/category-custom-revenue', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, periodType, categoryIds } = req.query;
    const userId = req.user.id;

    const categoryIdList = categoryIds ? categoryIds.split(',').map(id => parseInt(id)) : [];

    console.log('=== CATEGORY CUSTOM REVENUE API DEBUG ===');
    console.log('Start Date:', startDate, 'End Date:', endDate, 'Period Type:', periodType, 'Categories:', categoryIdList);

    // 🔧 FIX: Adjust date range to account for Turkey timezone (UTC+3)
    let adjustedStartDate, adjustedEndDate;
    let useTimezoneAdjustment = false;
    
    if (startDate === endDate) {
      // For daily queries, adjust the date range to include the full Turkey day
      const startDateObj = new Date(startDate + 'T00:00:00.000Z');
      const endDateObj = new Date(endDate + 'T23:59:59.999Z');
      
      // Subtract 3 hours to get the UTC equivalent of Turkey timezone start/end
      adjustedStartDate = new Date(startDateObj.getTime() - (3 * 60 * 60 * 1000)).toISOString().split('T')[0] + ' ' + 
                         new Date(startDateObj.getTime() - (3 * 60 * 60 * 1000)).toTimeString().split(' ')[0];
      adjustedEndDate = new Date(endDateObj.getTime() - (3 * 60 * 60 * 1000)).toISOString().split('T')[0] + ' ' + 
                       new Date(endDateObj.getTime() - (3 * 60 * 60 * 1000)).toTimeString().split(' ')[0];
      useTimezoneAdjustment = true;
      
      console.log('🔧 TIMEZONE FIX - Category daily query adjusted dates:', {
        originalStart: startDate,
        originalEnd: endDate,
        adjustedStart: adjustedStartDate,
        adjustedEnd: adjustedEndDate
      });
    } else {
      adjustedStartDate = startDate;
      adjustedEndDate = endDate;
    }

    // Kategori bazında verileri getir
    let query, queryParams;
    
    if (useTimezoneAdjustment) {
      // For daily queries, use adjusted UTC range
      query = `
        SELECT 
          tc.id as category_id,
          tc.name as category_name,
          SUM(t.amount) as totalRevenue,
          COUNT(*) as totalTransactions,
          AVG(t.amount) as averageTransaction
        FROM transactions t
        LEFT JOIN transaction_categories tc ON t.category_id = tc.id
        WHERE t.transaction_date >= ? AND t.transaction_date <= ?
      `;
      queryParams = [adjustedStartDate, adjustedEndDate];
    } else {
      // For range queries, use timezone conversion
      query = `
        SELECT 
          tc.id as category_id,
          tc.name as category_name,
          SUM(t.amount) as totalRevenue,
          COUNT(*) as totalTransactions,
          AVG(t.amount) as averageTransaction
        FROM transactions t
        LEFT JOIN transaction_categories tc ON t.category_id = tc.id
        WHERE DATE(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) >= ? 
          AND DATE(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) <= ?
      `;
      queryParams = [startDate, endDate];
    }

    if (categoryIdList.length > 0) {
      query += ` AND tc.id IN (${categoryIdList.map(() => '?').join(',')})`;
      queryParams.push(...categoryIdList);
    }

    query += ` GROUP BY tc.id, tc.name ORDER BY totalRevenue DESC`;

    const [categoryData] = await req.app.locals.pool.promise().query(query, queryParams);

    console.log('Category data found:', categoryData.length);

    // Filtrelenmiş işlemleri de getir
    let transactionQuery, transactionParams;
    
    if (useTimezoneAdjustment) {
      // For daily queries, use adjusted UTC range
      transactionQuery = `
        SELECT 
          t.id,
          t.amount,
          t.description,
          t.transaction_date,
          tc.name as category_name,
          v.plate as vehicle_plate,
          p.full_name as personnel_name
        FROM transactions t
        LEFT JOIN transaction_categories tc ON t.category_id = tc.id
        LEFT JOIN vehicles v ON t.vehicle_id = v.id
        LEFT JOIN personnel p ON t.personnel_id = p.id
        WHERE t.transaction_date >= ? AND t.transaction_date <= ?
      `;
      transactionParams = [adjustedStartDate, adjustedEndDate];
    } else {
      // For range queries, use timezone conversion
      transactionQuery = `
        SELECT 
          t.id,
          t.amount,
          t.description,
          t.transaction_date,
          tc.name as category_name,
          v.plate as vehicle_plate,
          p.full_name as personnel_name
        FROM transactions t
        LEFT JOIN transaction_categories tc ON t.category_id = tc.id
        LEFT JOIN vehicles v ON t.vehicle_id = v.id
        LEFT JOIN personnel p ON t.personnel_id = p.id
        WHERE DATE(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) >= ? 
          AND DATE(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) <= ?
      `;
      transactionParams = [startDate, endDate];
    }

    if (categoryIdList.length > 0) {
      transactionQuery += ` AND tc.id IN (${categoryIdList.map(() => '?').join(',')})`;
      transactionParams.push(...categoryIdList);
    }

    transactionQuery += ' ORDER BY t.transaction_date DESC';

    const [filteredTransactions] = await req.app.locals.pool.promise().query(transactionQuery, transactionParams);

    // Günlük ciro hesapla (filtrelenmiş işlemler için)
    const dailyRevenue = {};
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayTransactions = filteredTransactions.filter(t => {
        // transaction_date'i Türkiye saati ile karşılaştır
        let transactionDate;
        if (typeof t.transaction_date === 'string') {
          transactionDate = new Date(t.transaction_date);
        } else if (t.transaction_date instanceof Date) {
          transactionDate = t.transaction_date;
        } else {
          transactionDate = new Date(t.transaction_date);
        }
        
        // Türkiye saati için +3 saat ekle
        const turkeyDate = new Date(transactionDate.getTime() + (3 * 60 * 60 * 1000));
        const transactionDateStr = turkeyDate.toISOString().split('T')[0];
        
        return transactionDateStr === dateStr;
      });
      
      dailyRevenue[dateStr] = {
        day: d.getDay() + 1,
        dayName: d.toLocaleDateString('tr-TR', { weekday: 'long' }),
        date: dateStr,
        revenue: dayTransactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0),
        transactionCount: dayTransactions.length
      };
    }

    res.json({
      success: true,
      data: {
        period: {
          startDate: startDate,
          endDate: endDate,
          periodType: periodType
        },
        categories: categoryData.map(cat => ({
          category_id: cat.category_id,
          category_name: cat.category_name,
          totalRevenue: parseFloat(cat.totalRevenue || 0),
          totalTransactions: parseInt(cat.totalTransactions || 0),
          averageTransaction: parseFloat(cat.averageTransaction || 0)
        })),
        dailyBreakdown: Object.values(dailyRevenue),
        transactions: filteredTransactions
      }
    });

  } catch (error) {
    console.error('Kategori bazında özel tarih aralığı ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori bazında ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Kategori bazında ciro hesaplama (Genel)
router.get('/category-revenue', authenticateToken, async (req, res) => {
  try {
    const { categoryId, startDate, endDate } = req.query;
    const userId = req.user.id;

    let query = `
      SELECT 
        tc.id as category_id,
        tc.name as category_name,
        SUM(t.amount) as totalRevenue,
        COUNT(*) as transactionCount,
        AVG(t.amount) as averageTransaction,
        MIN(t.transaction_date) as firstTransaction,
        MAX(t.transaction_date) as lastTransaction
      FROM transaction_categories tc
      LEFT JOIN transactions t ON tc.id = t.category_id
    `;

    const queryParams = [];
    const conditions = [];

    if (categoryId) {
      conditions.push('tc.id = ?');
      queryParams.push(categoryId);
    }

    if (startDate) {
      conditions.push('t.transaction_date >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      conditions.push('t.transaction_date <= ?');
      queryParams.push(endDate);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' GROUP BY tc.id, tc.name ORDER BY totalRevenue DESC';

    const [categoryData] = await req.app.locals.pool.promise().query(query, queryParams);

    // Toplam ciro hesapla
    const totalRevenue = categoryData.reduce((sum, category) => sum + parseFloat(category.totalRevenue || 0), 0);

    // Yüzde hesapla
    const categoryRevenueWithPercentage = categoryData.map(category => ({
      ...category,
      totalRevenue: parseFloat(category.totalRevenue || 0),
      averageTransaction: parseFloat(category.averageTransaction || 0),
      percentage: totalRevenue > 0 ? (parseFloat(category.totalRevenue || 0) / totalRevenue * 100).toFixed(2) : 0
    }));

    res.json({
      success: true,
      data: {
        totalRevenue,
        categories: categoryRevenueWithPercentage
      }
    });

  } catch (error) {
    console.error('Kategori ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Kategori bazında yıllık ciro
router.get('/category-yearly-revenue', authenticateToken, async (req, res) => {
  try {
    const { categoryId, categoryIds, year } = req.query;
    const userId = req.user.id;
    const targetYear = year || new Date().getFullYear();

    console.log('=== CATEGORY YEARLY REVENUE API DEBUG ===');
    console.log('Category ID:', categoryId, 'Year:', targetYear);

    let query = `
      SELECT 
        tc.id as category_id,
        tc.name as category_name,
        MONTH(t.transaction_date) as month,
        SUM(t.amount) as totalRevenue,
        COUNT(*) as transactionCount,
        AVG(t.amount) as averageTransaction
      FROM transaction_categories tc
      LEFT JOIN transactions t ON tc.id = t.category_id
      WHERE YEAR(t.transaction_date) = ?
    `;

    const queryParams = [targetYear];

    if (categoryIds) {
      const categoryIdList = categoryIds.split(',').map(id => parseInt(id));
      query += ` AND tc.id IN (${categoryIdList.map(() => '?').join(',')})`;
      queryParams.push(...categoryIdList);
    } else if (categoryId) {
      query += ' AND tc.id = ?';
      queryParams.push(categoryId);
    }

    query += ' GROUP BY tc.id, tc.name, MONTH(t.transaction_date) ORDER BY tc.name, month';

    const [monthlyData] = await req.app.locals.pool.promise().query(query, queryParams);

    // Kategorileri grupla
    const categoryData = {};
    monthlyData.forEach(row => {
      const categoryId = row.category_id;
      if (!categoryData[categoryId]) {
        categoryData[categoryId] = {
          category_id: categoryId,
          category_name: row.category_name,
          totalRevenue: 0,
          totalTransactions: 0,
          monthlyBreakdown: Array(12).fill().map((_, i) => ({
            month: i + 1,
            monthName: new Date(targetYear, i).toLocaleDateString('tr-TR', { month: 'long' }),
            revenue: 0,
            transactionCount: 0
          }))
        };
      }

      categoryData[categoryId].totalRevenue += parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].totalTransactions += parseInt(row.transactionCount || 0);
      categoryData[categoryId].monthlyBreakdown[row.month - 1].revenue = parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].monthlyBreakdown[row.month - 1].transactionCount = parseInt(row.transactionCount || 0);
    });

    const categories = Object.values(categoryData).map(category => ({
      ...category,
      averageTransaction: category.totalTransactions > 0 ? category.totalRevenue / category.totalTransactions : 0
    }));

    // Filtrelenmiş işlemleri de getir
    let transactionQuery = `
      SELECT 
        t.id,
        t.amount,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE YEAR(t.transaction_date) = ?
    `;

    const transactionParams = [targetYear];

    if (categoryIds) {
      const categoryIdList = categoryIds.split(',').map(id => parseInt(id));
      transactionQuery += ` AND tc.id IN (${categoryIdList.map(() => '?').join(',')})`;
      transactionParams.push(...categoryIdList);
    } else if (categoryId) {
      transactionQuery += ' AND tc.id = ?';
      transactionParams.push(categoryId);
    }

    transactionQuery += ' ORDER BY t.transaction_date DESC';

    const [filteredTransactions] = await req.app.locals.pool.promise().query(transactionQuery, transactionParams);

    res.json({
      success: true,
      data: {
        year: parseInt(targetYear),
        categories: categories,
        transactions: filteredTransactions
      }
    });

  } catch (error) {
    console.error('Kategori yıllık ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori yıllık ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Kategori bazında aylık ciro
router.get('/category-monthly-revenue', authenticateToken, async (req, res) => {
  try {
    const { categoryId, categoryIds, year, month } = req.query;
    const userId = req.user.id;
    const targetYear = year || new Date().getFullYear();
    const targetMonth = month || new Date().getMonth() + 1;

    console.log('=== CATEGORY MONTHLY REVENUE API DEBUG ===');
    console.log('Category ID:', categoryId, 'Year:', targetYear, 'Month:', targetMonth);

    let query = `
      SELECT 
        tc.id as category_id,
        tc.name as category_name,
        DAY(t.transaction_date) as day,
        SUM(t.amount) as totalRevenue,
        COUNT(*) as transactionCount,
        AVG(t.amount) as averageTransaction
      FROM transaction_categories tc
      LEFT JOIN transactions t ON tc.id = t.category_id
      WHERE YEAR(t.transaction_date) = ? AND MONTH(t.transaction_date) = ?
    `;

    const queryParams = [targetYear, targetMonth];

    if (categoryIds) {
      const categoryIdList = categoryIds.split(',').map(id => parseInt(id));
      query += ` AND tc.id IN (${categoryIdList.map(() => '?').join(',')})`;
      queryParams.push(...categoryIdList);
    } else if (categoryId) {
      query += ' AND tc.id = ?';
      queryParams.push(categoryId);
    }

    query += ' GROUP BY tc.id, tc.name, DAY(t.transaction_date) ORDER BY tc.name, day';

    const [dailyData] = await req.app.locals.pool.promise().query(query, queryParams);

    // Kategorileri grupla
    const categoryData = {};
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

    dailyData.forEach(row => {
      const categoryId = row.category_id;
      if (!categoryData[categoryId]) {
        categoryData[categoryId] = {
          category_id: categoryId,
          category_name: row.category_name,
          totalRevenue: 0,
          totalTransactions: 0,
          dailyBreakdown: Array(daysInMonth).fill().map((_, i) => ({
            day: i + 1,
            revenue: 0,
            transactionCount: 0
          }))
        };
      }

      categoryData[categoryId].totalRevenue += parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].totalTransactions += parseInt(row.transactionCount || 0);
      categoryData[categoryId].dailyBreakdown[row.day - 1].revenue = parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].dailyBreakdown[row.day - 1].transactionCount = parseInt(row.transactionCount || 0);
    });

    const categories = Object.values(categoryData).map(category => ({
      ...category,
      averageTransaction: category.totalTransactions > 0 ? category.totalRevenue / category.totalTransactions : 0
    }));

    // Filtrelenmiş işlemleri de getir
    let transactionQuery = `
      SELECT 
        t.id,
        t.amount,
        t.description,
        t.transaction_date,
        tc.name as category_name,
        v.plate as vehicle_plate,
        p.full_name as personnel_name
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE YEAR(t.transaction_date) = ? AND MONTH(t.transaction_date) = ?
    `;

    const transactionParams = [targetYear, targetMonth];

    if (categoryIds) {
      const categoryIdList = categoryIds.split(',').map(id => parseInt(id));
      transactionQuery += ` AND tc.id IN (${categoryIdList.map(() => '?').join(',')})`;
      transactionParams.push(...categoryIdList);
    } else if (categoryId) {
      transactionQuery += ' AND tc.id = ?';
      transactionParams.push(categoryId);
    }

    transactionQuery += ' ORDER BY t.transaction_date DESC';

    const [filteredTransactions] = await req.app.locals.pool.promise().query(transactionQuery, transactionParams);

    res.json({
      success: true,
      data: {
        period: {
          year: parseInt(targetYear),
          month: parseInt(targetMonth),
          monthName: new Date(targetYear, targetMonth - 1).toLocaleDateString('tr-TR', { month: 'long' })
        },
        categories: categories,
        transactions: filteredTransactions
      }
    });

  } catch (error) {
    console.error('Kategori aylık ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori aylık ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Kategori bazında haftalık ciro
router.get('/category-weekly-revenue', authenticateToken, async (req, res) => {
  try {
    const { categoryId, year, week } = req.query;
    const userId = req.user.id;
    const targetYear = year || new Date().getFullYear();
    const targetWeek = week || Math.ceil((new Date().getTime() - new Date(targetYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    console.log('=== CATEGORY WEEKLY REVENUE API DEBUG ===');
    console.log('Category ID:', categoryId, 'Year:', targetYear, 'Week:', targetWeek);

    let query = `
      SELECT 
        tc.id as category_id,
        tc.name as category_name,
        WEEKDAY(t.transaction_date) as weekday,
        DAY(t.transaction_date) as day,
        SUM(t.amount) as totalRevenue,
        COUNT(*) as transactionCount,
        AVG(t.amount) as averageTransaction
      FROM transaction_categories tc
      LEFT JOIN transactions t ON tc.id = t.category_id
      WHERE YEAR(t.transaction_date) = ? AND WEEK(t.transaction_date, 1) = ?
    `;

    const queryParams = [targetYear, targetWeek];

    if (categoryId) {
      query += ' AND tc.id = ?';
      queryParams.push(categoryId);
    }

    query += ' GROUP BY tc.id, tc.name, WEEKDAY(t.transaction_date), DAY(t.transaction_date) ORDER BY tc.name, weekday';

    const [weeklyData] = await req.app.locals.pool.promise().query(query, queryParams);

    // Kategorileri grupla
    const categoryData = {};
    const weekdays = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

    weeklyData.forEach(row => {
      const categoryId = row.category_id;
      if (!categoryData[categoryId]) {
        categoryData[categoryId] = {
          category_id: categoryId,
          category_name: row.category_name,
          totalRevenue: 0,
          totalTransactions: 0,
          weeklyBreakdown: weekdays.map((dayName, index) => ({
            weekday: index,
            dayName: dayName,
            revenue: 0,
            transactionCount: 0
          }))
        };
      }

      categoryData[categoryId].totalRevenue += parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].totalTransactions += parseInt(row.transactionCount || 0);
      categoryData[categoryId].weeklyBreakdown[row.weekday].revenue = parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].weeklyBreakdown[row.weekday].transactionCount = parseInt(row.transactionCount || 0);
    });

    const categories = Object.values(categoryData).map(category => ({
      ...category,
      averageTransaction: category.totalTransactions > 0 ? category.totalRevenue / category.totalTransactions : 0
    }));

    res.json({
      success: true,
      data: {
        period: {
          year: parseInt(targetYear),
          week: parseInt(targetWeek)
        },
        categories: categories
      }
    });

  } catch (error) {
    console.error('Kategori haftalık ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori haftalık ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Kategori bazında günlük ciro
router.get('/category-daily-revenue', authenticateToken, async (req, res) => {
  try {
    const { categoryId, date } = req.query;
    const userId = req.user.id;
    const targetDate = date || new Date().toISOString().split('T')[0];

    console.log('=== CATEGORY DAILY REVENUE API DEBUG ===');
    console.log('Category ID:', categoryId, 'Date:', targetDate);

    let query = `
      SELECT 
        tc.id as category_id,
        tc.name as category_name,
        HOUR(t.transaction_date) as hour,
        SUM(t.amount) as totalRevenue,
        COUNT(*) as transactionCount,
        AVG(t.amount) as averageTransaction
      FROM transaction_categories tc
      LEFT JOIN transactions t ON tc.id = t.category_id
      WHERE DATE(t.transaction_date) = ?
    `;

    const queryParams = [targetDate];

    if (categoryId) {
      query += ' AND tc.id = ?';
      queryParams.push(categoryId);
    }

    query += ' GROUP BY tc.id, tc.name, HOUR(t.transaction_date) ORDER BY tc.name, hour';

    const [hourlyData] = await req.app.locals.pool.promise().query(query, queryParams);

    // Kategorileri grupla
    const categoryData = {};

    hourlyData.forEach(row => {
      const categoryId = row.category_id;
      if (!categoryData[categoryId]) {
        categoryData[categoryId] = {
          category_id: categoryId,
          category_name: row.category_name,
          totalRevenue: 0,
          totalTransactions: 0,
          hourlyBreakdown: Array(24).fill().map((_, i) => ({
            hour: i,
            revenue: 0,
            transactionCount: 0
          }))
        };
      }

      categoryData[categoryId].totalRevenue += parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].totalTransactions += parseInt(row.transactionCount || 0);
      categoryData[categoryId].hourlyBreakdown[row.hour].revenue = parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].hourlyBreakdown[row.hour].transactionCount = parseInt(row.transactionCount || 0);
    });

    const categories = Object.values(categoryData).map(category => ({
      ...category,
      averageTransaction: category.totalTransactions > 0 ? category.totalRevenue / category.totalTransactions : 0
    }));

    res.json({
      success: true,
      data: {
        date: targetDate,
        categories: categories
      }
    });

  } catch (error) {
    console.error('Kategori günlük ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori günlük ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

// Kategori bazında manuel tarih aralığı ciro
router.get('/category-custom-revenue', authenticateToken, async (req, res) => {
  try {
    const { categoryId, startDate, endDate } = req.query;
    const userId = req.user.id;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Başlangıç ve bitiş tarihi gerekli'
      });
    }

    console.log('=== CATEGORY CUSTOM REVENUE API DEBUG ===');
    console.log('Category ID:', categoryId, 'Start Date:', startDate, 'End Date:', endDate);

    let query = `
      SELECT 
        tc.id as category_id,
        tc.name as category_name,
        DATE(t.transaction_date) as date,
        SUM(t.amount) as totalRevenue,
        COUNT(*) as transactionCount,
        AVG(t.amount) as averageTransaction
      FROM transaction_categories tc
      LEFT JOIN transactions t ON tc.id = t.category_id
      WHERE DATE(t.transaction_date) BETWEEN ? AND ?
    `;

    const queryParams = [startDate, endDate];

    if (categoryId) {
      query += ' AND tc.id = ?';
      queryParams.push(categoryId);
    }

    query += ' GROUP BY tc.id, tc.name, DATE(t.transaction_date) ORDER BY tc.name, date';

    const [customData] = await req.app.locals.pool.promise().query(query, queryParams);

    // Kategorileri grupla
    const categoryData = {};

    customData.forEach(row => {
      const categoryId = row.category_id;
      if (!categoryData[categoryId]) {
        categoryData[categoryId] = {
          category_id: categoryId,
          category_name: row.category_name,
          totalRevenue: 0,
          totalTransactions: 0,
          dailyBreakdown: []
        };
      }

      categoryData[categoryId].totalRevenue += parseFloat(row.totalRevenue || 0);
      categoryData[categoryId].totalTransactions += parseInt(row.transactionCount || 0);
      categoryData[categoryId].dailyBreakdown.push({
        date: row.date,
        revenue: parseFloat(row.totalRevenue || 0),
        transactionCount: parseInt(row.transactionCount || 0)
      });
    });

    const categories = Object.values(categoryData).map(category => ({
      ...category,
      averageTransaction: category.totalTransactions > 0 ? category.totalRevenue / category.totalTransactions : 0
    }));

    res.json({
      success: true,
      data: {
        period: {
          startDate,
          endDate
        },
        categories: categories
      }
    });

  } catch (error) {
    console.error('Kategori manuel ciro hesaplama hatası:', error);
    res.status(500).json({
      success: false,
      message: 'Kategori manuel ciro hesaplanırken hata oluştu',
      error: error.message
    });
  }
});

module.exports = router; 