const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function initDatabase() {
  try {
    console.log('Veritabanı tabloları oluşturuluyor...');
    
    // SQL dosyasını oku
    const sqlPath = path.join(__dirname, 'database.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // SQL komutlarını böl (; ile ayrılmış)
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    // Her komutu çalıştır
    for (const statement of statements) {
      if (statement.trim()) {
        await pool.promise().query(statement);
        console.log('✓ SQL komutu çalıştırıldı');
      }
    }
    
    console.log('✅ Veritabanı tabloları başarıyla oluşturuldu!');
    
    // Test verisi ekle (opsiyonel)
    await addTestData();
    
  } catch (error) {
    console.error('❌ Veritabanı oluşturma hatası:', error.message);
  } finally {
    process.exit(0);
  }
}

async function addTestData() {
  try {
    console.log('Test verisi ekleniyor...');
    
    // Test admin kullanıcısı
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash('admin123', 12);
    
    await pool.promise().query(`
      INSERT INTO personnel (full_name, username, email, password_hash, role, is_active) 
      VALUES ('Manager User', 'manager', 'manager@servis.com', ?, 'manager', true)
      ON DUPLICATE KEY UPDATE username = username
    `, [passwordHash]);
    
    // Test personel kullanıcısı
    const personnelHash = await bcrypt.hash('personel123', 12);
    
    await pool.promise().query(`
      INSERT INTO personnel (full_name, username, email, password_hash, role, is_active) 
      VALUES ('Personnel User', 'personel1', 'personel1@servis.com', ?, 'personnel', true)
      ON DUPLICATE KEY UPDATE username = username
    `, [personnelHash]);
    
    console.log('✅ Test verisi eklendi!');
    console.log('Manager kullanıcısı: manager / admin123');
    console.log('Personnel kullanıcısı: personel1 / personel123');
    
  } catch (error) {
    console.error('Test verisi ekleme hatası:', error.message);
  }
}

// Script'i çalıştır
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase }; 