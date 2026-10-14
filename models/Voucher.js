const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema({
    voucherId: { type: String, required: true, unique: true },
    voucherName: { type: String, required: true }, // Login ဝင်ထားသော အကောင့်နာမည်
    customerName: { type: String, required: true },
    items: [
        {
            serviceItem: { type: String, required: true },
            price: { type: Number, required: true }
        }
    ],
    totalPrice: { type: Number, required: true },
    warrantyDays: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

module.exports = mongoose.model('Voucher', voucherSchema);