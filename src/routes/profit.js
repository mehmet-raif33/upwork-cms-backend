const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const ProfitCalculator = require('../utils/profitCalculator');

// === KAR (PROFIT) HESAPLAMA ROUTE'LARI ===

// Günlük kar hesaplama
router.get('/daily', authenticateToken, async (req, res) => {
  console.log('🚀 [PROFIT-ROUTES] Günlük kar hesaplama başlatıldı', {
    timestamp: new Date().toISOString(),
    endpoint: '/profit/daily',
    user: req.user?.id
  });
  
  try {
    const { date, categories } = req.query;
    
    console.log('📋 [PROFIT-ROUTES] Günlük kar parametreleri:', { 
      date,
      categories,
      userRole: req.user?.role,
      originalDate: date,
      dateType: typeof date
    });
    
    if (!date) {
      console.error('❌ [PROFIT-ROUTES] Eksik parametre: tarih');
      return res.status(400).json({ 
        success: false, 
        message: 'Tarih parametresi zorunludur' 
      });
    }

    // 🔧 TIMEZONE FIX: Adjust date range to account for Turkey timezone (UTC+3)
    console.log('🕐 [PROFIT-ROUTES] Timezone düzeltmesi uygulanıyor...', {
      inputDate: date,
      timezone: 'Turkey (UTC+3)'
    });
    
    // For daily queries, adjust the date range to include the full Turkey day
    const startDateObj = new Date(date + 'T00:00:00.000Z');
    const endDateObj = new Date(date + 'T23:59:59.999Z');
    
    // Subtract 3 hours to get the UTC equivalent of Turkey timezone start/end
    const adjustedStartDate = new Date(startDateObj.getTime() - (3 * 60 * 60 * 1000)).toISOString().split('.')[0];
    const adjustedEndDate = new Date(endDateObj.getTime() - (3 * 60 * 60 * 1000)).toISOString().split('.')[0];
    
    console.log('🔧 [PROFIT-ROUTES] TIMEZONE FIX - Daily profit adjusted dates:', {
      originalDate: date,
      adjustedStart: adjustedStartDate,
      adjustedEnd: adjustedEndDate,
      startDateObj: startDateObj.toISOString(),
      endDateObj: endDateObj.toISOString()
    });

    // Kategoriler filtresi parametrelerini hazırla
    let categoryFilter = '';
    let queryParams = [adjustedStartDate, adjustedEndDate];
    
    if (categories && categories.length > 0) {
      const categoryIds = categories.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (categoryIds.length > 0) {
        categoryFilter = `AND t.category_id IN (${categoryIds.map(() => '?').join(',')})`;
        queryParams.push(...categoryIds);
        console.log('🏷️ [PROFIT-ROUTES] Kategoriler filtresi uygulanıyor:', { categoryIds });
      }
    }

    // 🔧 UPDATED QUERY: Use timezone-adjusted range instead of DATE() function
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
      WHERE t.transaction_date >= ? AND t.transaction_date <= ?
        AND t.status != 'cancelled'
        ${categoryFilter}
      ORDER BY t.transaction_date ASC
    `;
    
    console.log('🔍 [PROFIT-ROUTES] Günlük kar SQL sorgusu hazırlandı:', {
      query: query.replace(/\s+/g, ' ').trim(),
      queryParams: queryParams,
      paramCount: queryParams.length
    });
    console.time('DAILY_PROFIT_DB_QUERY');
    
    const [transactions] = await req.app.locals.pool.promise().query(query, queryParams);
    
    console.timeEnd('DAILY_PROFIT_DB_QUERY');
    console.log('📊 [PROFIT-ROUTES] Günlük kar verileri alındı:', { 
      transactionCount: transactions.length,
      date: date,
      adjustedDateRange: `${adjustedStartDate} to ${adjustedEndDate}`,
      sampleTransactions: transactions.slice(0, 3).map(tx => ({
        id: tx.id,
        transaction_date: tx.transaction_date,
        amount: tx.amount,
        expense: tx.expense
      }))
    });

    // 📋 DETAILED TRANSACTION LOGGING
    console.log('💼 [PROFIT-ROUTES] Tüm işlemler detayı:', {
      totalTransactions: transactions.length,
      allTransactionDates: transactions.map(tx => ({
        id: tx.id,
        original_date: tx.transaction_date,
        turkey_date: new Date(new Date(tx.transaction_date).getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0],
        amount: tx.amount,
        expense: tx.expense,
        category: tx.category_name
      })),
      dateFilterApplied: `${adjustedStartDate} to ${adjustedEndDate}`,
      requestedDate: date
    });

    // Kar hesaplaması
    console.time('DAILY_PROFIT_CALCULATION');
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    const categoryBreakdown = ProfitCalculator.calculateSimpleCategoryBreakdown(transactions, summary.totalRevenue);
    const vehicleBreakdown = ProfitCalculator.calculateSimpleVehicleBreakdown(transactions, summary.totalRevenue);
    const personnelAnalysis = ProfitCalculator.calculatePersonnelAnalysis(transactions);
    console.timeEnd('DAILY_PROFIT_CALCULATION');

    console.log('🧮 [PROFIT-ROUTES] Kar hesaplama sonuçları:', {
      summary: summary,
      categoryBreakdownCount: categoryBreakdown.length,
      vehicleBreakdownCount: vehicleBreakdown.length,
      categorySummary: categoryBreakdown.map(cat => ({
        category: cat.category,
        revenue: cat.revenue,
        expense: cat.expense,
        profit: cat.profit
      }))
    });

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
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          transactionCount: summary.transactionCount,
          averageTransaction: summary.averageTransaction
        },
        breakdowns: {
          categories: categoryBreakdown,
          vehicles: vehicleBreakdown,
          personnel: personnelAnalysis
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
            is_expense: !!tx.is_expense
          };
        })
      }
    };

    console.log('✅ [PROFIT-ROUTES] Günlük kar hesaplama tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      totalExpense: summary.totalExpense,
      totalProfit: summary.totalProfit,
      transactionCount: summary.transactionCount,
      responseDataSize: JSON.stringify(response).length + ' characters',
      finalTransactionList: response.data.transactions.map(tx => ({
        id: tx.id,
        date: tx.transaction_date,
        revenue: tx.revenue,
        expense: tx.expense,
        profit: tx.profit
      }))
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('💥 [PROFIT-ROUTES] Günlük kar hesaplama hatası:', {
      error: error,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ 
      success: false, 
      message: 'Günlük kar hesaplanırken hata oluştu', 
      error: error.message 
    });
  }
});

// Haftalık kar hesaplama
router.get('/weekly', authenticateToken, async (req, res) => {
  console.log('🚀 [PROFIT-ROUTES] Haftalık kar hesaplama başlatıldı', {
    timestamp: new Date().toISOString(),
    endpoint: '/profit/weekly',
    user: req.user?.id
  });
  
  try {
    const { year, week, categories } = req.query;
    
    console.log('📋 [PROFIT-ROUTES] Haftalık kar parametreleri:', { 
      year, 
      week,
      categories,
      userRole: req.user?.role,
      yearType: typeof year,
      weekType: typeof week
    });
    
    const targetYear = year || new Date().getFullYear();
    const targetWeek = week || Math.ceil((new Date().getTime() - new Date(targetYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    // Haftanın başlangıç ve bitiş tarihlerini hesapla
    const startOfYear = new Date(targetYear, 0, 1);
    const startOfWeek = new Date(startOfYear.getTime() + (targetWeek - 1) * 7 * 24 * 60 * 60 * 1000);
    const endOfWeek = new Date(startOfWeek.getTime() + 6 * 24 * 60 * 60 * 1000);

    const startDateStr = startOfWeek.toISOString().split('T')[0];
    const endDateStr = endOfWeek.toISOString().split('T')[0];

    console.log('📅 [PROFIT-ROUTES] Haftalık kar tarih aralığı:', {
      startDate: startDateStr,
      endDate: endDateStr,
      year: targetYear,
      week: targetWeek,
      startOfYearCalc: startOfYear.toISOString(),
      startOfWeekCalc: startOfWeek.toISOString(),
      endOfWeekCalc: endOfWeek.toISOString(),
      dateRangeHumanReadable: `${startOfWeek.toLocaleDateString('tr-TR')} - ${endOfWeek.toLocaleDateString('tr-TR')}`
    });

    // Kategoriler filtresi parametrelerini hazırla
    let categoryFilter = '';
    let queryParams = [startDateStr, endDateStr];
    
    if (categories && categories.length > 0) {
      const categoryIds = categories.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (categoryIds.length > 0) {
        categoryFilter = `AND t.category_id IN (${categoryIds.map(() => '?').join(',')})`;
        queryParams.push(...categoryIds);
        console.log('🏷️ [PROFIT-ROUTES] Kategoriler filtresi uygulanıyor:', { categoryIds });
      }
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
      WHERE t.transaction_date >= ? AND t.transaction_date <= ?
        AND t.status != 'cancelled'
        ${categoryFilter}
      ORDER BY t.transaction_date ASC
    `;
    
    console.log('🔍 [PROFIT-ROUTES] Haftalık kar SQL sorgusu hazırlandı:', {
      query: query.replace(/\s+/g, ' ').trim(),
      queryParams: queryParams,
      paramCount: queryParams.length
    });
    
    console.time('WEEKLY_PROFIT_DB_QUERY');
    const [transactions] = await req.app.locals.pool.promise().query(query, queryParams);
    console.timeEnd('WEEKLY_PROFIT_DB_QUERY');
    
    console.log('📊 [PROFIT-ROUTES] Haftalık kar verileri alındı:', { 
      transactionCount: transactions.length,
      startDate: startDateStr,
      endDate: endDateStr,
      sampleTransactions: transactions.slice(0, 3).map(tx => ({
        id: tx.id,
        transaction_date: tx.transaction_date,
        amount: tx.amount,
        expense: tx.expense
      }))
    });

    // 📋 DETAILED TRANSACTION LOGGING FOR WEEKLY
    console.log('💼 [PROFIT-ROUTES] Haftalık tüm işlemler detayı:', {
      totalTransactions: transactions.length,
      allTransactionDates: transactions.map(tx => ({
        id: tx.id,
        original_date: tx.transaction_date,
        turkey_date: new Date(new Date(tx.transaction_date).getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0],
        amount: tx.amount,
        expense: tx.expense,
        category: tx.category_name,
        dayOfWeek: new Date(tx.transaction_date).toLocaleDateString('tr-TR', { weekday: 'long' })
      })),
      dateFilterApplied: `${startDateStr} to ${endDateStr}`,
      requestedWeek: `Year ${targetYear}, Week ${targetWeek}`
    });

    // Kar hesaplaması
    console.time('WEEKLY_PROFIT_CALCULATION');
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    const dailyTrend = ProfitCalculator.calculateDailyTrend(transactions);
    const categoryBreakdown = ProfitCalculator.calculateSimpleCategoryBreakdown(transactions, summary.totalRevenue);
    const vehicleAnalysis = ProfitCalculator.calculateVehicleAnalysis(transactions);
    const personnelAnalysis = ProfitCalculator.calculatePersonnelAnalysis(transactions);
    console.timeEnd('WEEKLY_PROFIT_CALCULATION');

    console.log('🧮 [PROFIT-ROUTES] Haftalık kar hesaplama sonuçları:', {
      summary: summary,
      dailyTrendCount: dailyTrend.length,
      categoryBreakdownCount: categoryBreakdown.length,
      vehicleAnalysisCount: vehicleAnalysis.length,
      personnelAnalysisCount: personnelAnalysis.length,
      transactionsCount: transactions.length,
      dailyTrendDetails: dailyTrend.map(day => ({
        date: day.tarih || day.date,
        revenue: day.gunluk_gelir || day.revenue,
        expense: day.gunluk_gider || day.expense,
        profit: day.gunluk_kar || day.profit
      })),
      vehicleAnalysisDetails: vehicleAnalysis.slice(0, 3).map(vehicle => ({
        plate: vehicle.arac_plaka,
        revenue: vehicle.arac_gelir,
        expense: vehicle.arac_gider,
        profit: vehicle.arac_kar
      })),
      personnelAnalysisDetails: personnelAnalysis.slice(0, 3).map(personnel => ({
        name: personnel.personel_adi,
        revenue: personnel.personel_gelir,
        expense: personnel.personel_gider,
        profit: personnel.personel_kar
      })),
      categorySummary: categoryBreakdown.map(cat => ({
        category: cat.category,
        revenue: cat.revenue,
        expense: cat.expense,
        profit: cat.profit
      }))
    });

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
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          transactionCount: summary.transactionCount,
          averageTransaction: summary.averageTransaction,
          averageDailyProfit: summary.totalProfit / 7
        },
        breakdowns: {
          daily: dailyTrend,
          categories: categoryBreakdown,
          vehicles: vehicleAnalysis,
          personnel: personnelAnalysis
        },
        transactions: transactions.map(tx => ({
          id: tx.id.toString(),
          amount: parseFloat(tx.amount || 0),
          expense: parseFloat(tx.expense || 0),
          profit: parseFloat(tx.amount || 0) - parseFloat(tx.expense || 0),
          description: tx.description || '',
          transaction_date: tx.transaction_date,
          category_name: tx.category_name || '',
          vehicle_plate: tx.vehicle_plate || '',
          personnel_name: tx.personnel_name || '',
          is_expense: Boolean(tx.is_expense)
        }))
      }
    };

    console.log('✅ [PROFIT-ROUTES] Haftalık kar hesaplama tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      totalExpense: summary.totalExpense,
      totalProfit: summary.totalProfit,
      averageDailyProfit: summary.totalProfit / 7,
      responseDataSize: JSON.stringify(response).length + ' characters',
      finalDailyBreakdown: response.data.breakdowns.daily.map(day => ({
        date: day.tarih || day.date,
        profit: day.gunluk_kar || day.profit
      }))
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('💥 [PROFIT-ROUTES] Haftalık kar hesaplama hatası:', {
      error: error,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ 
      success: false, 
      message: 'Haftalık kar hesaplanırken hata oluştu', 
      error: error.message 
    });
  }
});

// Aylık kar hesaplama
router.get('/monthly', authenticateToken, async (req, res) => {
  console.log('🚀 [PROFIT-ROUTES] Aylık kar hesaplama başlatıldı', {
    timestamp: new Date().toISOString(),
    endpoint: '/profit/monthly',
    user: req.user?.id
  });
  
  try {
    const { year, month, categories } = req.query;
    
    console.log('📋 [PROFIT-ROUTES] Aylık kar parametreleri:', { 
      year, 
      month,
      categories,
      userRole: req.user?.role,
      yearType: typeof year,
      monthType: typeof month
    });
    
    if (!year || !month) {
      console.error('❌ [PROFIT-ROUTES] Eksik parametreler:', { year, month });
      return res.status(400).json({ 
        success: false, 
        message: 'Yıl ve ay parametreleri zorunludur' 
      });
    }

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      console.error('❌ [PROFIT-ROUTES] Geçersiz parametre formatı:', { yearNum, monthNum });
      return res.status(400).json({ 
        success: false, 
        message: 'Geçersiz yıl veya ay formatı' 
      });
    }

    // Ayın ilk ve son günü
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(yearNum, monthNum, 0);
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    console.log('📅 [PROFIT-ROUTES] Aylık kar tarih aralığı:', { 
      startDate, 
      endDateStr,
      dayCount: endDate.getDate(),
      monthName: new Date(yearNum, monthNum - 1).toLocaleDateString('tr-TR', { month: 'long' }),
      fullPeriod: `${startDate} to ${endDateStr}`,
      calculatedEndDate: endDate.toISOString().split('T')[0]
    });

    // Kategoriler filtresi parametrelerini hazırla
    let categoryFilter = '';
    let queryParams = [startDate, endDateStr];
    
    if (categories && categories.length > 0) {
      const categoryIds = categories.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (categoryIds.length > 0) {
        categoryFilter = `AND t.category_id IN (${categoryIds.map(() => '?').join(',')})`;
        queryParams.push(...categoryIds);
        console.log('🏷️ [PROFIT-ROUTES] Kategoriler filtresi uygulanıyor:', { categoryIds });
      }
    }

    // 🔧 TIMEZONE CONSIDERATION: Using CONVERT_TZ for consistent date comparison
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
      WHERE DATE(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) BETWEEN ? AND ?
        AND t.status != 'cancelled'
        ${categoryFilter}
      ORDER BY t.transaction_date ASC
    `;
    
    console.log('🔍 [PROFIT-ROUTES] Aylık kar SQL sorgusu hazırlandı:', {
      query: query.replace(/\s+/g, ' ').trim(),
      queryParams: queryParams,
      paramCount: queryParams.length
    });
    
    console.time('MONTHLY_PROFIT_DB_QUERY');
    const [transactions] = await req.app.locals.pool.promise().query(query, queryParams);
    console.timeEnd('MONTHLY_PROFIT_DB_QUERY');
    
    console.log('📊 [PROFIT-ROUTES] Aylık kar verileri alındı:', { 
      transactionCount: transactions.length,
      startDate,
      endDate: endDateStr,
      sampleTransactions: transactions.slice(0, 5).map(tx => ({
        id: tx.id,
        transaction_date: tx.transaction_date,
        amount: tx.amount,
        expense: tx.expense,
        category: tx.category_name
      }))
    });

    // 📋 DETAILED TRANSACTION LOGGING FOR MONTHLY
    console.log('💼 [PROFIT-ROUTES] Aylık tüm işlemler detayı:', {
      totalTransactions: transactions.length,
      monthlyDateDistribution: transactions.reduce((acc, tx) => {
        const day = new Date(new Date(tx.transaction_date).getTime() + (3 * 60 * 60 * 1000)).getDate();
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {}),
      transactionsByCategory: transactions.reduce((acc, tx) => {
        const cat = tx.category_name || 'Unknown';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {}),
      dateFilterApplied: `${startDate} to ${endDateStr}`,
      requestedPeriod: `${yearNum}/${monthNum}`,
      firstTransaction: transactions[0] ? {
        id: transactions[0].id,
        date: transactions[0].transaction_date,
        turkey_date: new Date(new Date(transactions[0].transaction_date).getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0]
      } : null,
      lastTransaction: transactions[transactions.length - 1] ? {
        id: transactions[transactions.length - 1].id,
        date: transactions[transactions.length - 1].transaction_date,
        turkey_date: new Date(new Date(transactions[transactions.length - 1].transaction_date).getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0]
      } : null
    });

    // Kar hesaplaması
    console.time('MONTHLY_PROFIT_CALCULATION');
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    const dailyTrend = ProfitCalculator.calculateDailyTrend(transactions);
    const categoryAnalysis = ProfitCalculator.calculateCategoryAnalysis(transactions);
    const vehicleAnalysis = ProfitCalculator.calculateVehicleAnalysis(transactions);
    const personnelAnalysis = ProfitCalculator.calculatePersonnelAnalysis(transactions);
    const generalStats = ProfitCalculator.calculateGeneralStats(transactions);
    console.timeEnd('MONTHLY_PROFIT_CALCULATION');

    console.log('🧮 [PROFIT-ROUTES] Aylık kar hesaplama sonuçları:', {
      summary: summary,
      dailyTrendCount: dailyTrend.length,
      categoryAnalysisCount: categoryAnalysis.length,
      vehicleAnalysisCount: vehicleAnalysis.length,
      personnelAnalysisCount: personnelAnalysis.length,
      dailyTrendSample: dailyTrend.slice(0, 5).map(day => ({
        date: day.tarih || day.date,
        revenue: day.gunluk_gelir || day.revenue,
        expense: day.gunluk_gider || day.expense,
        profit: day.gunluk_kar || day.profit
      })),
      categoryAnalysisSample: categoryAnalysis.slice(0, 3).map(cat => ({
        category: cat.kategori_adi || cat.category,
        revenue: cat.kategori_gelir || cat.revenue,
        expense: cat.kategori_gider || cat.expense,
        profit: cat.kategori_kar || cat.profit
      }))
    });

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
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          transactionCount: summary.transactionCount,
          averageTransaction: summary.averageTransaction,
          averageDailyProfit: summary.totalProfit / endDate.getDate()
        },
        analysis: {
          basicAnalysis: ProfitCalculator.calculateBasicAnalysis(transactions, yearNum, monthNum),
          categoryAnalysis,
          vehicleAnalysis,
          personnelAnalysis,
          generalStats
        },
        trends: {
          dailyTrend
        },
        transactions: transactions.map(tx => ({
          id: tx.id.toString(),
          amount: parseFloat(tx.amount || 0),
          expense: parseFloat(tx.expense || 0),
          profit: parseFloat(tx.amount || 0) - parseFloat(tx.expense || 0),
          description: tx.description || '',
          transaction_date: tx.transaction_date,
          category_name: tx.category_name || '',
          vehicle_plate: tx.vehicle_plate || '',
          personnel_name: tx.personnel_name || '',
          is_expense: Boolean(tx.is_expense)
        }))
      }
    };

    console.log('✅ [PROFIT-ROUTES] Aylık kar hesaplama tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      totalExpense: summary.totalExpense,
      totalProfit: summary.totalProfit,
      averageDailyProfit: summary.totalProfit / endDate.getDate(),
      responseDataSize: JSON.stringify(response).length + ' characters',
      analysisBreakdown: {
        categoryCount: response.data.analysis.categoryAnalysis.length,
        vehicleCount: response.data.analysis.vehicleAnalysis.length,
        personnelCount: response.data.analysis.personnelAnalysis.length,
        dailyTrendCount: response.data.trends.dailyTrend.length
      }
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('💥 [PROFIT-ROUTES] Aylık kar hesaplama hatası:', {
      error: error,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ 
      success: false, 
      message: 'Aylık kar hesaplanırken hata oluştu', 
      error: error.message 
    });
  }
});

// Yıllık kar hesaplama
router.get('/yearly', authenticateToken, async (req, res) => {
  console.log('🚀 [PROFIT-ROUTES] Yıllık kar hesaplama başlatıldı', {
    timestamp: new Date().toISOString(),
    endpoint: '/profit/yearly',
    user: req.user?.id
  });
  
  try {
    const { year, categories } = req.query;
    
    console.log('📋 [PROFIT-ROUTES] Yıllık kar parametreleri:', { 
      year,
      categories,
      userRole: req.user?.role,
      yearType: typeof year
    });
    
    if (!year) {
      console.error('❌ [PROFIT-ROUTES] Eksik parametre: yıl');
      return res.status(400).json({ 
        success: false, 
        message: 'Yıl parametresi zorunludur' 
      });
    }

    const yearNum = parseInt(year);
    
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 3000) {
      console.error('❌ [PROFIT-ROUTES] Geçersiz yıl formatı:', { yearNum });
      return res.status(400).json({ 
        success: false, 
        message: 'Geçersiz yıl formatı' 
      });
    }

    const startDate = `${yearNum}-01-01`;
    const endDate = `${yearNum}-12-31`;
    
    console.log('📅 [PROFIT-ROUTES] Yıllık kar tarih aralığı:', { 
      startDate, 
      endDate,
      year: yearNum,
      fullPeriod: `${startDate} to ${endDate}`,
      dateRangeHumanReadable: `${new Date(startDate).toLocaleDateString('tr-TR')} - ${new Date(endDate).toLocaleDateString('tr-TR')}`
    });

    // Kategoriler filtresi parametrelerini hazırla
    let categoryFilter = '';
    let queryParams = [startDate, endDate];
    
    if (categories && categories.length > 0) {
      const categoryIds = categories.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (categoryIds.length > 0) {
        categoryFilter = `AND t.category_id IN (${categoryIds.map(() => '?').join(',')})`;
        queryParams.push(...categoryIds);
        console.log('🏷️ [PROFIT-ROUTES] Kategoriler filtresi uygulanıyor:', { categoryIds });
      }
    }

    // 🔧 TIMEZONE CONSIDERATION: Using CONVERT_TZ for consistent date comparison
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
        p.full_name as personnel_name,
        MONTH(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) as month
      FROM transactions t
      LEFT JOIN transaction_categories tc ON t.category_id = tc.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN personnel p ON t.personnel_id = p.id
      WHERE DATE(CONVERT_TZ(t.transaction_date, '+00:00', '+03:00')) BETWEEN ? AND ?
        AND t.status != 'cancelled'
        ${categoryFilter}
      ORDER BY t.transaction_date ASC
    `;
    
    console.log('🔍 [PROFIT-ROUTES] Yıllık kar SQL sorgusu hazırlandı:', {
      query: query.replace(/\s+/g, ' ').trim(),
      queryParams: queryParams,
      paramCount: queryParams.length
    });
    
    console.time('YEARLY_PROFIT_DB_QUERY');
    const [transactions] = await req.app.locals.pool.promise().query(query, queryParams);
    console.timeEnd('YEARLY_PROFIT_DB_QUERY');
    
    console.log('📊 [PROFIT-ROUTES] Yıllık kar verileri alındı:', { 
      transactionCount: transactions.length,
      startDate,
      endDate,
      sampleTransactions: transactions.slice(0, 5).map(tx => ({
        id: tx.id,
        transaction_date: tx.transaction_date,
        amount: tx.amount,
        expense: tx.expense,
        month: tx.month
      }))
    });

    // 📋 DETAILED TRANSACTION LOGGING FOR YEARLY
    console.log('💼 [PROFIT-ROUTES] Yıllık tüm işlemler detayı:', {
      totalTransactions: transactions.length,
      yearlyMonthDistribution: transactions.reduce((acc, tx) => {
        const month = tx.month;
        acc[month] = (acc[month] || 0) + 1;
        return acc;
      }, {}),
      transactionsByCategory: transactions.reduce((acc, tx) => {
        const cat = tx.category_name || 'Unknown';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {}),
      dateFilterApplied: `${startDate} to ${endDate}`,
      requestedYear: yearNum,
      firstTransaction: transactions[0] ? {
        id: transactions[0].id,
        date: transactions[0].transaction_date,
        turkey_date: new Date(new Date(transactions[0].transaction_date).getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0],
        month: transactions[0].month
      } : null,
      lastTransaction: transactions[transactions.length - 1] ? {
        id: transactions[transactions.length - 1].id,
        date: transactions[transactions.length - 1].transaction_date,
        turkey_date: new Date(new Date(transactions[transactions.length - 1].transaction_date).getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0],
        month: transactions[transactions.length - 1].month
      } : null
    });

    // Kar hesaplaması
    console.time('YEARLY_PROFIT_CALCULATION');
    const summary = ProfitCalculator.calculateSimpleProfitSummary(transactions);
    const monthlyBreakdown = ProfitCalculator.calculateMonthlyBreakdown(transactions);
    const categoryBreakdown = ProfitCalculator.calculateCategoryAnalysis(transactions);
    const vehicleAnalysis = ProfitCalculator.calculateVehicleAnalysis(transactions);
    const personnelAnalysis = ProfitCalculator.calculatePersonnelAnalysis(transactions);
    console.timeEnd('YEARLY_PROFIT_CALCULATION');

    console.log('🧮 [PROFIT-ROUTES] Yıllık kar hesaplama sonuçları:', {
      summary: summary,
      monthlyBreakdownCount: monthlyBreakdown.length,
      categoryBreakdownCount: categoryBreakdown.length,
      vehicleAnalysisCount: vehicleAnalysis.length,
      personnelAnalysisCount: personnelAnalysis.length,
      monthlyBreakdownSample: monthlyBreakdown.slice(0, 6).map(month => ({
        month: month.month,
        monthName: month.monthName,
        revenue: month.revenue,
        expense: month.expense,
        profit: month.profit
      })),
      categoryBreakdownSample: categoryBreakdown.slice(0, 3).map(cat => ({
        category: cat.kategori_adi || cat.category,
        revenue: cat.kategori_gelir || cat.revenue,
        expense: cat.kategori_gider || cat.expense,
        profit: cat.kategori_kar || cat.profit
      })),
      vehicleAnalysisSample: vehicleAnalysis.slice(0, 3).map(vehicle => ({
        vehicle: vehicle.arac_plaka || vehicle.vehicle,
        revenue: vehicle.arac_gelir || vehicle.revenue,
        expense: vehicle.arac_gider || vehicle.expense,
        profit: vehicle.arac_kar || vehicle.profit
      }))
    });

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
          totalExpense: summary.totalExpense,
          totalProfit: summary.totalProfit,
          profitMargin: summary.profitMargin,
          transactionCount: summary.transactionCount,
          averageTransaction: summary.averageTransaction,
          averageMonthlyProfit: summary.totalProfit / 12
        },
        breakdowns: {
          monthly: monthlyBreakdown,
          categories: categoryBreakdown,
          vehicles: vehicleAnalysis,
          personnel: personnelAnalysis
        },
        transactions: transactions.map(tx => ({
          id: tx.id.toString(),
          amount: parseFloat(tx.amount || 0),
          expense: parseFloat(tx.expense || 0),
          profit: parseFloat(tx.amount || 0) - parseFloat(tx.expense || 0),
          description: tx.description || '',
          transaction_date: tx.transaction_date,
          category_name: tx.category_name || '',
          vehicle_plate: tx.vehicle_plate || '',
          personnel_name: tx.personnel_name || '',
          is_expense: Boolean(tx.is_expense)
        }))
      }
    };

    console.log('✅ [PROFIT-ROUTES] Yıllık kar hesaplama tamamlandı:', {
      totalRevenue: summary.totalRevenue,
      totalExpense: summary.totalExpense,
      totalProfit: summary.totalProfit,
      averageMonthlyProfit: summary.totalProfit / 12,
      responseDataSize: JSON.stringify(response).length + ' characters',
      breakdownSummary: {
        monthlyCount: response.data.breakdowns.monthly.length,
        categoryCount: response.data.breakdowns.categories.length
      },
      finalMonthlyBreakdown: response.data.breakdowns.monthly.map(month => ({
        month: month.month,
        profit: month.profit
      }))
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('💥 [PROFIT-ROUTES] Yıllık kar hesaplama hatası:', {
      error: error,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ 
      success: false, 
      message: 'Yıllık kar hesaplanırken hata oluştu', 
      error: error.message 
    });
  }
});

module.exports = router; 