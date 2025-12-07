// =================== IMPORTS ===================
const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const path = require('path');
const twilio = require('twilio');
const serviceAccount = require('./serviceAccountKey.json');

// =================== FIRESTORE INIT ===================
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// =================== EXPRESS INIT ===================
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // serve frontend files

// =================== TWILIO CONFIG ===================
const TWILIO_ACCOUNT_SID = 'YOUR_TWILIO_ACCOUNT_SID';
const TWILIO_AUTH_TOKEN = 'YOUR_TWILIO_AUTH_TOKEN';
const TWILIO_PHONE_NUMBER = 'YOUR_TWILIO_PHONE_NUMBER';

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// =================== LOGIN ROUTE ===================
app.post('/login', async (req, res) => {
    const { cardNumber, name, phone } = req.body;
    if (!cardNumber || !name || !phone)
        return res.json({ success: false, message: "Please fill all details!" });

    try {
        const userRef = db.collection('users').doc(cardNumber);
        const doc = await userRef.get();
        if (!doc.exists) return res.json({ success: false, message: "User not registered!" });

        const userData = doc.data();

        if (userData.Name === name && userData["Phone Number"] === phone) {
            return res.json({ success: true, message: "Login successful!" });
        } else {
            return res.json({ success: false, message: "Invalid name or phone number!" });
        }
    } catch (err) {
        console.error(err);
        return res.json({ success: false, message: "Server error." });
    }
});

// =================== BOOKING ROUTE ===================
app.post('/book', async (req, res) => {
    const { card, date, session, slot } = req.body;
    if (!card || !date || !session || !slot)
        return res.json({ success: false, message: "Fill all details!" });

    try {
        const userRef = db.collection('users').doc(card);
        const doc = await userRef.get();
        if (!doc.exists) return res.json({ success: false, message: "User not registered!" });

        const userData = doc.data();

        const userBookingRef = userRef.collection('bookedDates').doc(date);
        const userBookingDoc = await userBookingRef.get();
        if (userBookingDoc.exists) return res.json({ success: false, message: "Already booked for this date!" });

        const slotRef = db.collection('bookings').doc(`${date}-${session}-${slot}`);
        const slotDoc = await slotRef.get();
        const count = slotDoc.exists ? slotDoc.data().count : 0;
        if (count >= 10) return res.json({ success: false, message: "Slot is full!" });

        const tokenNumber = Math.floor(1000 + Math.random() * 9000);

        // Save booking including timing
        await slotRef.set({ count: count + 1 }, { merge: true });
        await userBookingRef.set({ session, slot, token: tokenNumber, timing: slot });

        // =================== SEND SMS VIA TWILIO ===================
        const messageBody = `Hello ${userData.Name}, your booking is confirmed for ${date}, session: ${session}, slot: ${slot}. Your token is ${tokenNumber}.`;

        try {
            await client.messages.create({
                body: messageBody,
                from: TWILIO_PHONE_NUMBER,
                to: `+91${userData["Phone Number"]}`
            });

            // Send booking info for confirm page
            return res.json({
                success: true,
                message: "Booking confirmed! SMS sent via Twilio.",
                booking: { date, session, slot, timing: slot, token: tokenNumber }
            });

        } catch (smsError) {
            console.error("Cannot send SMS (Twilio trial error restriction):", smsError.message);
            return res.json({
                success: true,
                message: "Booking confirmed! (SMS could not be sent to this number on trial account)",
                booking: { date, session, slot, timing: slot, token: tokenNumber }
            });
        }

    } catch (err) {
        console.error(err);
        return res.json({ success: false, message: "Server error." });
    }
});

// =================== BOOKING DETAILS ROUTE FOR CONFIRM.HTML ===================
app.get('/bookingDetails', async (req, res) => {
    const { card, date } = req.query;
    if (!card || !date) return res.json({ success: false, message: "Missing card or date!" });

    try {
        const userBookingRef = db.collection('users').doc(card).collection('bookedDates').doc(date);
        const bookingDoc = await userBookingRef.get();
        if (!bookingDoc.exists) return res.json({ success: false, message: "Booking not found!" });

        const bookingData = bookingDoc.data();
        return res.json({ success: true, booking: bookingData });

    } catch (err) {
        console.error(err);
        return res.json({ success: false, message: "Server error." });
    }
});

// =================== FRONTEND ROUTES ===================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/select_slot', (req, res) => res.sendFile(path.join(__dirname, 'public', 'select_slot.html')));
app.get('/confirm', (req, res) => res.sendFile(path.join(__dirname, 'public', 'confirm.html')));

// =================== START SERVER ===================
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));