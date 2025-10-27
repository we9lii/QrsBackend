const express = require('express');
const router = express.Router();
const db = require('../db.js');
const bcrypt = require('bcrypt');
const saltRounds = 10; // Standard salt rounds for bcrypt

// GET /api/users
router.get('/users', async (req, res) => {
    try {
        const [userRows] = await db.query('SELECT u.*, b.name as branch_name FROM users u LEFT JOIN branches b ON u.branch_id = b.id ORDER BY u.created_at DESC');

        const users = userRows.map(user => ({
            id: user.id.toString(),
            employeeId: user.username || 'N/A',
            name: user.full_name || 'N/A',
            email: user.email || 'N/A',
            phone: user.phone || 'N/A',
            role: user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Employee',
            branch: user.branch_name || 'N/A',
            department: user.department || 'N/A',
            position: user.position || 'N/A',
            joinDate: user.created_at ? new Date(user.created_at).toISOString() : new Date().toISOString(),
            employeeType: user.employee_type || 'Technician',
            hasImportExportPermission: !!user.has_import_export_permission,
            hasPackageManagementPermission: !!user.has_package_management_permission,
            isFirstLogin: !!user.is_first_login,
            allowedReportTypes: (() => { try { return JSON.parse(user.allowed_report_types || '[]'); } catch { return []; } })(),
        }));

        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'An internal server error occurred while fetching users.' });
    }
});

// POST /api/users - Create a new user
router.post('/users', async (req, res) => {
    const { employeeId, password, email, name, phone, role, branch, department, position, employeeType, hasImportExportPermission, hasPackageManagementPermission, allowedReportTypes } = req.body;

    try {
        let branchId = null;
        if (branch) {
            const [branchRows] = await db.query('SELECT id FROM branches WHERE name = ?', [branch]);
            if (branchRows.length > 0) {
                branchId = branchRows[0].id;
            } else {
                return res.status(400).json({ message: `Branch '${branch}' not found.`});
            }
        }
        
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        const newUser = {
            username: employeeId,
            password: hashedPassword,
            email: email,
            full_name: name,
            phone: phone,
            role: role.toLowerCase(), // Store role in lowercase
            branch_id: branchId,
            department: department,
            position: position,
            employee_type: employeeType,
            has_import_export_permission: hasImportExportPermission ? 1 : 0,
            has_package_management_permission: hasPackageManagementPermission ? 1 : 0,
            is_first_login: 1, // New users should complete their profile
            is_active: 1,
            allowed_report_types: Array.isArray(allowedReportTypes) ? JSON.stringify(allowedReportTypes) : null,
        };

        const [result] = await db.query('INSERT INTO users SET ?', newUser);
        const insertId = result.insertId;

        const [userRows] = await db.query('SELECT u.*, b.name as branch_name FROM users u LEFT JOIN branches b ON u.branch_id = b.id WHERE u.id = ?', [insertId]);
        
        const user = userRows[0];
        const userForFrontend = {
            id: user.id.toString(),
            employeeId: user.username,
            name: user.full_name,
            email: user.email,
            phone: user.phone,
            role: user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Employee',
            branch: user.branch_name || 'N/A',
            department: user.department || 'N/A',
            position: user.position || 'N/A',
            joinDate: new Date(user.created_at).toISOString(),
            employeeType: user.employee_type,
            hasImportExportPermission: !!user.has_import_export_permission,
            hasPackageManagementPermission: !!user.has_package_management_permission,
            isFirstLogin: !!user.is_first_login,
            allowedReportTypes: (() => { try { return JSON.parse(user.allowed_report_types || '[]'); } catch { return []; } })(),
        };

        res.status(201).json(userForFrontend);
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});


// PUT /api/users/:id - Update an existing user
router.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { employeeId, email, name, phone, role, branch, department, position, employeeType, hasImportExportPermission, hasPackageManagementPermission, allowedReportTypes } = req.body;

    // Helper to map frontend role to DB value
    const mapRoleToDb = (roleStr) => {
      const v = (roleStr || '').toLowerCase().trim();
      switch (v) {
        case 'admin': return 'admin';
        case 'employee': return 'employee';
        case 'teamlead':
        case 'team_lead': return 'team_lead';
        case 'branchmanager':
        case 'branch_manager': return 'branch_manager';
        case 'hr manager':
        case 'hr_manager':
        case 'hrmanager': return 'hr_manager';
        default: return v;
      }
    };

    // Helper to map DB role to frontend enum
    const mapRoleForFrontend = (dbRole) => {
      switch (dbRole) {
        case 'admin': return 'Admin';
        case 'employee': return 'Employee';
        case 'team_lead': return 'TeamLead';
        case 'branch_manager': return 'Branch Manager';
        case 'hr_manager': return 'HR Manager';
        default:
          return (dbRole || 'Employee').charAt(0).toUpperCase() + (dbRole || 'Employee').slice(1);
      }
    };

    try {
        console.log('PUT /api/users/:id payload:', req.body);

        // Build partial updates only for provided fields
        const updates = {};
        if (employeeId !== undefined) updates.username = employeeId;
        if (email !== undefined) updates.email = email;
        if (name !== undefined) updates.full_name = name;
        if (phone !== undefined) updates.phone = phone;
        if (department !== undefined) updates.department = department;
        if (position !== undefined) updates.position = position;
        if (employeeType !== undefined) updates.employee_type = employeeType;
        if (hasImportExportPermission !== undefined) updates.has_import_export_permission = hasImportExportPermission ? 1 : 0;
        if (hasPackageManagementPermission !== undefined) updates.has_package_management_permission = hasPackageManagementPermission ? 1 : 0;
        if (allowedReportTypes !== undefined) updates.allowed_report_types = Array.isArray(allowedReportTypes) ? JSON.stringify(allowedReportTypes) : null;
        if (role !== undefined) updates.role = mapRoleToDb(role);

        // Branch handling only if provided
        if (branch !== undefined) {
          const normalizedBranch = (!branch || branch === 'N/A' || branch === 'غير محدد') ? null : branch;
          if (normalizedBranch === null) {
            updates.branch_id = null;
          } else {
            const [branchRows] = await db.query('SELECT id FROM branches WHERE name = ?', [normalizedBranch]);
            if (branchRows.length > 0) {
              updates.branch_id = branchRows[0].id;
            } else {
              return res.status(400).json({ message: `Branch '${normalizedBranch}' not found.`});
            }
          }
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ message: 'No fields provided to update.' });
        }

        console.log('PUT /api/users/:id normalized partial SET:', updates);

        const [result] = await db.query('UPDATE users SET ? WHERE id = ?', [updates, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        
        const [userRows] = await db.query('SELECT u.*, b.name as branch_name FROM users u LEFT JOIN branches b ON u.branch_id = b.id WHERE u.id = ?', [id]);
        const user = userRows[0];
        const userForFrontend = {
            id: user.id.toString(),
            employeeId: user.username,
            name: user.full_name,
            email: user.email,
            phone: user.phone,
            role: user.role ? mapRoleForFrontend(user.role) : 'Employee',
            branch: user.branch_name || 'N/A',
            department: user.department || 'N/A',
            position: user.position || 'N/A',
            joinDate: new Date(user.created_at).toISOString(),
            employeeType: user.employee_type,
            hasImportExportPermission: !!user.has_import_export_permission,
            hasPackageManagementPermission: !!user.has_package_management_permission,
            isFirstLogin: !!user.is_first_login,
            allowedReportTypes: (() => { try { return JSON.parse(user.allowed_report_types || '[]'); } catch { return []; } })(),
        };

        res.json(userForFrontend);
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});


// DELETE /api/users/:id - Delete a user
router.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM users WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.status(200).json({ message: 'User deleted successfully.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});


// PUT /api/users/profile - Update user profile on first login
router.put('/users/profile', async (req, res) => {
    const { userId, name, phone, password } = req.body;

    if (!userId || !name || !phone || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        const [result] = await db.query(
            'UPDATE users SET full_name = ?, phone = ?, password = ?, is_first_login = 0 WHERE id = ?',
            [name, phone, hashedPassword, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.json({ message: 'Profile updated successfully.' });

    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// PUT /api/users/change-password - Change a user's password
router.put('/users/change-password', async (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;
    
    if (!userId || !currentPassword || !newPassword) {
        return res.status(400).json({ message: 'All password fields are required.' });
    }

    try {
        // 1. Find the user
        const [userRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) {
            return res.status(404).json({ message: 'المستخدم غير موجود.' });
        }
        const user = userRows[0];

        // 2. Check current password with bcrypt
        const isCurrentPasswordCorrect = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordCorrect) {
            return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة.' });
        }

        // 3. Hash and update to the new password
        const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
        const [result] = await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, userId]);
        
        if (result.affectedRows === 0) {
             return res.status(500).json({ message: 'فشل تحديث كلمة المرور.' });
        }
        
        res.status(200).json({ message: 'تم تغيير كلمة المرور بنجاح.' });

    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم.' });
    }
});


module.exports = router;