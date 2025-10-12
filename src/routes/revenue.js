const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const ProfitCalculator = require('../utils/profitCalculator');

// === CİRO (REVENUE) HESAPLAMA ROUTE'LARI ===

// Günlük ciro hesaplama
router.get('/daily', authenticateToken, async (req, res) => {
  console.log('🚀 [REVENUE-ROUTES] Günlük ciro hesaplama başlatıldı', {
    timestamp: new Date().toISOString(),
    endpoint: '/revenue/daily',
    user: req.user?.id
  });
  
  try {
    const { date } = req.query;
    
    console.log('📋 [REVENUE-ROUTES] Günlük ciro parametreleri:', { 
      date,
      userRole: req.user?.role 
    });
    
    if (!date) {
      console.error('❌ [REVENUE-ROUTES] Eksik parametre: tarih');
      return res.status(400).json({ 
        success: false, 
        message: 'Tarih parametresi zorunludur' 
      });
    }

    // Günlük işlemleri çek (sadece ciro hesaplama için gerekli alanlar)
    const query = `
      SELECT 
        t.id,
        t.amount,
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
    
    console.log('🔍 [REVENUE-ROUTES] Günlük ciro SQL sorgusu hazırlandı');
    console.time('DAILY_REVENUE_DB_QUERY');
    
    const [transactions] = await req.app.locals.pool.promise().query(query, [date]);
    
    console.timeEnd('DAILY_REVENUE_DB_QUERY');
    console.log('📊 [REVENUE-ROUTES] Günlük ciro verileri alındı:', { 
      totalTransactionCount: transactions.length,
      date: date
    });

    // Ciro hesaplaması
    console.time('DAILY_REVENUE_CALCULATION');
    const summary = ProfitCalculator.calculateSimpleRevenueSummary(transactions);
    const categoryBreakdown = ProfitCalculator.calculateCategoryRevenueBreakdown(transactions, summary.totalRevenue);
    console.timeEnd('DAILY_REVENUE_CALCULATION');

    // Gün adını hesapla
    const dateObj = new Date(date);
    const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const dayName = dayNames[dateObj.getDay()];

    const response = {
      success: true,
      data: {
        period: {
          type: 'daily',
          date: date,
          dayName: dayName
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          revenueTransactionCount: summary.revenueTransactionCount,
          totalTransactionCount: summary.totalTransactionCount,
          averageRevenue: summary.averageRevenue,
          revenuePercentage: summary.totalTransactionCount > 0 ? 
            ((summary.revenueTransactionCount / summary.totalTransactionCount) * 100).toFixed(2) : '0.00'
        },
        breakdowns: {
          categories: categoryBreakdown
        },
        transactions: transactions
          .filter(tx => tx.amount > 0) // Amount değeri olan tüm işlemler
          .map(tx => ({
            id: tx.id,
            amount: Number(tx.amount),
            description: tx.description,
            transaction_date: tx.transaction_date,
            category_name: tx.category_name,
            vehicle_plate: tx.vehicle_plate,
            personnel_name: tx.personnel_name
          }))
      }
    };

    console.log('✅ [REVENUE-ROUTES] Günlük ciro hesaplama tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      revenueTransactionCount: summary.revenueTransactionCount,
      totalTransactionCount: summary.totalTransactionCount,
      averageRevenue: summary.averageRevenue
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('💥 [REVENUE-ROUTES] Günlük ciro hesaplama hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Günlük ciro hesaplanırken hata oluştu', 
      error: error.message 
    });
  }
});

// Haftalık ciro hesaplama
router.get('/weekly', authenticateToken, async (req, res) => {
  console.log('🚀 [REVENUE-ROUTES] Haftalık ciro hesaplama başlatıldı', {
    timestamp: new Date().toISOString(),
    endpoint: '/revenue/weekly',
    user: req.user?.id
  });
  
  try {
    const { year, week } = req.query;
    
    console.log('📋 [REVENUE-ROUTES] Haftalık ciro parametreleri:', { 
      year, 
      week,
      userRole: req.user?.role 
    });
    
    const targetYear = year || new Date().getFullYear();
    const targetWeek = week || Math.ceil((new Date().getTime() - new Date(targetYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    // Haftanın başlangıç ve bitiş tarihlerini hesapla
    const startOfYear = new Date(targetYear, 0, 1);
    const startOfWeek = new Date(startOfYear.getTime() + (targetWeek - 1) * 7 * 24 * 60 * 60 * 1000);
    const endOfWeek = new Date(startOfWeek.getTime() + 6 * 24 * 60 * 60 * 1000);

    const startDateStr = startOfWeek.toISOString().split('T')[0];
    const endDateStr = endOfWeek.toISOString().split('T')[0];

    console.log('📅 [REVENUE-ROUTES] Haftalık ciro tarih aralığı:', {
      startDate: startDateStr,
      endDate: endDateStr,
      year: targetYear,
      week: targetWeek
    });

    // Haftalık işlemleri çek (sadece ciro hesaplama için)
    const query = `
      SELECT 
        t.id,
        t.amount,
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
      WHERE t.transaction_date >= ? AND t.transaction_date <= ?
        AND t.status != 'cancelled'
      ORDER BY t.transaction_date ASC
    `;
    
    console.time('WEEKLY_REVENUE_DB_QUERY');
    const [transactions] = await req.app.locals.pool.promise().query(query, [startDateStr, endDateStr]);
    console.timeEnd('WEEKLY_REVENUE_DB_QUERY');
    
    console.log('📊 [REVENUE-ROUTES] Haftalık ciro verileri alındı:', { 
      totalTransactionCount: transactions.length,
      startDate: startDateStr,
      endDate: endDateStr
    });

    // Ciro hesaplaması
    console.time('WEEKLY_REVENUE_CALCULATION');
    const summary = ProfitCalculator.calculateSimpleRevenueSummary(transactions);
    const dailyBreakdown = ProfitCalculator.calculateDailyRevenueBreakdown(transactions);
    const categoryBreakdown = ProfitCalculator.calculateCategoryRevenueBreakdown(transactions, summary.totalRevenue);
    console.timeEnd('WEEKLY_REVENUE_CALCULATION');

    // Günlük ciro hesapla (haftanın 7 günü için)
    const dailyRevenue = {};
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startOfWeek.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayTransactions = transactions.filter(t => {
        const transactionDate = new Date(t.transaction_date);
        const transactionDateStr = transactionDate.toISOString().split('T')[0];
        return transactionDateStr === dateStr;
      });
      
      // Tüm işlemlerin amount değerini hesapla
      const dayRevenue = dayTransactions
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      
      dailyRevenue[dateStr] = {
        day: i + 1,
        dayName: currentDate.toLocaleDateString('tr-TR', { weekday: 'long' }),
        date: dateStr,
        revenue: dayRevenue,
        revenueTransactionCount: dayTransactions.filter(tx => tx.amount > 0).length,
        totalTransactionCount: dayTransactions.length
      };
    }

    const response = {
      success: true,
      data: {
        period: {
          type: 'weekly',
          year: parseInt(targetYear),
          week: parseInt(targetWeek),
          startDate: startDateStr,
          endDate: endDateStr
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          revenueTransactionCount: summary.revenueTransactionCount,
          totalTransactionCount: summary.totalTransactionCount,
          averageRevenue: summary.averageRevenue,
          averageDailyRevenue: summary.totalRevenue / 7
        },
        breakdowns: {
          daily: Object.values(dailyRevenue),
          categories: categoryBreakdown
        }
      }
    };

    console.log('✅ [REVENUE-ROUTES] Haftalık ciro hesaplama tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      revenueTransactionCount: summary.revenueTransactionCount,
      averageDailyRevenue: summary.totalRevenue / 7
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('💥 [REVENUE-ROUTES] Haftalık ciro hesaplama hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Haftalık ciro hesaplanırken hata oluştu', 
      error: error.message 
    });
  }
});

// Aylık ciro hesaplama
router.get('/monthly', authenticateToken, async (req, res) => {
  console.log('🚀 [REVENUE-ROUTES] Aylık ciro hesaplama başlatıldı', {
    timestamp: new Date().toISOString(),
    endpoint: '/revenue/monthly',
    user: req.user?.id
  });
  
  try {
    const { year, month } = req.query;
    
    console.log('📋 [REVENUE-ROUTES] Aylık ciro parametreleri:', { 
      year, 
      month,
      userRole: req.user?.role 
    });
    
    if (!year || !month) {
      console.error('❌ [REVENUE-ROUTES] Eksik parametreler:', { year, month });
      return res.status(400).json({ 
        success: false, 
        message: 'Yıl ve ay parametreleri zorunludur' 
      });
    }

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      console.error('❌ [REVENUE-ROUTES] Geçersiz parametre formatı:', { yearNum, monthNum });
      return res.status(400).json({ 
        success: false, 
        message: 'Geçersiz yıl veya ay formatı' 
      });
    }

    // Ayın ilk ve son günü
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(yearNum, monthNum, 0);
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    console.log('📅 [REVENUE-ROUTES] Aylık ciro tarih aralığı:', { 
      startDate, 
      endDateStr,
      dayCount: endDate.getDate()
    });

    // Aylık işlemleri çek (sadece ciro hesaplama için)
    const query = `
      SELECT 
        t.id,
        t.amount,
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
    
    console.time('MONTHLY_REVENUE_DB_QUERY');
    const [transactions] = await req.app.locals.pool.promise().query(query, [startDate, endDateStr]);
    console.timeEnd('MONTHLY_REVENUE_DB_QUERY');
    
    console.log('📊 [REVENUE-ROUTES] Aylık ciro verileri alındı:', { 
      totalTransactionCount: transactions.length,
      startDate,
      endDate: endDateStr
    });

    // Ciro hesaplaması
    console.time('MONTHLY_REVENUE_CALCULATION');
    const summary = ProfitCalculator.calculateSimpleRevenueSummary(transactions);
    const dailyBreakdown = ProfitCalculator.calculateDailyRevenueBreakdown(transactions);
    const categoryBreakdown = ProfitCalculator.calculateCategoryRevenueBreakdown(transactions, summary.totalRevenue);
    console.timeEnd('MONTHLY_REVENUE_CALCULATION');

    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                       'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

    const response = {
      success: true,
      data: {
        period: {
          type: 'monthly',
          year: yearNum,
          month: monthNum,
          monthName: monthNames[monthNum - 1],
          startDate,
          endDate: endDateStr,
          dayCount: endDate.getDate()
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          revenueTransactionCount: summary.revenueTransactionCount,
          totalTransactionCount: summary.totalTransactionCount,
          averageRevenue: summary.averageRevenue,
          averageDailyRevenue: summary.totalRevenue / endDate.getDate(),
          revenuePercentage: summary.totalTransactionCount > 0 ? 
            ((summary.revenueTransactionCount / summary.totalTransactionCount) * 100).toFixed(2) : '0.00'
        },
        breakdowns: {
          daily: dailyBreakdown,
          categories: categoryBreakdown
        }
      }
    };

    console.log('✅ [REVENUE-ROUTES] Aylık ciro hesaplama tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      revenueTransactionCount: summary.revenueTransactionCount,
      averageDailyRevenue: summary.totalRevenue / endDate.getDate(),
      categoryCount: categoryBreakdown.length
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('💥 [REVENUE-ROUTES] Aylık ciro hesaplama hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Aylık ciro hesaplanırken hata oluştu', 
      error: error.message 
    });
  }
});

// Yıllık ciro hesaplama
router.get('/yearly', authenticateToken, async (req, res) => {
  console.log('🚀 [REVENUE-ROUTES] Yıllık ciro hesaplama başlatıldı', {
    timestamp: new Date().toISOString(),
    endpoint: '/revenue/yearly',
    user: req.user?.id
  });
  
  try {
    const { year } = req.query;
    
    console.log('📋 [REVENUE-ROUTES] Yıllık ciro parametreleri:', { 
      year,
      userRole: req.user?.role 
    });
    
    if (!year) {
      console.error('❌ [REVENUE-ROUTES] Eksik parametre: yıl');
      return res.status(400).json({ 
        success: false, 
        message: 'Yıl parametresi zorunludur' 
      });
    }

    const yearNum = parseInt(year);
    
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 3000) {
      console.error('❌ [REVENUE-ROUTES] Geçersiz yıl formatı:', { yearNum });
      return res.status(400).json({ 
        success: false, 
        message: 'Geçersiz yıl formatı' 
      });
    }

    const startDate = `${yearNum}-01-01`;
    const endDate = `${yearNum}-12-31`;
    
    console.log('📅 [REVENUE-ROUTES] Yıllık ciro tarih aralığı:', { 
      startDate, 
      endDate,
      year: yearNum
    });

    // Yıllık işlemleri çek (sadece ciro hesaplama için)
    const query = `
      SELECT 
        t.id,
        t.amount,
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
    `;
    
    console.time('YEARLY_REVENUE_DB_QUERY');
    const [transactions] = await req.app.locals.pool.promise().query(query, [startDate, endDate]);
    console.timeEnd('YEARLY_REVENUE_DB_QUERY');
    
    console.log('📊 [REVENUE-ROUTES] Yıllık ciro verileri alındı:', { 
      totalTransactionCount: transactions.length,
      year: yearNum
    });

    // Ciro hesaplaması
    console.time('YEARLY_REVENUE_CALCULATION');
    const summary = ProfitCalculator.calculateSimpleRevenueSummary(transactions);
    const monthlyBreakdown = ProfitCalculator.calculateMonthlyRevenueBreakdown(transactions);
    const categoryBreakdown = ProfitCalculator.calculateCategoryRevenueBreakdown(transactions, summary.totalRevenue);
    console.timeEnd('YEARLY_REVENUE_CALCULATION');

    // En yüksek ciro'lu işlemleri bul (tüm işlemler)
    const topRevenueTransactions = transactions
      .filter(tx => tx.amount > 0)
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 20)
      .map(tx => ({
        id: tx.id,
        amount: Number(tx.amount),
        description: tx.description,
        transaction_date: tx.transaction_date,
        category_name: tx.category_name,
        vehicle_plate: tx.vehicle_plate,
        personnel_name: tx.personnel_name
      }));

    const response = {
      success: true,
      data: {
        period: {
          type: 'yearly',
          year: yearNum,
          startDate,
          endDate
        },
        summary: {
          totalRevenue: summary.totalRevenue,
          revenueTransactionCount: summary.revenueTransactionCount,
          totalTransactionCount: summary.totalTransactionCount,
          averageRevenue: summary.averageRevenue,
          averageMonthlyRevenue: summary.totalRevenue / 12,
          revenuePercentage: summary.totalTransactionCount > 0 ? 
            ((summary.revenueTransactionCount / summary.totalTransactionCount) * 100).toFixed(2) : '0.00'
        },
        breakdowns: {
          monthly: monthlyBreakdown,
          categories: categoryBreakdown.slice(0, 15), // Top 15 kategori
          topTransactions: topRevenueTransactions
        }
      }
    };

    console.log('✅ [REVENUE-ROUTES] Yıllık ciro hesaplama tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      revenueTransactionCount: summary.revenueTransactionCount,
      averageMonthlyRevenue: summary.totalRevenue / 12,
      monthlyBreakdownCount: monthlyBreakdown.length,
      topTransactionCount: topRevenueTransactions.length
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('💥 [REVENUE-ROUTES] Yıllık ciro hesaplama hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Yıllık ciro hesaplanırken hata oluştu', 
      error: error.message 
    });
  }
});

module.exports = router; 