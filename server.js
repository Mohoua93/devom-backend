// server.js
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
require("dotenv").config(); // charge .env AVANT toute lecture

const app = express();

/* ================== CONFIG SMTP ================== */
const SMTP_HOST = process.env.SMTP_HOST || "ssl0.ovh.net";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER;
const SMTP_PASS = process.env.SMTP_PASS || process.env.MAIL_PASS;

// Adresse d’expéditeur et de réception par défaut
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;
const EMAIL_TO = process.env.EMAIL_TO || SMTP_USER;

// Logs de debug (non secrets)
console.log("🔎 SMTP CONFIG (debug)", {
  SMTP_HOST,
  SMTP_PORT,
  secure_will_be: SMTP_PORT === 465,
  FROM_EMAIL,
  EMAIL_TO,
  user_present: Boolean(SMTP_USER),
  pass_present: Boolean(SMTP_PASS),
});
/* ================================================= */

/* ===== Création du transporteur avec fallback ===== */
function makeTransport({ port, secure, note }) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`✉️  Tentative SMTP ${note} (host=${SMTP_HOST}, port=${port}, secure=${secure})`);
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,                       // 465 => TLS implicite
    requireTLS: !secure,          // 587 => STARTTLS
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    authMethod: "LOGIN",          // sûr pour OVH & Office365
    connectionTimeout: 10000,     // 10s
    greetingTimeout: 7000,
    socketTimeout: 15000,
    tls: {
      minVersion: "TLSv1.2",
      servername: SMTP_HOST,      // SNI explicite
    },
    logger: process.env.NODE_ENV !== "production",
    debug: process.env.NODE_ENV !== "production",
  });
}

let transporter = null;
let transporterReady = null;

async function initTransporter() {
  if (transporter) return transporter;
  if (transporterReady) return transporterReady;

  transporterReady = (async () => {
    const preferImplicitTLS = SMTP_PORT === 465;

    // 1ère tentative : valeurs de l'env
    let t = makeTransport({
      port: SMTP_PORT,
      secure: preferImplicitTLS,
      note: preferImplicitTLS ? "TLS implicite 465" : "STARTTLS 587",
    });

    try {
      await t.verify();
      console.log("✅ Nodemailer prêt.");
      transporter = t;
      return transporter;
    } catch (e) {
      const msg = String(e?.message || "");
      const isTLSorConnIssue =
        msg.includes("before secure TLS connection was established") ||
        msg.includes("ECONNECTION") ||
        msg.includes("certificate") ||
        msg.includes("self signed") ||
        msg.includes("SSL") ||
        msg.includes("timeout");

      // Si 465 échoue sur TLS/connexion → fallback 587
      if (preferImplicitTLS && isTLSorConnIssue) {
        console.warn("⚠️ Échec sur 465, bascule automatique vers 587 (STARTTLS)...");
        t = makeTransport({ port: 587, secure: false, note: "fallback STARTTLS 587" });
        await t.verify();
        console.log("✅ Nodemailer prêt après fallback 587.");
        transporter = t;
        return transporter;
      }

      // Sinon on remonte l'erreur
      throw e;
    }
  })();

  return transporterReady;
}

async function ensureTransporter() {
  try {
    return await initTransporter();
  } catch (err) {
    console.error("❌ ERREUR Nodemailer - Échec de la connexion SMTP :", err?.message);
    throw err;
  }
}
/* ================================================= */

/* ================= MIDDLEWARES =================== */
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
    methods: ["POST", "OPTIONS", "GET"],
    allowedHeaders: ["Content-Type"],
  })
);
app.options("/api/contact", cors());
/* ================================================ */

/* ==================== ROUTES ==================== */
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/smtp/verify", async (_req, res) => {
  try {
    const t = await ensureTransporter();
    const ok = await t.verify();
    return res.json({ ok });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body || {};

    // 1) Validation minimale
    if (!name || !email || !message) {
      return res.status(400).json({ message: "Tous les champs sont requis." });
    }
    if (String(message).length > 5000) {
      return res.status(400).json({ message: "Message trop long." });
    }

    // 2) Anti-bot (refus si trop de liens)
    const hasManyLinks = (String(message).match(/https?:\/\//gi) || []).length > 3;
    if (hasManyLinks) {
      console.warn("🛡️ Spam bloqué (trop de liens).");
      return res.status(400).json({ message: "Message non valide." });
    }

    // 3) Construction des emails (avec nettoyage HTML)
    const escapedName = escapeHtml(name);
    const escapedEmail = escapeHtml(email);
    const escapedMessage = escapeHtml(message).replace(/\n/g, "<br>");

    const mailOptions = {
      from: FROM_EMAIL,          // souvent requis = même adresse que l'utilisateur SMTP
      to: EMAIL_TO,
      replyTo: escapedEmail,
      subject: `[Devom Contact] Nouveau message de ${escapedName}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee;">
          <h2 style="color: #333;">Nouveau contact via devom.fr</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; width: 120px;"><strong>Nom :</strong></td>
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

    // 4) Envoi
    const t = await ensureTransporter();
    const info = await t.sendMail(mailOptions);
    console.log(`✅ Message envoyé : ${info.messageId}`);
    return res.status(200).json({ message: "Message envoyé avec succès !" });
  } catch (error) {
    console.error("❌ ERREUR D'ENVOI D'EMAIL (Nodemailer):", {
      name: error?.name,
      message: error?.message,
    });
    return res.status(500).json({
      message:
        "Une erreur est survenue lors de l'envoi de l'email. Veuillez réessayer plus tard.",
    });
  }
});
/* ================================================ */

/* ================== DÉMARRAGE ==================== */
const APP_PORT = Number(process.env.APP_PORT) || Number(process.env.PORT) || 3001;
app.listen(APP_PORT, () => {
  console.log(`Serveur démarré et à l'écoute sur le port ${APP_PORT} 🚀`);
});
/* ================================================ */

/* ==================== HELPERS ==================== */
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

