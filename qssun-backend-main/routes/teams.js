const express = require('express');
const router = express.Router();
const db = require('../db.js');

// Helper to safely parse JSON
const safeJsonParse = (jsonString, defaultValue = []) => {
    if (!jsonString) return defaultValue;
    try {
        const parsed = JSON.parse(jsonString);
        return Array.isArray(parsed) ? parsed : defaultValue;
    } catch (e) {
        return defaultValue;
    }
};

// GET /api/teams - Fetch all technical teams
router.get('/teams', async (req, res) => {
    try {
        const query = `
            SELECT t.id, t.name, t.leader_id, t.members, t.created_at, u.full_name as leader_name
            FROM technical_teams t
            LEFT JOIN users u ON t.leader_id = u.id
            ORDER BY t.created_at DESC
        `;
        const [rows] = await db.query(query);

        const teams = rows.map(row => ({
            id: row.id.toString(),
            name: row.name,
            leaderId: row.leader_id.toString(),
            leaderName: row.leader_name,
            members: safeJsonParse(row.members),
            creationDate: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        }));
        res.json(teams);
    } catch (error) {
        console.error('Error fetching technical teams:', error);
        res.status(500).json({ message: 'Error fetching technical teams.' });
    }
});

// POST /api/teams - Create a new technical team
router.post('/teams', async (req, res) => {
    const { name, leaderId, members } = req.body;
    try {
        const newTeam = {
            name,
            leader_id: leaderId,
            members: JSON.stringify(members || []),
        };
        const [result] = await db.query('INSERT INTO technical_teams SET ?', newTeam);
        const [rows] = await db.query(
            `SELECT t.id, t.name, t.leader_id, t.members, t.created_at, u.full_name as leader_name
             FROM technical_teams t
             LEFT JOIN users u ON t.leader_id = u.id
             WHERE t.id = ?`, [result.insertId]
        );
        const row = rows[0];
        const createdTeam = {
            id: row.id.toString(),
            name: row.name,
            leaderId: row.leader_id.toString(),
            leaderName: row.leader_name,
            members: safeJsonParse(row.members),
            creationDate: new Date(row.created_at).toISOString(),
        };
        res.status(201).json(createdTeam);
    } catch (error) {
        console.error('Error creating technical team:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// PUT /api/teams/:id - Update a technical team
router.put('/teams/:id', async (req, res) => {
    const { id } = req.params;
    const { name, leaderId, members } = req.body;
    try {
        const updatedTeam = {
            name,
            leader_id: leaderId,
            members: JSON.stringify(members || []),
        };
        const [result] = await db.query('UPDATE technical_teams SET ? WHERE id = ?', [updatedTeam, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        
        const [rows] = await db.query(
             `SELECT t.id, t.name, t.leader_id, t.members, t.created_at, u.full_name as leader_name
             FROM technical_teams t
             LEFT JOIN users u ON t.leader_id = u.id
             WHERE t.id = ?`, [id]
        );
        const row = rows[0];
        const teamForFrontend = {
            id: row.id.toString(),
            name: row.name,
            leaderId: row.leader_id.toString(),
            leaderName: row.leader_name,
            members: safeJsonParse(row.members),
            creationDate: new Date(row.created_at).toISOString(),
        };
        res.json(teamForFrontend);
    } catch (error) {
        console.error('Error updating technical team:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// DELETE /api/teams/:id - Delete a technical team
router.delete('/teams/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM technical_teams WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        res.status(200).json({ message: 'Team deleted successfully.' });
    } catch (error) {
        console.error('Error deleting technical team:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

module.exports = router;
