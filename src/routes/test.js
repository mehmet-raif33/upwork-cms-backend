const express = require('express');
const router = express.Router();

// Test endpoint to check if backend is working
router.get('/', (req, res) => {
  res.json({ 
    message: 'Backend is working!',
    timestamp: new Date().toISOString(),
    status: 'ok'
  });
});

// Test database connection
router.get('/db', async (req, res) => {
  try {
    const [result] = await req.app.locals.pool.promise().query('SELECT 1 as test');
    res.json({ 
      message: 'Database connection successful',
      result: result[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({ 
      message: 'Database connection failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Test transactions table
router.get('/transactions', async (req, res) => {
  try {
    // Check if table exists
    const [tables] = await req.app.locals.pool.promise().query('SHOW TABLES LIKE "transactions"');
    
    if (tables.length === 0) {
      return res.status(404).json({ 
        message: 'Transactions table does not exist',
        timestamp: new Date().toISOString()
      });
    }

    // Check table structure
    const [columns] = await req.app.locals.pool.promise().query('DESCRIBE transactions');
    
    // Count records
    const [countResult] = await req.app.locals.pool.promise().query('SELECT COUNT(*) as total FROM transactions');
    
    // Get sample data
    const [sampleData] = await req.app.locals.pool.promise().query('SELECT * FROM transactions LIMIT 3');
    
    res.json({ 
      message: 'Transactions table check successful',
      tableExists: true,
      columnCount: columns.length,
      totalRecords: countResult[0].total,
      columns: columns.map(col => col.Field),
      sampleData: sampleData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Transactions test error:', error);
    res.status(500).json({ 
      message: 'Transactions table check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router; 