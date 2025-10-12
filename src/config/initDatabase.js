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
      VALUES ('Admin User', 'admin', 'admin@servis.com', ?, 'admin', true)
      ON DUPLICATE KEY UPDATE username = username
    `, [passwordHash]);
    
    // Test çalışan kullanıcısı
    const employeeHash = await bcrypt.hash('calisan123', 12);
    
    await pool.promise().query(`
      INSERT INTO personnel (full_name, username, email, password_hash, role, is_active) 
      VALUES ('Çalışan User', 'calisan1', 'calisan1@servis.com', ?, 'employee', true)
      ON DUPLICATE KEY UPDATE username = username
    `, [employeeHash]);
    
    console.log('✅ Test verisi eklendi!');
    console.log('Admin kullanıcısı: admin / admin123');
    console.log('Çalışan kullanıcısı: calisan1 / calisan123');
    
  } catch (error) {
    console.error('Test verisi ekleme hatası:', error.message);
  }
}

// Script'i çalıştır
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase }; 