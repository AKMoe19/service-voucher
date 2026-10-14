const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    logoUrl: { type: String, default: '' } // Logo ပုံ Image URL (သို့မဟုတ်) Base64 Data String
});

module.exports = mongoose.model('User', userSchema);