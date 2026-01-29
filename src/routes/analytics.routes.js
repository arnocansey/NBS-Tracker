// backend/src/routes/analytics.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const analyticsController = require('../controllers/analytics.controller');

// @route   GET /api/analytics/occupancy-by-hospital
// @desc    Get current occupancy percentage for all hospitals
// @access  Private
router.get(
    '/occupancy-by-hospital', 
    authMiddleware, 
    analyticsController.getOccupancyByHospital
);

module.exports = router;
