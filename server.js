const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer"); // <-- Changement 1 : Utilisation de Nodemailer
require("dotenv").config();

const app = express();

// --- Configuration du transporteur Nodemailer (Serveur SMTP)
// Ces informations (HOST, PORT, USER, PASS) sont lues depuis le fichier .env
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "ssl0.ovh.net", // L'hôte de votre serveur SMTP (OVH, Sendinblue, etc.)
  port: process.env.SMTP_PORT || 465,             // Le port sécurisé standard (465 avec 'secure: true')
  secure: true,                                   // Utiliser SSL/TLS
  auth: {
    user: process.env.EMAIL_USER,                 // Votre adresse email complète (ex: info@devom.fr)
    pass: process.env.MAIL_PASS,                  // Le mot de passe de l'adresse email (PAS le mot de passe de connexion OVH)
  },
});

// VÉRIFICATION CRUCIALE : Test de connexion au serveur SMTP
transporter.verify(function (error, success) {
  if (error) {
    console.error("❌ ERREUR Nodemailer - Échec de la connexion au serveur SMTP. Vérifiez HOST, PORT, EMAIL_USER et MAIL_PASS dans .env :", error.message);
  } else {
    console.log("✅ Nodemailer est prêt à envoyer des emails.");
  }
});

// --- Middlewares CORS
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3002",
      "https://devom.fr",
      "https://www.devom.fr",
      "https://devom-frontend.vercel.app",
    ],
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.options("/api/contact", cors());

// --- Routes
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body || {};

    // 1. Validation minimale
    if (!name || !email || !message) {
      return res.status(400).json({ message: "Tous les champs sont requis." });
    }
    if (String(message).length > 5000) {
      return res.status(400).json({ message: "Message trop long." });
    }

    // 2. Anti-bot (Refuse si trop de liens)
    const hasManyLinks = (message.match(/https?:\/\//gi) || []).length > 3;
    if (hasManyLinks) {
      console.warn("🛡️ Tentative de spam bloquée (trop de liens).");
      return res.status(400).json({ message: "Message non valide." });
    }

    // 3. Construction des emails (avec nettoyage HTML)
    const escapedName = escapeHtml(name);
    const escapedEmail = escapeHtml(email);
    const escapedMessage = escapeHtml(message).replace(/\n/g, "<br>");

    const mailOptions = {
      // L'adresse qui envoie l'email. DOIT CORRESPONDRE à process.env.EMAIL_USER pour la plupart des serveurs SMTP.
      from: process.env.EMAIL_USER,
      // Le destinataire réel de la requête (votre email de contact)
      to: process.env.EMAIL_TO,
      // Permet de répondre directement au visiteur
      replyTo: escapedEmail,
      
      subject: `[Devom Contact] Nouveau message de ${escapedName}`,
      
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee;">
          <h2 style="color: #333;">Nouveau Contact via votre site Devom.fr</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; width: 100px;"><strong>Nom :</strong></td>
              <td style="padding: 8px; border: 1px solid #ddd;">${escapedName}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;"><strong>Email :</strong></td>
              <td style="padding: 8px; border: 1px solid #ddd;"><a href="mailto:${escapedEmail}">${escapedEmail}</a></td>
            </tr>
          </table>
          <h3 style="margin-top: 20px;">Message :</h3>
          <p style="white-space: pre-wrap; background-color: #f9f9f9; padding: 15px; border-radius: 4px;">${escapedMessage}</p>
        </div>
      `,
    };

    // 4. Envoi de l'email via Nodemailer
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Message envoyé : ${info.messageId}`);

    return res.status(200).json({ message: "Message envoyé avec succès !" });

  } catch (error) {
    // Log détaillé côté serveur
    console.error("❌ ERREUR D'ENVOI D'EMAIL (Nodemailer):", {
      name: error?.name,
      message: error?.message,
    });
    // Retourne une erreur générique au client pour ne pas exposer les détails du serveur.
    return res.status(500).json({ message: "Une erreur est survenue lors de l'envoi de l'email. Veuillez réessayer plus tard." });
  }
});

// --- Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serveur démarré et à l'écoute sur le port ${PORT} 🚀`);
});

// --- Helpers (nettoie les données utilisateur pour le HTML)
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

