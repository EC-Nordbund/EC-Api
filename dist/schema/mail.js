"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("./mysql");
const nodemailer_1 = require("nodemailer");
async function sendMail(from, e, subject, body, isHTML = true, attachments = []) {
    const smtp = nodemailer_1.createTransport({
        host: process.env.SMTP_SERVER,
        port: process.env.SMTP_PORT,
        auth: {
            user: process.env.SMTP_USERNAME,
            pass: process.env.SMTP_PASSWORD
        }
    });
    const mailData = Object.assign({ from, to: e.to, cc: e.cc || '', bcc: e.bcc || '', subject }, (isHTML ? { html: body } : { text: body }), { attachments: attachments.map(at => (Object.assign({}, at, { encoding: 'base64' }))) });
    await smtp.sendMail(mailData);
    await mysql_1.query(`INSERT INTO gesendeteEmails (content) VALUES ('${JSON.stringify(mailData)}')`);
    return true;
}
exports.default = sendMail;
