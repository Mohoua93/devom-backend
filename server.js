const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
require("dotenv").config();

const app = express();

// --- Middlewares
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3002", // <-- AJOUTÉ : Autorise l'exécution depuis ce port local
      "https://devom.fr",
      "https://www.devom.fr",
      "https://devom-frontend.vercel.app",
    ],
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
// Préflight (au cas où)
app.options("/api/contact", cors());

// --- Resend init (API d'envoi d'emails)
const resendApiKey = process.env.RESEND_API_KEY;

// VÉRIFICATION AJOUTÉE : Rend l'initialisation plus robuste
if (!resendApiKey) {
  console.error("🚨 ERREUR: La variable RESEND_API_KEY est manquante dans .env ou dans les variables d'environnement.");
}

const resend = new Resend(resendApiKey);

// --- Routes
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/contact", async (req, res) => {
  try {
    // Si la clé est manquante, nous retournons une erreur pour ne pas appeler Resend
    if (!resendApiKey) {
        return res.status(500).json({ message: "Le service d'envoi d'emails n'est pas configuré sur le serveur." });
    }

    const { name, email, message } = req.body || {};

    // Validation minimale
    if (!name || !email || !message) {
      return res.status(400).json({ message: "Tous les champs sont requis." });
    }
    if (String(message).length > 5000) {
      return res.status(400).json({ message: "Message trop long." });
    }

    // (Option) petit anti-bot: refuse si lien suspect
    const hasManyLinks = (message.match(/https?:\/\//gi) || []).length > 3;
    if (hasManyLinks) {
      return res.status(400).json({ message: "Message non valide." });
    }

    // Construction du contenu
    const plain = `Vous avez reçu un message :
Nom: ${name}
Email: ${email}

Message:
${message}`;

    const html = `
      <p>Vous avez reçu un message :</p>
      <ul>
        <li><strong>Nom :</strong> ${escapeHtml(name)}</li>
        <li><strong>Email :</strong> ${escapeHtml(email)}</li>
      </ul>
      <p><strong>Message :</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
    `;

    // Envoi via Resend (PAS de SMTP, donc pas de timeout réseau vers un port SMTP)
    await resend.emails.send({
      from: process.env.FROM_EMAIL || "Devom <no-reply@devom.fr>", // idéalement un domaine vérifié sur Resend
      to: process.env.TO_EMAIL || process.env.EMAIL_USER,          // destinataire réel (toi)
      reply_to: email,                                             // pour répondre au visiteur
      subject: `Nouveau message de ${name} via votre portfolio`,
      text: plain,
      html,
    });

    return res.status(200).json({ message: "Message envoyé avec succès !" });
  } catch (error) {
    // Log détaillé côté serveur
    console.error("[CONTACT ERROR]", {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      statusCode: error?.statusCode,
    });
    return res.status(500).json({ message: "Une erreur est survenue sur le serveur." });
  }
});

// --- Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serveur démarré et à l'écoute sur le port ${PORT} 🚀`);
});

// --- Helpers
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
