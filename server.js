require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Voucher = require('./models/Voucher');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas Successfully!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Middleware
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'service_voucher_secret_key',
    resave: false,
    saveUninitialized: false
}));

const isAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
};

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.render('login', { error: 'Invalid Username or Password' });
        }
        req.session.user = { id: user._id, username: user.username };
        res.redirect('/dashboard');
    } catch (err) {
        res.redirect('/login');
    }
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        res.redirect('/login');
    } catch (err) {
        res.render('register', { error: 'Username already exists.' });
    }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// Profile / Account Info Update Route
app.post('/update-account-info', isAuthenticated, async (req, res) => {
    try {
        const { phone, address, logoUrl } = req.body;
        await User.findByIdAndUpdate(req.session.user.id, {
            phone,
            address,
            logoUrl
        });
        
        // Session Data ကို Update ပြုလုပ်ခြင်း
        req.session.user.phone = phone;
        req.session.user.address = address;
        req.session.user.logoUrl = logoUrl;

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error updating account info:', err);
        res.status(500).send('Error updating profile');
    }
});

// Dashboard Route တွင် User Data အပြည့်အစုံ ဆွဲထုတ်ပေးခြင်း
app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.user.id);
        const searchQuery = req.query.search || '';
        let queryFilter = { userId: req.session.user.id };
        
        if (searchQuery) {
            queryFilter.voucherId = { $regex: searchQuery, $options: 'i' };
        }

        const vouchers = await Voucher.find(queryFilter).sort({ createdAt: -1 });
        res.render('dashboard', { user: currentUser, vouchers, searchQuery });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// app.get('/dashboard', isAuthenticated, async (req, res) => {
//     try {
//         const searchQuery = req.query.search || '';
//         let queryFilter = { userId: req.session.user.id };
        
//         if (searchQuery) {
//             queryFilter.voucherId = { $regex: searchQuery,$options: 'i' };
//         }

//         const vouchers = await Voucher.find(queryFilter).sort({ createdAt: -1 });
//         res.render('dashboard', { user: req.session.user, vouchers, searchQuery });
//     } catch (err) {
//         res.status(500).send('Server Error');
//     }
// });

// Socket.IO
io.on('connection', (socket) => {
    socket.on('createVoucher', async (data) => {
        try {
            const randomId = 'VOC-' + Math.floor(100000 + Math.random() * 900000);
            
            // Total Price တွက်ချက်ခြင်း
            let totalPrice = data.items.reduce((sum, item) => sum + Number(item.price), 0);

            const newVoucher = new Voucher({
                voucherId: randomId,
                voucherName: data.username,
                customerName: data.customerName,
                items: data.items,
                totalPrice: totalPrice,
                warrantyDays: Number(data.warrantyDays),
                userId: data.userId
            });

            await newVoucher.save();
            const updatedVouchers = await Voucher.find({ userId: data.userId }).sort({ createdAt: -1 });
            io.emit('voucherUpdated', { userId: data.userId, vouchers: updatedVouchers });
        } catch (err) {
            console.error('Error creating voucher:', err);
        }
    });

    socket.on('deleteVoucher', async (data) => {
        try {
            await Voucher.findByIdAndDelete(data.voucherId);
            const updatedVouchers = await Voucher.find({ userId: data.userId }).sort({ createdAt: -1 });
            io.emit('voucherUpdated', { userId: data.userId, vouchers: updatedVouchers });
        } catch (err) {
            console.error('Error deleting voucher:', err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
