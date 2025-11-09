const express = require('express');
const router = express.Router();
const db = require('../db.js');

// GET /api/branches
router.get('/branches', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM branches ORDER BY created_at DESC');
        const branches = rows.map(branch => ({
            id: branch.id.toString(),
            name: branch.name || 'N/A',
            location: branch.location || 'N/A',
            phone: branch.phone || 'N/A',
            manager: branch.manager_name || 'N/A',
            creationDate: branch.created_at ? new Date(branch.created_at).toISOString() : new Date().toISOString(),
        }));
        res.json(branches);
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching branches.' });
    }
});

// POST /api/branches - Create a new branch
router.post('/branches', async (req, res) => {
    const { name, location, phone, manager } = req.body;
    try {
        const newBranch = {
            name,
            location,
            phone,
            manager_name: manager
        };
        const [result] = await db.query('INSERT INTO branches SET ?', newBranch);
        const [rows] = await db.query('SELECT * FROM branches WHERE id = ?', [result.insertId]);
        const createdBranch = {
            id: rows[0].id.toString(),
            name: rows[0].name,
            location: rows[0].location,
            phone: rows[0].phone,
            manager: rows[0].manager_name,
            creationDate: new Date(rows[0].created_at).toISOString(),
        };
        res.status(201).json(createdBranch);
    } catch (error) {
        console.error('Error creating branch:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// PUT /api/branches/:id - Update a branch
router.put('/branches/:id', async (req, res) => {
    const { id } = req.params;
    const { name, location, phone, manager } = req.body;
    try {
        const updatedBranch = {
            name,
            location,
            phone,
            manager_name: manager
        };
        const [result] = await db.query('UPDATE branches SET ? WHERE id = ?', [updatedBranch, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Branch not found.' });
        }
        const [rows] = await db.query('SELECT * FROM branches WHERE id = ?', [id]);
        const branchForFrontend = {
            id: rows[0].id.toString(),
            name: rows[0].name,
            location: rows[0].location,
            phone: rows[0].phone,
            manager: rows[0].manager_name,
            creationDate: new Date(rows[0].created_at).toISOString(),
        };
        res.json(branchForFrontend);
    } catch (error) {
        console.error('Error updating branch:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// DELETE /api/branches/:id - Delete a branch
router.delete('/branches/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM branches WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Branch not found.' });
        }
        res.status(200).json({ message: 'Branch deleted successfully.' });
    } catch (error) {
        console.error('Error deleting branch:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});


module.exports = router;