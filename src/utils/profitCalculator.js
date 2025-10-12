// Kar ve Ciro hesaplama yardımcı fonksiyonları
const ProfitCalculator = {
  
  // === CİRO (REVENUE) HESAPLAMA FONKSİYONLARI ===
  
  // Transaction'dan ciro miktarını hesapla (tüm işlemler)
  calculateRevenueAmount(tx) {
    // Tüm işlemlerden amount değeri ciro olarak sayılır
    return Number(tx.amount) || 0; // İşlem ücreti (ciro)
  },

  // Basit ciro özetleri
  calculateSimpleRevenueSummary(transactions) {
    let totalRevenue = 0;
    let revenueTransactionCount = 0;

    transactions.forEach(tx => {
      const revenue = this.calculateRevenueAmount(tx);
      if (revenue > 0) {
        totalRevenue += revenue;
        revenueTransactionCount++;
      }
    });

    const averageRevenue = revenueTransactionCount > 0 ? (totalRevenue / revenueTransactionCount) : 0;

    return {
      totalRevenue,
      revenueTransactionCount,
      averageRevenue: Math.round(averageRevenue * 100) / 100,
      totalTransactionCount: transactions.length
    };
  },

  // Günlük ciro dağılımı
  calculateDailyRevenueBreakdown(transactions) {
    const dailyMap = {};

    transactions.forEach(tx => {
      const date = tx.transaction_date.toISOString().split('T')[0];
      const revenue = this.calculateRevenueAmount(tx);

      if (!dailyMap[date]) {
        const dateObj = new Date(date);
        const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
        
        dailyMap[date] = {
          tarih: date,
          gun_adi: dayNames[dateObj.getDay()],
          gunluk_ciro: 0,
          gunluk_gelir_islem_sayisi: 0,
          gunluk_toplam_islem_sayisi: 0
        };
      }

      dailyMap[date].gunluk_toplam_islem_sayisi += 1;
      if (revenue > 0) {
        dailyMap[date].gunluk_ciro += revenue;
        dailyMap[date].gunluk_gelir_islem_sayisi += 1;
      }
    });

    return Object.values(dailyMap).sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
  },

  // Haftalık ciro dağılımı
  calculateWeeklyRevenueBreakdown(transactions) {
    const weeklyData = {};
    
    transactions.forEach(tx => {
      const revenue = this.calculateRevenueAmount(tx);
      const date = new Date(tx.transaction_date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Haftanın başlangıcı (Pazar)
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = {
          hafta_baslangic: weekKey,
          haftalik_ciro: 0,
          haftalik_gelir_islem_sayisi: 0,
          haftalik_toplam_islem_sayisi: 0
        };
      }
      
      weeklyData[weekKey].haftalik_toplam_islem_sayisi += 1;
      if (revenue > 0) {
        weeklyData[weekKey].haftalik_ciro += revenue;
        weeklyData[weekKey].haftalik_gelir_islem_sayisi += 1;
      }
    });
    
    return Object.values(weeklyData).sort((a, b) => new Date(a.hafta_baslangic) - new Date(b.hafta_baslangic));
  },

  // Aylık ciro dağılımı
  calculateMonthlyRevenueBreakdown(transactions) {
    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
                       'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    
    const monthlyData = {};
    
    transactions.forEach(tx => {
      const revenue = this.calculateRevenueAmount(tx);
      const date = new Date(tx.transaction_date);
      const month = date.getMonth() + 1;
      const year = date.getFullYear();
      const monthKey = `${year}-${month}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          ay: month,
          yil: year,
          ay_adi: monthNames[month - 1],
          aylik_ciro: 0,
          aylik_gelir_islem_sayisi: 0,
          aylik_toplam_islem_sayisi: 0
        };
      }
      
      monthlyData[monthKey].aylik_toplam_islem_sayisi += 1;
      if (revenue > 0) {
        monthlyData[monthKey].aylik_ciro += revenue;
        monthlyData[monthKey].aylik_gelir_islem_sayisi += 1;
      }
    });
    
    return Object.values(monthlyData).sort((a, b) => {
      if (a.yil !== b.yil) return a.yil - b.yil;
      return a.ay - b.ay;
    });
  },

  // Kategori bazında ciro analizi
  calculateCategoryRevenueBreakdown(transactions, totalRevenue) {
    const categoryMap = {};

    transactions.forEach(tx => {
      const categoryName = tx.category_name || 'Kategori Belirtilmemiş';
      const revenue = this.calculateRevenueAmount(tx);

      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = {
          category: categoryName,
          revenue: 0,
          transactionCount: 0,
          percentage: '0.00'
        };
      }

      categoryMap[categoryName].transactionCount += 1;
      if (revenue > 0) {
        categoryMap[categoryName].revenue += revenue;
      }
    });

    return Object.values(categoryMap).map(cat => {
      cat.percentage = totalRevenue > 0 ? ((cat.revenue / totalRevenue) * 100).toFixed(2) : '0.00';
      return cat;
    }).sort((a, b) => b.revenue - a.revenue);
  },

  // === KAR (PROFIT) HESAPLAMA FONKSİYONLARI ===

  // Transaction'dan gelir/gider miktarını hesapla
  calculateAmounts(tx) {
    // is_expense alanı kar hesaplamada kullanılmayacak
    // Her işlem için: revenue = amount (işlem ücreti), expense = expense (işlem maliyeti)
    return {
      revenue: Number(tx.amount) || 0,      // İşlem ücreti (müşteriden alınan)
      expense: Number(tx.expense) || 0      // İşlem maliyeti (gerçek maliyet)
    };
  },

  // Temel kar hesaplamaları
  calculateBasicAnalysis(transactions, year, month) {
    let totalRevenue = 0;
    let totalExpense = 0;
    let transactionCount = transactions.length;

    transactions.forEach(tx => {
      const { revenue, expense } = this.calculateAmounts(tx);
      totalRevenue += revenue;
      totalExpense += expense;
    });

    const netProfit = totalRevenue - totalExpense;
    const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100) : 0;
    const averageTransaction = transactionCount > 0 ? 
      ((totalRevenue + totalExpense) / transactionCount) : 0;

    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                       'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

    return {
      rapor_bölümü: 'TEMEL AYLIK KAR ANALİZİ',
      analiz_periyodu: `${year} - ${monthNames[month - 1]}`,
      toplam_gelir: totalRevenue,
      toplam_gider: totalExpense,
      net_kar: netProfit,
      kar_marji_yuzde: Math.round(profitMargin * 100) / 100,
      toplam_islem_sayisi: transactionCount,
      ortalama_islem_tutari: Math.round(averageTransaction * 100) / 100
    };
  },

  // Basit kar özetleri (transactions.js için)
  calculateSimpleProfitSummary(transactions) {
    let totalRevenue = 0;
    let totalExpense = 0;
    let transactionCount = transactions.length;

    transactions.forEach(tx => {
      const { revenue, expense } = this.calculateAmounts(tx);
      totalRevenue += revenue;
      totalExpense += expense;
    });

    const totalProfit = totalRevenue - totalExpense;
    const profitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100) : 0;
    const averageTransaction = transactionCount > 0 ? (totalRevenue / transactionCount) : 0;

    return {
      totalRevenue,
      totalExpense,
      totalProfit,
      profitMargin: Math.round(profitMargin * 100) / 100,
      transactionCount,
      averageTransaction: Math.round(averageTransaction * 100) / 100
    };
  },

  // Kategoriye göre kar analizi
  calculateCategoryAnalysis(transactions) {
    const categoryMap = {};

    transactions.forEach(tx => {
      const categoryName = tx.category_name || 'Kategori Belirtilmemiş';
      const { revenue, expense } = this.calculateAmounts(tx);

      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = {
          rapor_bölümü: 'KATEGORİYE GÖRE KAR DETAYI',
          kategori_adi: categoryName,
          kategori_gelir: 0,
          kategori_gider: 0,
          islem_sayisi: 0
        };
      }

      categoryMap[categoryName].kategori_gelir += revenue;
      categoryMap[categoryName].kategori_gider += expense;
      categoryMap[categoryName].islem_sayisi += 1;
    });

    // Kar ve marj hesapla
    return Object.values(categoryMap).map(cat => {
      const profit = cat.kategori_gelir - cat.kategori_gider;
      const margin = cat.kategori_gelir > 0 ? 
        ((profit / cat.kategori_gelir) * 100) : 0;

      return {
        ...cat,
        kategori_kar: profit,
        kategori_kar_marji: Math.round(margin * 100) / 100
      };
    }).sort((a, b) => b.kategori_kar - a.kategori_kar);
  },

  // Basit kategori breakdown (transactions.js için)
  calculateSimpleCategoryBreakdown(transactions, totalRevenue) {
    const categoryMap = {};

    transactions.forEach(tx => {
      const categoryName = tx.category_name || 'Kategori Belirtilmemiş';
      const { revenue, expense } = this.calculateAmounts(tx);

      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = {
          category: categoryName,
          revenue: 0,
          expense: 0,
          profit: 0,
          profitMargin: 0,
          percentage: '0.00'
        };
      }

      categoryMap[categoryName].revenue += revenue;
      categoryMap[categoryName].expense += expense;
    });

    // Kar ve marj hesapla
    return Object.values(categoryMap).map(cat => {
      cat.profit = cat.revenue - cat.expense;
      cat.profitMargin = cat.revenue > 0 ? ((cat.profit / cat.revenue) * 100) : 0;
      cat.percentage = totalRevenue > 0 ? ((cat.revenue / totalRevenue) * 100).toFixed(2) : '0.00';
      return cat;
    });
  },

  // Araç bazında kar analizi
  calculateVehicleAnalysis(transactions) {
    const vehicleMap = {};

    transactions.forEach(tx => {
      const vehiclePlate = tx.vehicle_plate || 'Araç Belirtilmemiş';
      const { revenue, expense } = this.calculateAmounts(tx);

      if (!vehicleMap[vehiclePlate]) {
        vehicleMap[vehiclePlate] = {
          rapor_bölümü: 'ARACA GÖRE KAR DETAYI',
          arac_plaka: vehiclePlate,
          arac_bilgisi: vehiclePlate === 'Araç Belirtilmemiş' ? 'Bilinmeyen Araç' : vehiclePlate,
          arac_gelir: 0,
          arac_gider: 0,
          islem_sayisi: 0
        };
      }

      vehicleMap[vehiclePlate].arac_gelir += revenue;
      vehicleMap[vehiclePlate].arac_gider += expense;
      vehicleMap[vehiclePlate].islem_sayisi += 1;
    });

    return Object.values(vehicleMap).map(vehicle => {
      const profit = vehicle.arac_gelir - vehicle.arac_gider;
      const margin = vehicle.arac_gelir > 0 ? 
        ((profit / vehicle.arac_gelir) * 100) : 0;

      return {
        ...vehicle,
        arac_kar: profit,
        arac_kar_marji: Math.round(margin * 100) / 100
      };
    }).sort((a, b) => b.arac_kar - a.arac_kar);
  },

  // Basit araç breakdown (transactions.js için)
  calculateSimpleVehicleBreakdown(transactions, totalRevenue) {
    const vehicleMap = {};

    transactions.forEach(tx => {
      const vehiclePlate = tx.vehicle_plate || 'Araç Belirtilmemiş';
      const { revenue, expense } = this.calculateAmounts(tx);

      if (!vehicleMap[vehiclePlate]) {
        vehicleMap[vehiclePlate] = {
          vehicle: vehiclePlate,
          revenue: 0,
          expense: 0,
          profit: 0,
          profitMargin: 0,
          percentage: '0.00'
        };
      }

      vehicleMap[vehiclePlate].revenue += revenue;
      vehicleMap[vehiclePlate].expense += expense;
    });

    return Object.values(vehicleMap).map(vehicle => {
      vehicle.profit = vehicle.revenue - vehicle.expense;
      vehicle.profitMargin = vehicle.revenue > 0 ? ((vehicle.profit / vehicle.revenue) * 100) : 0;
      vehicle.percentage = totalRevenue > 0 ? ((vehicle.revenue / totalRevenue) * 100).toFixed(2) : '0.00';
      return vehicle;
    });
  },

  // Personel bazında kar analizi
  calculatePersonnelAnalysis(transactions) {
    const personnelMap = {};

    transactions.forEach(tx => {
      const personnelName = tx.personnel_name || 'Personel Belirtilmemiş';
      const { revenue, expense } = this.calculateAmounts(tx);

      if (!personnelMap[personnelName]) {
        personnelMap[personnelName] = {
          rapor_bölümü: 'PERSONELE GÖRE KAR DETAYI',
          personel_adi: personnelName,
          personel_gelir: 0,
          personel_gider: 0,
          islem_sayisi: 0,
          total_amount: 0
        };
      }

      personnelMap[personnelName].personel_gelir += revenue;
      personnelMap[personnelName].personel_gider += expense;
      personnelMap[personnelName].islem_sayisi += 1;
      personnelMap[personnelName].total_amount += (revenue || expense);
    });

    return Object.values(personnelMap).map(personnel => {
      const profit = personnel.personel_gelir - personnel.personel_gider;
      const margin = personnel.personel_gelir > 0 ? 
        ((profit / personnel.personel_gelir) * 100) : 0;
      const averageTransaction = personnel.islem_sayisi > 0 ? 
        (personnel.total_amount / personnel.islem_sayisi) : 0;

      return {
        rapor_bölümü: personnel.rapor_bölümü,
        personel_adi: personnel.personel_adi,
        personel_gelir: personnel.personel_gelir,
        personel_gider: personnel.personel_gider,
        personel_kar: profit,
        personel_kar_marji: Math.round(margin * 100) / 100,
        islem_sayisi: personnel.islem_sayisi,
        ortalama_islem_tutari: Math.round(averageTransaction * 100) / 100
      };
    }).sort((a, b) => b.personel_kar - a.personel_kar);
  },

  // Basit personel breakdown (transactions.js için)
  calculateSimplePersonnelBreakdown(transactions, totalRevenue) {
    const personnelMap = {};

    transactions.forEach(tx => {
      const personnelName = tx.personnel_name || 'Personel Belirtilmemiş';
      const { revenue, expense } = this.calculateAmounts(tx);

      if (!personnelMap[personnelName]) {
        personnelMap[personnelName] = {
          personnel: personnelName,
          revenue: 0,
          expense: 0,
          profit: 0,
          profitMargin: 0,
          percentage: '0.00'
        };
      }

      personnelMap[personnelName].revenue += revenue;
      personnelMap[personnelName].expense += expense;
    });

    return Object.values(personnelMap).map(personnel => {
      personnel.profit = personnel.revenue - personnel.expense;
      personnel.profitMargin = personnel.revenue > 0 ? ((personnel.profit / personnel.revenue) * 100) : 0;
      personnel.percentage = totalRevenue > 0 ? ((personnel.revenue / totalRevenue) * 100).toFixed(2) : '0.00';
      return personnel;
    });
  },

  // Günlük trend analizi
  calculateDailyTrend(transactions) {
    const dailyMap = {};

    transactions.forEach(tx => {
      const date = tx.transaction_date.toISOString().split('T')[0];
      const { revenue, expense } = this.calculateAmounts(tx);

      if (!dailyMap[date]) {
        const dateObj = new Date(date);
        const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
        
        dailyMap[date] = {
          rapor_bölümü: 'GÜNLÜK KAR TRENDİ',
          tarih: date,
          gun_adi: dayNames[dateObj.getDay()],
          gunluk_gelir: 0,
          gunluk_gider: 0,
          gunluk_islem_sayisi: 0
        };
      }

      dailyMap[date].gunluk_gelir += revenue;
      dailyMap[date].gunluk_gider += expense;
      dailyMap[date].gunluk_islem_sayisi += 1;
    });

    return Object.values(dailyMap).map(day => ({
      ...day,
      gunluk_kar: day.gunluk_gelir - day.gunluk_gider
    })).sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
  },

  // En karlı işlemler
  calculateTopProfitableTransactions(transactions) {
    return transactions.map(tx => {
      const { revenue, expense } = this.calculateAmounts(tx);
      const netEffect = revenue - expense;

      return {
        rapor_bölümü: 'EN KARLI İŞLEMLER',
        islem_id: tx.id,
        tarih: tx.transaction_date.toISOString().split('T')[0],
        arac_plaka: tx.vehicle_plate || 'N/A',
        personel: tx.personnel_name || 'N/A',
        kategori: tx.category_name || 'N/A',
        aciklama: tx.description,
        gelir: revenue,
        gider: expense,
        net_etki: netEffect,
        odeme_yontemi: tx.payment_method || 'N/A',
        durum: tx.status
      };
    })
    .sort((a, b) => b.net_etki - a.net_etki)
    .slice(0, 20);
  },

  // Genel istatistikler
  calculateGeneralStats(transactions) {
    let revenueTransactions = 0;
    let expenseTransactions = 0;
    let maxRevenue = 0;
    let maxExpense = 0;
    let totalRevenue = 0;
    let totalExpense = 0;
    let revenueCount = 0;
    let expenseCount = 0;
    
    const uniqueVehicles = new Set();
    const uniquePersonnel = new Set();
    const uniqueCategories = new Set();

    transactions.forEach(tx => {
      const { revenue, expense } = this.calculateAmounts(tx);

      if (revenue > 0) {
        revenueTransactions++;
        totalRevenue += revenue;
        revenueCount++;
        maxRevenue = Math.max(maxRevenue, revenue);
      }

      if (expense > 0) {
        expenseTransactions++;
        totalExpense += expense;
        expenseCount++;
        maxExpense = Math.max(maxExpense, expense);
      }

      if (tx.vehicle_id) uniqueVehicles.add(tx.vehicle_id);
      if (tx.personnel_id) uniquePersonnel.add(tx.personnel_id);
      if (tx.category_id) uniqueCategories.add(tx.category_id);
    });

    return {
      rapor_bölümü: 'GENEL İSTATİSTİKLER',
      gelir_islem_sayisi: revenueTransactions,
      gider_islem_sayisi: expenseTransactions,
      max_gelir_islem: maxRevenue,
      max_gider_islem: maxExpense,
      ort_gelir_islem: revenueCount > 0 ? Math.round((totalRevenue / revenueCount) * 100) / 100 : 0,
      ort_gider_islem: expenseCount > 0 ? Math.round((totalExpense / expenseCount) * 100) / 100 : 0,
      aktif_arac_sayisi: uniqueVehicles.size,
      aktif_personel_sayisi: uniquePersonnel.size,
      kullanilan_kategori_sayisi: uniqueCategories.size
    };
  },

  // Aylık dağılım hesaplama (yearly profit için)
  calculateMonthlyBreakdown(transactions) {
    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
                       'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    
    // Tüm ayları initialize et
    const monthlyData = {};
    for (let i = 1; i <= 12; i++) {
      monthlyData[i] = {
        month: i,
        monthName: monthNames[i - 1],
        revenue: 0,
        expense: 0,
        profit: 0,
        profitMargin: 0,
        transactionCount: 0
      };
    }

    // Transactions'ları aylara göre grupla
    transactions.forEach(tx => {
      // Month bilgisini tx.month'dan al, yoksa transaction_date'den çıkar
      let month;
      if (tx.month) {
        month = tx.month;
      } else if (tx.transaction_date) {
        const date = new Date(tx.transaction_date);
        month = date.getMonth() + 1; // JavaScript month 0-based olduğu için +1
      } else {
        console.warn('Transaction has no month or transaction_date:', tx.id);
        return; // Bu transaction'ı atla
      }

      const { revenue, expense } = this.calculateAmounts(tx);

      if (monthlyData[month]) {
        monthlyData[month].revenue += revenue;
        monthlyData[month].expense += expense;
        monthlyData[month].transactionCount += 1;
      }
    });

    // Kar hesapla ve array'e dönüştür
    return Object.values(monthlyData).map(month => {
      month.profit = month.revenue - month.expense;
      month.profitMargin = month.revenue > 0 ? ((month.profit / month.revenue) * 100) : 0;
      return month;
    });
  }
};

module.exports = ProfitCalculator; 