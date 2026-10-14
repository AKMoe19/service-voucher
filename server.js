require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');

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
app.use(express.static('public')); // Static folder for uploaded images & files
app.use(session({
    secret: 'service_voucher_secret_key',
    resave: false,
    saveUninitialized: false
}));

// Multer Storage Configuration for Logo Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, 'logo-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const isAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
};

// Helper function to format Date in Myanmar Time (UTC+6:30) as "15-Oct-2026"
function formatMMDate(dateInput) {
    const d = new Date(dateInput);
    const mmTime = new Date(d.getTime() + (6.5 * 60 * 60 * 1000));
    
    const day = String(mmTime.getUTCDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[mmTime.getUTCMonth()];
    const year = mmTime.getUTCFullYear();
    
    return `${day}-${month}-${year}`;
}

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
        req.session.user = { 
            id: user._id, 
            username: user.username,
            phone: user.phone,
            address: user.address,
            logoUrl: user.logoUrl
        };
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

// Profile / Account Info Update Route with File Upload
app.post('/update-account-info', isAuthenticated, upload.single('logoFile'), async (req, res) => {
    try {
        const { phone, address } = req.body;
        const currentUser = await User.findById(req.session.user.id);
        
        let logoUrl = currentUser.logoUrl;
        if (req.file) {
            logoUrl = '/uploads/' + req.file.filename;
        }

        await User.findByIdAndUpdate(req.session.user.id, {
            phone,
            address,
            logoUrl
        });
        
        req.session.user.phone = phone;
        req.session.user.address = address;
        req.session.user.logoUrl = logoUrl;

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error updating account info:', err);
        res.status(500).send('Error updating profile');
    }
});

// Dashboard Route with MM Time Analytics
app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.user.id);
        const searchQuery = req.query.search || '';
        
        const nowMM = new Date(new Date().getTime() + (6.5 * 60 * 60 * 1000));
        const selectedYear = req.query.year ? Number(req.query.year) : nowMM.getUTCFullYear();
        
        let queryFilter = { userId: req.session.user.id };
        if (searchQuery) {
            queryFilter.voucherId = { $regex: searchQuery,$options: 'i' };
        }

        const rawVouchers = await Voucher.find(queryFilter).sort({ createdAt: -1 });
        const vouchers = rawVouchers.map(v => {
            const vObj = v.toObject();
            vObj.formattedDate = formatMMDate(v.createdAt);
            return vObj;
        });

        // --- Analytics Calculations in Myanmar Time ---
        const userAllVouchers = await Voucher.find({ userId: req.session.user.id });
        
        const yearsSet = new Set();
        userAllVouchers.forEach(v => {
            const vMM = new Date(new Date(v.createdAt).getTime() + (6.5 * 60 * 60 * 1000));
            yearsSet.add(vMM.getUTCFullYear());
        });
        let availableYears = Array.from(yearsSet).sort((a, b) => b - a);
        if (availableYears.length === 0) availableYears = [nowMM.getUTCFullYear()];

        let dailyTotal = 0;
        let weeklyTotal = 0;
        let monthlyTotal = 0;
        let yearlyTotal = 0;

        const todayMMStr = nowMM.toDateString();
        const oneWeekAgoMM = new Date(nowMM.getTime() - (7 * 24 * 60 * 60 * 1000));

        userAllVouchers.forEach(v => {
            const vMM = new Date(new Date(v.createdAt).getTime() + (6.5 * 60 * 60 * 1000));
            
            if (vMM.toDateString() === todayMMStr) {
                dailyTotal += v.totalPrice;
            }
            if (vMM >= oneWeekAgoMM && vMM <= nowMM) {
                weeklyTotal += v.totalPrice;
            }
            if (vMM.getUTCMonth() === nowMM.getUTCMonth() && vMM.getUTCFullYear() === nowMM.getUTCFullYear()) {
                monthlyTotal += v.totalPrice;
            }
            if (vMM.getUTCFullYear() === selectedYear) {
                yearlyTotal += v.totalPrice;
            }
        });

        const analytics = {
            dailyTotal,
            weeklyTotal,
            monthlyTotal,
            yearlyTotal,
            availableYears,
            selectedYear
        };

        res.render('dashboard', { user: currentUser, vouchers, searchQuery, analytics });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Socket.IO
io.on('connection', (socket) => {
    socket.on('createVoucher', async (data) => {
        try {
            const randomId = 'VOC-' + Math.floor(100000 + Math.random() * 900000);
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
            const rawVouchers = await Voucher.find({ userId: data.userId }).sort({ createdAt: -1 });
            const updatedVouchers = rawVouchers.map(v => {
                const vObj = v.toObject();
                vObj.formattedDate = formatMMDate(v.createdAt);
                return vObj;
            });

            io.emit('voucherUpdated', { userId: data.userId, vouchers: updatedVouchers });
        } catch (err) {
            console.error('Error creating voucher:', err);
        }
    });

    socket.on('deleteVoucher', async (data) => {
        try {
            await Voucher.findByIdAndDelete(data.voucherId);
            const rawVouchers = await Voucher.find({ userId: data.userId }).sort({ createdAt: -1 });
            const updatedVouchers = rawVouchers.map(v => {
                const vObj = v.toObject();
                vObj.formattedDate = formatMMDate(v.createdAt);
                return vObj;
            });

            io.emit('voucherUpdated', { userId: data.userId, vouchers: updatedVouchers });
        } catch (err) {
            console.error('Error deleting voucher:', err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
