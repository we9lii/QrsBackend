const express = require('express');
const router = express.Router();
const db = require('../db.js');
const multer = require('multer');
const { cloudinary } = require('../cloudinary.js');
const streamifier = require('streamifier');

// Setup multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Security Middleware to check for Import/Export permission
const checkImportExportPermission = async (req, res, next) => {
    try {
        let employeeId;
        
        // Extract employeeId based on the request type (POST or PUT with multipart/form-data)
        if (req.body.reportData) { // From a regular report update
             const reportData = JSON.parse(req.body.reportData);
             employeeId = reportData.employeeId;
        } else if (req.body.requestData) { // From a workflow update
             const requestData = JSON.parse(req.body.requestData);
             employeeId = requestData.employeeId;
        } else { // From a workflow creation or DELETE
            employeeId = req.body.employeeId;
        }

        if (!employeeId) {
            return res.status(401).json({ message: 'Unauthorized: User ID is missing.' });
        }

        const [userRows] = await db.query('SELECT role, has_import_export_permission FROM users WHERE username = ?', [employeeId]);

        if (userRows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const user = userRows[0];
        
        // Allow access if the user is an Admin or has the specific permission
        if (user.role === 'admin' || user.has_import_export_permission) {
            next();
        } else {
            return res.status(403).json({ message: 'Access Denied: You do not have permission for this operation.' });
        }
    } catch (error) {
        console.error('Permission check error:', error);
        res.status(500).json({ message: 'An internal server error occurred during permission check.' });
    }
};


// Helper to upload a file to Cloudinary
const uploadFileToCloudinary = (file, employeeId) => {
    return new Promise((resolve, reject) => {
        const publicId = file.originalname.split('.').slice(0, -1).join('.').trim();
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `qssun_reports/workflows/${employeeId}`,
                public_id: publicId,
                resource_type: 'auto'
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                if (result) {
                    resolve({ url: result.secure_url, fileName: file.originalname });
                } else {
                    reject(new Error("Cloudinary upload failed without an error object."));
                }
            }
        );
        streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
};

// Helper to safely parse JSON - CORRECTED VERSION
const safeJsonParse = (data, defaultValue) => {
    // If it's already a parsed object/array (from DB driver), return it directly.
    if (typeof data === 'object' && data !== null) {
        return data;
    }
    // If it's a string, try to parse it.
    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        } catch (e) {
            console.error("Failed to parse JSON string:", e);
            return defaultValue;
        }
    }
    // For all other types (null, undefined, etc.), return the default.
    return defaultValue;
};

// GET /api/workflow-requests
router.get('/workflow-requests', async (req, res) => {
    try {
        const query = `
            SELECT w.*, u.username as employee_id_username
            FROM workflow_requests w
            LEFT JOIN users u ON w.user_id = u.id
            ORDER BY w.creation_date DESC
        `;
        const [rows] = await db.query(query);

        const requests = rows.map(req => ({
            id: req.id,
            title: req.title || 'N/A',
            description: req.description || '',
            type: req.type || 'استيراد',
            priority: req.priority || 'منخفضة',
            currentStageId: req.current_stage_id || 1,
            creationDate: req.creation_date ? new Date(req.creation_date).toISOString() : new Date().toISOString(),
            lastModified: req.last_modified ? new Date(req.last_modified).toISOString() : new Date().toISOString(),
            stageHistory: safeJsonParse(req.stage_history, []),
            employeeId: req.employee_id_username,
            containerCount20ft: req.container_count_20ft,
            containerCount40ft: req.container_count_40ft,
            expectedDepartureDate: req.expected_departure_date,
            departurePort: req.departure_port,
        }));
        res.json(requests);
    } catch (error) {
        console.error('Error fetching workflow requests:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// POST /api/workflow-requests - Create a new request
router.post('/workflow-requests', checkImportExportPermission, async (req, res) => {
    const { title, description, type, priority, employeeId, stageHistory } = req.body;
    try {
        const [userRows] = await db.query('SELECT id FROM users WHERE username = ?', [employeeId]);
        if (userRows.length === 0) return res.status(404).json({ message: 'User not found.' });
        
        const userId = userRows[0].id;

        const newRequest = {
            id: `REQ-${Date.now().toString().slice(-4)}`,
            user_id: userId,
            title, description, type, priority,
            current_stage_id: 1,
            stage_history: JSON.stringify(stageHistory),
        };

        await db.query('INSERT INTO workflow_requests SET ?', newRequest);
        
        const [rows] = await db.query(`SELECT w.*, u.username as employee_id_username FROM workflow_requests w LEFT JOIN users u ON w.user_id = u.id WHERE w.id = ?`, [newRequest.id]);
        
        const row = rows[0];
        const requestForFrontend = {
            id: row.id,
            title: row.title,
            description: row.description,
            type: row.type,
            priority: row.priority,
            currentStageId: row.current_stage_id,
            creationDate: new Date(row.creation_date).toISOString(),
            lastModified: new Date(row.last_modified).toISOString(),
            stageHistory: safeJsonParse(row.stage_history, []),
            employeeId: row.employee_id_username,
        };
        res.status(201).json(requestForFrontend);

    } catch (error) {
        console.error('Error creating workflow request:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// PUT /api/workflow-requests/:id - Update an existing request
router.put('/workflow-requests/:id', upload.any(), checkImportExportPermission, async (req, res) => {
    const { id } = req.params;
    try {
        if (!req.body.requestData) return res.status(400).json({ message: 'requestData is missing.' });
        
        const requestData = JSON.parse(req.body.requestData);
        const employeeId = requestData.employeeId; 

        if (!employeeId) return res.status(400).json({ message: 'Employee ID is missing.' });

        if (req.files && req.files.length > 0) {
            const lastHistoryItem = requestData.stageHistory[requestData.stageHistory.length - 1];
            
            for (const file of req.files) {
                 const nameParts = file.originalname.split('___');
                if (nameParts.length !== 3) {
                    console.warn(`Skipping file with invalid name format: ${file.originalname}`);
                    continue;
                }
                const [docId, docType, originalName] = nameParts;
                const uploadedFile = await uploadFileToCloudinary({ ...file, originalname: originalName }, employeeId);
                
                const document = {
                    id: docId,
                    type: docType,
                    uploadDate: new Date().toISOString(),
                    ...uploadedFile
                };
                
                if (lastHistoryItem) {
                    if (!lastHistoryItem.documents) lastHistoryItem.documents = [];
                    lastHistoryItem.documents.push(document);
                }
            }
        }
        
        const dbPayload = {
            current_stage_id: requestData.currentStageId,
            stage_history: JSON.stringify(requestData.stageHistory),
            last_modified: new Date(),
        };

        // Conditionally add new fields only if they exist in the request payload.
        // This prevents errors when moving from stages that don't have these fields.
        if (requestData.hasOwnProperty('containerCount20ft')) {
            dbPayload.container_count_20ft = requestData.containerCount20ft ?? null;
        }
        if (requestData.hasOwnProperty('containerCount40ft')) {
            dbPayload.container_count_40ft = requestData.containerCount40ft ?? null;
        }
        if (requestData.hasOwnProperty('expectedDepartureDate')) {
            dbPayload.expected_departure_date = requestData.expectedDepartureDate || null;
        }
        if (requestData.hasOwnProperty('departurePort')) {
            dbPayload.departure_port = requestData.departurePort || null;
        }


        const [result] = await db.query('UPDATE workflow_requests SET ? WHERE id = ?', [dbPayload, id]);

        if (result.affectedRows === 0) return res.status(404).json({ message: 'Workflow request not found.'});
        
        const [rows] = await db.query(`SELECT w.*, u.username as employee_id_username FROM workflow_requests w LEFT JOIN users u ON w.user_id = u.id WHERE w.id = ?`, [id]);
        
        const row = rows[0];
        const updatedRequest = {
            id: row.id,
            title: row.title || 'N/A',
            description: row.description || '',
            type: row.type || 'استيراد',
            priority: row.priority || 'منخفضة',
            currentStageId: row.current_stage_id || 1,
            creationDate: new Date(row.creation_date).toISOString(),
            lastModified: new Date(row.last_modified).toISOString(),
            stageHistory: safeJsonParse(row.stage_history, []),
            employeeId: row.employee_id_username,
            containerCount20ft: row.container_count_20ft,
            containerCount40ft: row.container_count_40ft,
            expectedDepartureDate: row.expected_departure_date,
            departurePort: row.departure_port,
        };
        res.json(updatedRequest);

    } catch (error) {
        console.error('Error updating workflow request:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// DELETE /api/workflow-requests/:id - Delete a request
router.delete('/workflow-requests/:id', checkImportExportPermission, async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM workflow_requests WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Request not found.' });
        }
        res.status(200).json({ message: 'Workflow request deleted successfully.' });
    } catch (error) {        
        console.error('Error deleting workflow request:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

module.exports = router;