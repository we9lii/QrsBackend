const db = require('./db.js');

async function ensureSchema() {
  try {
    // 1) Ensure users.allowed_report_types exists (no information_schema)
    const [allowedCol] = await db.query("SHOW COLUMNS FROM users LIKE 'allowed_report_types'");
    if (!allowedCol || allowedCol.length === 0) {
      await db.query("ALTER TABLE users ADD COLUMN allowed_report_types TEXT NULL");
      console.log(' Added column users.allowed_report_types');
    } else {
      console.log('? Column users.allowed_report_types already exists');
    }

    // 1.b) Ensure users.has_purchase_management_permission exists (no information_schema)
    const [purchasePermCol] = await db.query("SHOW COLUMNS FROM users LIKE 'has_purchase_management_permission'");
    if (!purchasePermCol || purchasePermCol.length === 0) {
      await db.query("ALTER TABLE users ADD COLUMN has_purchase_management_permission TINYINT(1) NOT NULL DEFAULT 0");
      console.log(' Added column users.has_purchase_management_permission');
    } else {
      console.log('? Column users.has_purchase_management_permission already exists');
    }

    // 2) Ensure package_requests table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS package_requests (
        id VARCHAR(32) PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255),
        description TEXT,
        customer_name VARCHAR(255),
        customer_phone VARCHAR(32),
        priority VARCHAR(16),
        status VARCHAR(32),
        progress_percent INT DEFAULT 0,
        customer_location VARCHAR(255),
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_modified DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX(user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table package_requests exists');

    // 3) Ensure package_attachments table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS package_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        package_id VARCHAR(32) NOT NULL,
        type VARCHAR(32) NOT NULL, -- payment_proof | shipping_doc
        url VARCHAR(1024) NOT NULL,
        file_name VARCHAR(255),
        uploaded_by INT,
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(package_id),
        INDEX(uploaded_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table package_attachments exists');

    // 4) Ensure package_logs table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS package_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        package_id VARCHAR(32) NOT NULL,
        action VARCHAR(64) NOT NULL,
        comment TEXT,
        actor_id INT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(package_id),
        INDEX(actor_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table package_logs exists');

    // 5) Ensure purchase_invoices table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id VARCHAR(32) PRIMARY KEY,
        invoice_number VARCHAR(64) NOT NULL,
        vendor VARCHAR(255),
        payee VARCHAR(255),
        buyer_name VARCHAR(255),
        custody_number VARCHAR(64),
        description TEXT,
        invoice_date DATE,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        transfer_fee DECIMAL(12,2),
        user_id INT,
        notes TEXT,
        review_status VARCHAR(32) DEFAULT 'NEEDS_REVIEW',
        hidden TINYINT(1) NOT NULL DEFAULT 0,
        hide_reason TEXT,
        hidden_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_modified DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX(user_id),
        INDEX(invoice_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table purchase_invoices exists');

    // 6) Ensure purchase_attachments table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS purchase_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_id VARCHAR(32) NOT NULL,
        type VARCHAR(32),
        url VARCHAR(1024),
        file_name VARCHAR(255),
        uploaded_by INT,
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(purchase_id),
        INDEX(uploaded_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table purchase_attachments exists');

    // 7) Ensure purchase_logs table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS purchase_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_id VARCHAR(32) NOT NULL,
        action VARCHAR(64) NOT NULL,
        comment TEXT,
        actor_id INT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(purchase_id),
        INDEX(actor_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    // 8) Ensure instant_expense_sheets table exists (Custody header for Instant Expenses)
    await db.query(`
      CREATE TABLE IF NOT EXISTS instant_expense_sheets (
        id VARCHAR(32) PRIMARY KEY,
        custody_number VARCHAR(128),
        custody_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        user_id INT,
        status VARCHAR(16) DEFAULT 'OPEN', -- OPEN | CLOSED
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_modified DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX(user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table instant_expense_sheets exists');

    // 9) Ensure instant_expense_lines table exists (Line items for Instant Expenses)
    await db.query(`
      CREATE TABLE IF NOT EXISTS instant_expense_lines (
        id VARCHAR(40) PRIMARY KEY,
        sheet_id VARCHAR(32) NOT NULL,
        date DATE,
        company VARCHAR(255),
        invoice_number VARCHAR(64),
        description TEXT,
        reason VARCHAR(64) NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        bank_fees DECIMAL(12,2),
        buyer_name VARCHAR(255),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(sheet_id),
        INDEX(reason),
        INDEX(date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table instant_expense_lines exists');
    // Ensure quotations table columns exist if table already present
    try {
      const [locCol] = await db.query("SHOW COLUMNS FROM quotations LIKE 'location'");
      if (!locCol || locCol.length === 0) {
        await db.query("ALTER TABLE quotations ADD COLUMN location VARCHAR(255) NULL AFTER customer_name");
        console.log(' Added column quotations.location');
      }
      const [mobileCol] = await db.query("SHOW COLUMNS FROM quotations LIKE 'mobile'");
      if (!mobileCol || mobileCol.length === 0) {
        await db.query("ALTER TABLE quotations ADD COLUMN mobile VARCHAR(32) NULL AFTER location");
        console.log(' Added column quotations.mobile');
      }
    } catch (e) {
      console.log(' Skipping quotations column check due to error:', e.message);
    }
    // 10) Ensure quotations table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS quotations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quote_number VARCHAR(64) NOT NULL,
        quote_date DATE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        mobile VARCHAR(32),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(quote_date),
        INDEX(created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table quotations exists');

    // 11) Ensure quotation_items table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS quotation_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quotation_id INT NOT NULL,
        category VARCHAR(64) NOT NULL,
        horsepower VARCHAR(64),
        capacity_kw DECIMAL(12,2),
        price_per_kw DECIMAL(12,2),
        total_before_tax DECIMAL(12,2),
        vat15 DECIMAL(12,2),
        total_with_tax DECIMAL(12,2),
        INDEX(quotation_id),
        CONSTRAINT fk_quotation_items_quotation
          FOREIGN KEY (quotation_id)
          REFERENCES quotations(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(' Ensured table quotation_items exists');
  } catch (err) {
    console.error(' Schema check/add failed:', err.message);
  }
}

module.exports = { ensureSchema };



