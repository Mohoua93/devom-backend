const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

app.use(express.json());

// Configuration CORS simplifiée et plus robuste
app.use(cors({
    origin: ['http://localhost:3000', 'https://devom.fr', 'https://www.devom.fr', 'https://devom-frontend.vercel.app'],
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
}));

app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({ message: 'Tous les champs sont requis.' });
        }

        const transporter = nodemailer.createTransport({
            host: 'ssl0.ovh.net', // Conserver l'hôte d'OVH
            port: 587,           // 👈 Changer le port de 465 à 587
            secure: false,       // 👈 Changer à false pour utiliser STARTTLS
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
            // 👈 AJOUTER l'option TLS pour forcer le chiffrement STARTTLS
            tls: {
                rejectUnauthorized: false
            }
        });

        const mailOptions = {
            from: `"${name}" <${email}>`,
            to: process.env.EMAIL_USER,
            subject: `Nouveau message de ${name} via votre portfolio`,
            text: `Vous avez reçu un message de :\n\nNom: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
            html: `<p>Vous avez reçu un message de :</p>
                   <ul>
                     <li><strong>Nom :</strong> ${name}</li>
                     <li><strong>Email :</strong> ${email}</li>
                   </ul>
                   <p><strong>Message :</strong></p>
                   <p>${message.replace(/\n/g, '<br>')}</p>`,
        }

        await transporter.sendMail(mailOptions);

        res.status(200).json({ message: 'Message envoyé avec succès !' });

    } catch (error) {
        console.error('Erreur du serveur :', error);
        res.status(500).json({ message: 'Une erreur est survenue sur le serveur.' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Serveur démarré et à l'écoute sur le port ${PORT} 🚀`);
});