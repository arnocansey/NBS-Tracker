const db = require('../db');

exports.getOccupancyByHospital = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        h.name,
        COUNT(b.bed_id)::int AS total_beds,
        COUNT(b.bed_id) FILTER (WHERE b.current_status = 'AVAILABLE')::int AS available_beds,
        COUNT(b.bed_id) FILTER (WHERE b.current_status = 'OCCUPIED')::int AS occupied_beds,
        COUNT(b.bed_id) FILTER (WHERE b.current_status = 'CLEANING')::int AS cleaning_beds,
        COALESCE(
          (
            100.0 * COUNT(b.bed_id) FILTER (WHERE b.current_status <> 'AVAILABLE')
          ) / NULLIF(COUNT(b.bed_id), 0)
        , 0) AS occupancy_percentage,
        MAX(b.updated_at) AS last_updated
      FROM hospitals h
      LEFT JOIN beds b ON h.id = b.hospital_id
      GROUP BY h.id
      ORDER BY h.name;
    `);

    res.json(rows);
  } catch (err) {
    console.error('Analytics controller error:', err.message);
    res.status(500).send('Server Error');
  }
};

exports.getOperationsSummary = async (req, res) => {
  try {
    const [beds, transfers, cleaning, history] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)::int AS total_beds,
          COUNT(*) FILTER (WHERE current_status = 'AVAILABLE')::int AS available_beds,
          COUNT(*) FILTER (WHERE current_status = 'OCCUPIED')::int AS occupied_beds,
          COUNT(*) FILTER (WHERE current_status = 'CLEANING')::int AS cleaning_beds
        FROM beds;
      `),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_transfers,
          COUNT(*) FILTER (WHERE priority = 'Emergency' AND status = 'PENDING')::int AS pending_emergencies,
          ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(decided_at, NOW()) - created_at)) / 60)) AS avg_decision_minutes
        FROM transfer_requests;
      `),
      db.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE current_status = 'CLEANING'
              AND cleaning_started_at <= NOW() - INTERVAL '30 minutes'
          )::int AS overdue_cleaning
        FROM beds;
      `),
      db.query(`
        SELECT
          action_type,
          COUNT(*)::int AS count
        FROM bed_history
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY action_type
        ORDER BY count DESC;
      `).catch(() => ({ rows: [] })),
    ]);

    res.json({
      beds: beds.rows[0],
      transfers: transfers.rows[0],
      cleaning: cleaning.rows[0],
      activity_last_24h: history.rows,
    });
  } catch (err) {
    console.error('Operations summary error:', err.message);
    res.status(500).send('Server Error');
  }
};
