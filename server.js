// Importer les librairies nécessaires
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config(); // Pour charger les variables d'environnement

// Initialiser l'application Express
const app = express();

// --- CONFIGURATION CORS SÉCURISÉE ---
// Liste des "origines" (sites web) autorisées à communiquer avec votre backend
const allowedOrigins = [
  'http://localhost:3000', // Votre frontend en développement
  'https://devom.fr'
];

const corsOptions = {
  origin: (origin, callback) => {
    // Autorise les requêtes sans origine (ex: Postman) ou celles de la liste blanche
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Origine non autorisée par CORS'));
    }
  }
};

// --- MIDDLEWARES ---
// Appliquer la configuration CORS avant toutes les routes
app.use(cors(corsOptions));
// Permettre à Express de comprendre le JSON envoyé par le frontend
app.use(express.json());


// --- ROUTE POUR LE FORMULAIRE DE CONTACT ---
// La route doit correspondre à celle appelée par votre frontend : /api/contact
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    // 1. Validation des données côté serveur (sécurité de base)
    if (!name || !email || !message) {
      return res.status(400).json({ message: 'Tous les champs sont requis.' });
    }

    // 2. Configuration du transporteur d'email (Nodemailer)
    // Utilise les identifiants stockés dans le fichier .env
    const transporter = nodemailer.createTransport({
      host: 'smtp.office365.com', // Serveur SMTP de Microsoft
      port: 587,
      secure: false, // `false` pour le port 587, `true` pour le 465
      auth: {
        user: process.env.EMAIL_USER, // info@devom.fr
        pass: process.env.EMAIL_PASS, // Le mot de passe de votre boîte mail
      },
    });

    // 3. Définition du contenu de l'email
    const mailOptions = {
      from: `"${name}" <${email}>`, // Affiche le nom et l'email de l'expéditeur
      to: process.env.EMAIL_USER,   // L'adresse où vous recevez les messages
      subject: `Nouveau message de ${name} via votre portfolio`,
      text: `Vous avez reçu un message de :\n\nNom: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      html: `<p>Vous avez reçu un message de :</p>
             <ul>
               <li><strong>Nom :</strong> ${name}</li>
               <li><strong>Email :</strong> ${email}</li>
             </ul>
             <p><strong>Message :</strong></p>
             <p>${message.replace(/\n/g, '<br>')}</p>`, // Affiche le message en HTML
    };

    // 4. Envoi de l'email
    await transporter.sendMail(mailOptions);

    // 5. Envoi d'une réponse de succès au frontend
    res.status(200).json({ message: 'Message envoyé avec succès !' });

  } catch (error) {
    console.error('Erreur du serveur :', error);
    // 6. Envoi d'une réponse d'erreur générique au frontend
    res.status(500).json({ message: 'Une erreur est survenue sur le serveur.' });
  }
});


// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serveur démarré et à l'écoute sur le port ${PORT} 🚀`);
});