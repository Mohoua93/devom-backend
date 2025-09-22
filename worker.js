const { Worker } = require('bullmq');
const nodemailer = require('nodemailer');
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
};

const transporter = nodemailer.createTransport({
    host: 'ssl0.ovh.net',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const worker = new Worker('mailQueue', async (job) => {
    const { name, email, message } = job.data;
    
    const mailOptions = {
        from: `"${name}" <${email}>`,
        to: process.env.EMAIL_USER,
        subject: `Nouveau message de ${name}`,
        html: `<p>...Votre contenu HTML...</p>`,
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully for job ${job.id}`);
    } catch (error) {
        console.error(`Failed to send email for job ${job.id}:`, error);
        throw error; // Important pour que BullMQ puisse réessayer
    }
}, { connection });

console.log('Worker is running and waiting for jobs...');