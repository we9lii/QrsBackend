const express = require('express');
const router = express.Router();
const db = require('../db.js');
const bcrypt = require('bcrypt');
const saltRounds = 10; // Define salt rounds for consistency

// POST /api/login
router.post('/login', async (req, res) => {
    const { employeeId, password } = req.body;

    if (!employeeId || !password) {
        return res.status(400).json({ message: 'Employee ID and password are required.' });
    }

    try {
        // 1. Find the user by username (which is the employeeId)
        const [userRows] = await db.query('SELECT * FROM users WHERE username = ?', [employeeId]);
        
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'Employee not found.' });
        }
        
        const user = userRows[0];

        // 2. Intelligent password check to handle both plain text (old) and hashed (new) passwords
        let isPasswordCorrect = false;

        // Check if the stored password from the DB looks like a bcrypt hash.
        if (user.password && (user.password.startsWith('$2a$') || user.password.startsWith('$2b$'))) {
            // If it is a hash, compare it securely.
            isPasswordCorrect = await bcrypt.compare(password, user.password);
        } else {
            // If it is not a hash, it's likely a plain-text password from before the update.
            // Compare it directly.
            isPasswordCorrect = (password === user.password);
            
            // IMPORTANT: If the plain-text password is correct, we upgrade it to a hash "on-the-fly".
            // This is a lazy migration strategy that secures users as they log in.
            if (isPasswordCorrect) {
                try {
                    const hashedNewPassword = await bcrypt.hash(password, saltRounds);
                    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, user.id]);
                    console.log(`Password for user ${user.username} has been migrated to a secure hash.`);
                } catch (hashError) {
                    console.error(`Failed to migrate password for user ${user.username}:`, hashError);
                    // We don't block the login, but we log the error. The user can still log in.
                }
            }
        }

        if (!isPasswordCorrect) {
            return res.status(401).json({ message: 'Incorrect password.' });
        }
        
        // 3. Get the branch name
        let branchName = 'N/A';
        if (user.branch_id) {
            const [branchRows] = await db.query('SELECT name FROM branches WHERE id = ?', [user.branch_id]);
            if (branchRows.length > 0) {
                branchName = branchRows[0].name;
            }
        }
        
        // 4. Construct the user object for the frontend
        // FIX: Ensure the role is capitalized ('Admin', 'Employee') to match frontend expectations.
        const role = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Employee';

        const userForFrontend = {
            id: user.id.toString(),
            employeeId: user.username || 'N/A',
            name: user.full_name || 'N/A',
            email: user.email || 'N/A',
            phone: user.phone || 'N/A',
            role: role, 
            branch: branchName,
            department: user.department || 'N/A',
            position: user.position || 'N/A',
            joinDate: user.created_at || new Date().toISOString(),
            employeeType: user.employee_type || 'Technician',
            hasImportExportPermission: !!user.has_import_export_permission,
            hasPackageManagementPermission: !!user.has_package_management_permission,
            isFirstLogin: !!user.is_first_login,
            allowedReportTypes: (() => { try { return JSON.parse(user.allowed_report_types || '[]'); } catch { return []; } })(),
        };

        res.json(userForFrontend);

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

module.exports = router;