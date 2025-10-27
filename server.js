// server.js
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");
require("dotenv").config(); // charge .env AVANT toute lecture

const app = express();

/* ================== CONFIG MAIL ================== */
// --- Resend (API HTTP) ---
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
// From conseillé par Resend = domaine vérifié chez eux.
// Par défaut on garde ton adresse:
const FROM_EMAIL = (process.env.FROM_EMAIL || "").trim();

// --- SMTP (pour usage local uniquement, si tu veux) ---
const SMTP_HOST = process.env.SMTP_HOST || "ssl0.ovh.net";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || process.env.MAIL_PASS || "";
const EMAIL_TO = (process.env.EMAIL_TO || SMTP_USER || FROM_EMAIL || "").trim();

const NODE_ENV = process.env.NODE_ENV || "development";

// Logs de debug (non secrets)
console.log("🔎 MAIL CONFIG (debug)", {
  NODE_ENV,
  useResend: Boolean(RESEND_API_KEY),
  FROM_EMAIL,
  EMAIL_TO,
  smtp: {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure_will_be: SMTP_PORT === 465,
    user_present: Boolean(SMTP_USER),
    pass_present: Boolean(SMTP_PASS),
  },
});
/* ================================================= */

/* =================== CORS GLOBAL ================== */
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3002",
  "https://devom.fr",
  "https://www.devom.fr",
  "https://devom-frontend.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // curl, healthchecks
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);
app.options("*", cors());
/* ================================================== */

/* ================= MIDDLEWARES =================== */
app.use(express.json({ limit: "1mb" }));
/* ================================================ */

/* ===== Transport SMTP (optionnel pour le local) ==== */
function makeSmtpTransport({ port, secure, note }) {
  if (NODE_ENV !== "production") {
    console.log(`✉️  Tentative SMTP ${note} (host=${SMTP_HOST}, port=${port}, secure=${secure})`);
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,                       // 465 => TLS implicite
    requireTLS: !secure,          // 587 => STARTTLS
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    authMethod: "LOGIN",
    connectionTimeout: 10000,
    greetingTimeout: 7000,
    socketTimeout: 15000,
    tls: { minVersion: "TLSv1.2", servername: SMTP_HOST },
    logger: NODE_ENV !== "production",
    debug: NODE_ENV !== "production",
  });
}

let smtpTransporter = null;
async function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;

  const preferImplicitTLS = SMTP_PORT === 465;
  let t = makeSmtpTransport({
    port: SMTP_PORT,
    secure: preferImplicitTLS,
    note: preferImplicitTLS ? "TLS implicite 465" : "STARTTLS 587",
  });

  try {
    await t.verify();
    console.log("✅ SMTP prêt.");
    smtpTransporter = t;
    return smtpTransporter;
  } catch (e) {
    const msg = String(e?.message || "");
    const isTLSorConnIssue =
      msg.includes("before secure TLS connection was established") ||
      msg.includes("ECONNECTION") ||
      msg.includes("certificate") ||
      msg.includes("self signed") ||
      msg.includes("SSL") ||
      msg.includes("timeout");

    if (preferImplicitTLS && isTLSorConnIssue) {
      console.warn("⚠️ Échec sur 465, bascule automatique vers 587 (STARTTLS)...");
      t = makeSmtpTransport({ port: 587, secure: false, note: "fallback STARTTLS 587" });
      await t.verify();
      console.log("✅ SMTP prêt après fallback 587.");
      smtpTransporter = t;
      return smtpTransporter;
    }
    throw e;
  }
}
/* ================================================= */

/* ==================== ROUTES ==================== */
app.get("/health", (_req, res) => res.json({ ok: true }));

// Vérif "mail prêt ?" : OK si Resend a une clé, sinon on teste SMTP local
app.get("/mail/verify", async (_req, res) => {
  try {
    if (RESEND_API_KEY) {
      return res.json({ ok: true, via: "resend" });
    }
    const t = await getSmtpTransporter();
    await t.verify();
    return res.json({ ok: true, via: "smtp" });
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

    // 3) Construction de l'HTML (avec nettoyage)
    const escapedName = escapeHtml(name);
    const escapedEmail = escapeHtml(email);
    const escapedMessage = escapeHtml(message).replace(/\n/g, "<br>");

    const subject = `[Devom Contact] Nouveau message de ${escapedName}`;
    const html = `
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
    `;

    /* 4) ENVOI — Resend si dispo, sinon SMTP (local) */
    if (RESEND_API_KEY) {
      if (!FROM_EMAIL) {
        // Force un from si non fourni; idéalement FROM_EMAIL = domaine vérifié chez Resend
        throw new Error("FROM_EMAIL manquant pour l'envoi via Resend.");
      }
      const resend = new Resend(RESEND_API_KEY);
      const { data, error } = await resend.emails.send({
        from: `Devom <${FROM_EMAIL}>`,
        to: [EMAIL_TO],
        reply_to: escapedEmail,
        subject,
        html,
      });
      if (error) throw error;
      console.log(`✅ Message envoyé via Resend : ${data?.id || "OK"}`);
      return res.status(200).json({ message: "Message envoyé avec succès !" });
    } else {
      const t = await getSmtpTransporter();
      const info = await t.sendMail({
        from: FROM_EMAIL || SMTP_USER,
        to: EMAIL_TO || SMTP_USER,
        replyTo: escapedEmail,
        subject,
        html,
      });
      console.log(`✅ Message envoyé via SMTP : ${info.messageId}`);
      return res.status(200).json({ message: "Message envoyé avec succès !" });
    }
  } catch (error) {
    console.error("❌ ERREUR D'ENVOI D'EMAIL:", {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      responseCode: error?.responseCode,
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

