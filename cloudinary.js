// cloudinary.js
require('dotenv').config();
const cloudinary = require('cloudinary').v2;

// تهيئة Cloudinary باستخدام متغيرات البيئة
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // يستخدم روابط HTTPS
});

// تصدير العميل لاستخدامه في بقية التطبيق
module.exports = { cloudinary };