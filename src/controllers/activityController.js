const Activity = require('../models/activityModel');

exports.getRecentActivities = async (req, res) => {
  try {
    const activities = await Activity.getRecent(20);
    res.json({
      success: true,
      data: activities
    });
  } catch (err) {
    console.error('Activities error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Etkinlikler alınamadı.',
      error: err.message 
    });
  }
};

exports.getPersonnelActivities = async (req, res) => {
  try {
    const { personnelId } = req.params;
    const { limit = 20 } = req.query;
    
    const activities = await Activity.getByPersonnelId(personnelId, parseInt(limit));
    res.json({
      success: true,
      data: activities
    });
  } catch (err) {
    console.error('Personnel activities error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Personel etkinlikleri alınamadı.',
      error: err.message 
    });
  }
}; 