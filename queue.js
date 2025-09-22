const { Queue } = require('bullmq');
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
};

const mailQueue = new Queue('mailQueue', { connection });

module.exports = mailQueue;