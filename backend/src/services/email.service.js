const nodemailer = require('nodemailer');
const { clientOrigin } = require('../config/env');

const LOGO_URL = process.env.LOGO_URL || 'http://www.collings.com.au/wp-content/uploads/2023/05/logo_collings.png';
const PEN_ICON_URL = process.env.PEN_ICON_URL || 'http://www.collings.com.au/wp-content/uploads/2026/02/contract-2.png';
const PASSWORD_ICON_URL = process.env.PASSWORD_ICON_URL || 'http://www.collings.com.au/wp-content/uploads/2026/02/password.png';

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn(
      '[email] SMTP settings missing – set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to enable email sending'
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return transporter;
}

function buildDocuSignStyleHtml({ signUrl, senderName, senderEmail, signerName, documentTitle }) {
  const displayTitle = documentTitle.endsWith('.pdf') ? documentTitle : `${documentTitle}.pdf`;
  const safeSenderName = (senderName || 'Someone').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeSignerName = (signerName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeDocTitle = displayTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; background:#fff;">
    <div style="height:4px; background: linear-gradient(90deg, #38a5b0 0%, #55c5d0 100%);"></div>
    <div style="padding:24px 24px 16px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
       <img src="${LOGO_URL}" alt="Collings" style="height:22px;width:auto;display:inline-block;vertical-align:middle;" /><span style="font-size:14px; font-weight:500; color:#000000; vertical-align:middle; margin-left:2px;">eSign</span>
      </div>
      <div style="background:#55c5d082; border-radius:12px; padding:32px 24px; text-align:center;">
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="width:48px; height:48px; margin:0 auto 16px; background:rgba(0,0,0,0.15); border-radius:50%;">
          <tr><td align="center" valign="middle"><img src="${PEN_ICON_URL}" alt="" style="width:28px; height:28px; display:block; margin:0 auto;" /></td></tr>
        </table>
        <p style="margin:0 0 24px; color:#000; font-size:16px; line-height:1.5;">
          <strong>${safeSenderName}</strong> sent you a document to review and sign.
        </p>
        <a href="${signUrl}" style="display:inline-block; padding:12px 28px; background:#000; color:#fff; text-decoration:none; font-weight:600; font-size:15px; border-radius:8px;">
          Review Document
        </a>
      </div>
    </div>
    <div style="padding:8px 24px 24px; color:#57595c; font-size:14px; line-height:1.6;">
      <p style="margin:0 0 8px;"><strong>${safeSenderName}</strong><br/><a href="mailto:${senderEmail}" style="color:#55c5d0;">${senderEmail}</a></p>
      <p style="margin:16px 0 8px;">${safeSignerName},</p>
      <p style="margin:0 0 16px;">Complete with Collings eSign: <strong>${safeDocTitle}</strong></p>
      <p style="margin:24px 0 0;">Thank You,<br/>${safeSenderName}</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendSignRequestEmail({ signerEmail, signerName, token, documentTitle, ownerEmail }) {
  const t = getTransporter();
  if (!t) {
    return;
  }

  const signUrl = `${clientOrigin.replace(/\/+$/, '')}/sign/${token}`;

  const mailOptions = {
    to: signerEmail,
    from: ownerEmail || process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject: `Signature requested: ${documentTitle}`,
    text: `Hi ${signerName || ''},

You have been asked to sign the document "${documentTitle}".

Open this secure link to review and sign:
${signUrl}

If you weren't expecting this, you can ignore this email.

— Collings eSign`,
    html: `<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
  <p>Hi ${signerName || ''},</p>
  <p>You have been asked to sign the document <strong>${documentTitle}</strong>.</p>
  <p>
    <a href="${signUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#55c5d0;color:#000000;text-decoration:none;font-weight:500;">
      Review &amp; sign document
    </a>
  </p>
  <p>If the button doesn&apos;t work, copy and paste this link into your browser:</p>
  <p style="font-size:13px;color:#4b5563;word-break:break-all;">${signUrl}</p>
  <p style="font-size:12px;color:#6b7280;">If you weren&apos;t expecting this, you can safely ignore this email.</p>
  <p style="font-size:12px;color:#9ca3af;">— Collings eSign</p>
</div>`,
  };

  await t.sendMail(mailOptions);
}

/** Collings eSign-style email: branded block + "Review Document" CTA; recipient must log in or create account to sign */
async function sendDocuSignStyleSignEmail({
  signerEmail,
  signerName,
  token,
  documentTitle,
  senderName
}) {
  const t = getTransporter();
  if (!t) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }

  const signUrl = `${clientOrigin.replace(/\/+$/, '')}/sign/${token}`;
  const subject = `Please complete with Collings eSign: ${documentTitle}`;

  const html = buildDocuSignStyleHtml({
    signUrl,
    senderName: senderName || 'Someone',
    senderEmail: process.env.EMAIL_FROM || '',
    signerName,
    documentTitle: documentTitle.endsWith('.pdf') ? documentTitle : `${documentTitle}.pdf`,
  });

  const from = process.env.EMAIL_FROM;
  const mailOptions = {
    to: signerEmail,
    from,
    subject,
    text: `${senderName || 'Someone'} sent you a document to review and sign.\n\nDocument: ${documentTitle}\n\nReview and sign: ${signUrl}\n\nYou will need to log in or create an account to sign the document.\n\nThank You,\n${senderName || 'Someone'}`,
    html,
  };

  console.log('[email] Sending to:', signerEmail, 'from:', from);
  const result = await t.sendMail(mailOptions);
  console.log("result", result);
  console.log('[email] Sent successfully to:', signerEmail, 'messageId:', result.messageId);
}

/** Profile OTP email – matches DocuSign-style design with password icon */
function buildProfileOtpHtml(otp) {
  const code = String(otp).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; background:#fff;">
    <div style="height:4px; background: linear-gradient(90deg, #38a5b0 0%, #55c5d0 100%);"></div>
    <div style="padding:24px 24px 16px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
       <img src="${LOGO_URL}" alt="Collings" style="height:22px;width:auto;display:inline-block;vertical-align:middle;" /><span style="font-size:14px; font-weight:500; color:#000000; vertical-align:middle; margin-left:2px;">eSign</span>
      </div>
      <div style="background:#55c5d082; border-radius:12px; padding:32px 24px; text-align:center;">
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="width:48px; height:48px; margin:0 auto 16px; background:rgba(0,0,0,0.15); border-radius:50%;">
          <tr><td align="center" valign="middle"><img src="${PASSWORD_ICON_URL}" alt="" style="width:28px; height:28px; display:block; margin:0 auto;" /></td></tr>
        </table>
        <p style="margin:0 0 24px; color:#000; font-size:16px; line-height:1.5;">
          Your verification code to update your profile.
        </p>
        <p style="margin:0 0 8px; font-size:28px; font-weight:600; letter-spacing:0.2em; color:#000;">${code}</p>
        <p style="margin:16px 0 0; font-size:14px; color:#333;">Use this code in the app. It expires in 10 minutes.</p>
      </div>
    </div>
    <div style="padding:8px 24px 24px; color:#57595c; font-size:14px; line-height:1.6;">
      <p style="margin:24px 0 0;">Thank You,<br/>Collings eSign</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendProfileOtpEmail({ to, otp }) {
  const t = getTransporter();
  if (!t) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }
  const subject = 'Your verification code';
  const html = buildProfileOtpHtml(otp);
  const mailOptions = {
    to,
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject,
    text: `Your verification code is ${otp}. Use it to update your profile. It expires in 10 minutes.`,
    html,
  };
  await t.sendMail(mailOptions);
}

/** Signup OTP email – verify your email to create account; matches DocuSign-style design */
function buildSignupOtpHtml(otp) {
  const code = String(otp).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; background:#fff;">
    <div style="height:4px; background: linear-gradient(90deg, #38a5b0 0%, #55c5d0 100%);"></div>
    <div style="padding:24px 24px 16px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
       <img src="${LOGO_URL}" alt="Collings" style="height:22px;width:auto;display:inline-block;vertical-align:middle;" /><span style="font-size:14px; font-weight:500; color:#000000; vertical-align:middle; margin-left:2px;">eSign</span>
      </div>
      <div style="background:#55c5d082; border-radius:12px; padding:32px 24px; text-align:center;">
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="width:48px; height:48px; margin:0 auto 16px; background:rgba(0,0,0,0.15); border-radius:50%;">
          <tr><td align="center" valign="middle"><img src="${PASSWORD_ICON_URL}" alt="" style="width:28px; height:28px; display:block; margin:0 auto;" /></td></tr>
        </table>
        <p style="margin:0 0 24px; color:#000; font-size:16px; line-height:1.5;">
          Your verification code to verify your email and complete signup.
        </p>
        <p style="margin:0 0 8px; font-size:28px; font-weight:600; letter-spacing:0.2em; color:#000;">${code}</p>
        <p style="margin:16px 0 0; font-size:14px; color:#333;">Use this code in the app. It expires in 10 minutes.</p>
      </div>
    </div>
    <div style="padding:8px 24px 24px; color:#57595c; font-size:14px; line-height:1.6;">
      <p style="margin:24px 0 0;">Thank You,<br/>Collings eSign</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendSignupOtpEmail({ to, otp }) {
  const t = getTransporter();
  if (!t) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }
  const subject = 'Verify your email – Collings eSign';
  const html = buildSignupOtpHtml(otp);
  const mailOptions = {
    to,
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject,
    text: `Your verification code is ${otp}. Use it to verify your email and complete signup. It expires in 10 minutes.`,
    html,
  };
  await t.sendMail(mailOptions);
}

/** Forgot password OTP email – same layout as OTP, message for password reset */
function buildForgotPasswordOtpHtml(otp) {
  const code = String(otp).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; background:#fff;">
    <div style="height:4px; background: linear-gradient(90deg, #38a5b0 0%, #55c5d0 100%);"></div>
    <div style="padding:24px 24px 16px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
       <img src="${LOGO_URL}" alt="Collings" style="height:22px;width:auto;display:inline-block;vertical-align:middle;" /><span style="font-size:14px; font-weight:500; color:#000000; vertical-align:middle; margin-left:2px;">eSign</span>
      </div>
      <div style="background:#55c5d082; border-radius:12px; padding:32px 24px; text-align:center;">
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="width:48px; height:48px; margin:0 auto 16px; background:rgba(0,0,0,0.15); border-radius:50%;">
          <tr><td align="center" valign="middle"><img src="${PASSWORD_ICON_URL}" alt="" style="width:28px; height:28px; display:block; margin:0 auto;" /></td></tr>
        </table>
        <p style="margin:0 0 24px; color:#000; font-size:16px; line-height:1.5;">
          Your verification code to reset your password.
        </p>
        <p style="margin:0 0 8px; font-size:28px; font-weight:600; letter-spacing:0.2em; color:#000;">${code}</p>
        <p style="margin:16px 0 0; font-size:14px; color:#333;">Use this code in the app. It expires in 10 minutes.</p>
      </div>
    </div>
    <div style="padding:8px 24px 24px; color:#57595c; font-size:14px; line-height:1.6;">
      <p style="margin:24px 0 0;">Thank You,<br/>Collings eSign</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendForgotPasswordOtpEmail({ to, otp }) {
  const t = getTransporter();
  if (!t) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }
  const subject = 'Reset your password – Collings eSign';
  const html = buildForgotPasswordOtpHtml(otp);
  const mailOptions = {
    to,
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject,
    text: `Your verification code to reset your password is ${otp}. Use it in the app. It expires in 10 minutes.`,
    html,
  };
  await t.sendMail(mailOptions);
}

/** Signed but envelope not complete – "You've successfully signed; wait for others; you'll get the document by email when complete" */
function buildSignedWaitingForOthersHtml({ documentTitle, recipientName }) {
  const displayTitle = documentTitle.endsWith('.pdf') ? documentTitle : `${documentTitle}.pdf`;
  const safeDocTitle = displayTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeName = (recipientName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; background:#fff;">
    <div style="height:4px; background: linear-gradient(90deg, #38a5b0 0%, #55c5d0 100%);"></div>
    <div style="padding:24px 24px 16px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
       <img src="${LOGO_URL}" alt="Collings" style="height:22px;width:auto;display:inline-block;vertical-align:middle;" /><span style="font-size:14px; font-weight:500; color:#000000; vertical-align:middle; margin-left:2px;">eSign</span>
      </div>
      <div style="background:#55c5d082; border-radius:12px; padding:32px 24px; text-align:center;">
        <p style="margin:0 0 16px; color:#000; font-size:18px; font-weight:600;">You&apos;ve successfully signed</p>
        <p style="margin:0 0 24px; color:#000; font-size:16px; line-height:1.5;">
          Please wait for the other recipients to finish signing. Once the envelope is complete, you&apos;ll receive an email with a link to download the document.
        </p>
        <p style="margin:0; color:#57595c; font-size:14px;">Document: <strong>${safeDocTitle}</strong></p>
      </div>
    </div>
    <div style="padding:8px 24px 24px; color:#57595c; font-size:14px; line-height:1.6;">
      ${safeName ? `<p style="margin:0 0 8px;">${safeName},</p>` : ''}
      <p style="margin:24px 0 0;">Thank You,<br/>Collings eSign</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendSignedWaitingForOthersEmail({ to, recipientName, documentTitle }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[email] SMTP not configured – skipping signed-waiting email to', to);
    return;
  }

  const subject = `You've signed: ${documentTitle}`;
  const html = buildSignedWaitingForOthersHtml({ documentTitle, recipientName });

  const mailOptions = {
    to,
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject,
    text: `You've successfully signed.\n\nPlease wait for the other recipients to finish. Once the envelope is complete, you'll receive an email with a link to download the document.\n\nDocument: ${documentTitle}\n\nThank You,\nCollings eSign`,
    html,
  };

  try {
    await t.sendMail(mailOptions);
    console.log('[email] Signed-waiting email sent to:', to);
  } catch (err) {
    console.error('[email] Failed to send signed-waiting email to', to, err);
  }
}

/** Document completed – "Your document has been completed" + View Completed Document (same layout as other Collings eSign emails) */
function buildDocumentCompletedHtml({ viewCompletedUrl, documentTitle, recipientName }) {
  const displayTitle = documentTitle.endsWith('.pdf') ? documentTitle : `${documentTitle}.pdf`;
  const safeDocTitle = displayTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeName = (recipientName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; background:#fff;">
    <div style="height:4px; background: linear-gradient(90deg, #38a5b0 0%, #55c5d0 100%);"></div>
    <div style="padding:24px 24px 16px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
       <img src="${LOGO_URL}" alt="Collings" style="height:22px;width:auto;display:inline-block;vertical-align:middle;" /><span style="font-size:14px; font-weight:500; color:#000000; vertical-align:middle; margin-left:2px;">eSign</span>
      </div>
      <div style="background:#55c5d082; border-radius:12px; padding:32px 24px; text-align:center;">
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="width:48px; height:48px; margin:0 auto 16px; background:rgba(0,0,0,0.15); border-radius:50%;">
          <tr><td align="center" valign="middle"><img src="${PEN_ICON_URL}" alt="" style="width:28px; height:28px; display:block; margin:0 auto;" /></td></tr>
        </table>
        <p style="margin:0 0 24px; color:#000; font-size:16px; line-height:1.5;">
          Your document has been completed.
        </p>
        <a href="${viewCompletedUrl}" style="display:inline-block; padding:12px 28px; background:#000; color:#fff; text-decoration:none; font-weight:600; font-size:15px; border-radius:8px;">
          View Completed Document
        </a>
      </div>
    </div>
    <div style="padding:8px 24px 24px; color:#57595c; font-size:14px; line-height:1.6;">
      <p style="margin:0 0 8px;">All signers completed. Complete with Collings eSign: <strong>${safeDocTitle}</strong></p>
      ${safeName ? `<p style="margin:16px 0 0;">${safeName},</p>` : ''}
      <p style="margin:24px 0 0;">Thank You,<br/>Collings eSign</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendDocumentCompletedEmail({ to, recipientName, token, documentTitle }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[email] SMTP not configured – skipping completion email to', to);
    return;
  }

  const viewCompletedUrl = `${clientOrigin.replace(/\/+$/, '')}/sign/${token}`;
  const subject = `Your document has been completed: ${documentTitle}`;
  const html = buildDocumentCompletedHtml({
    viewCompletedUrl,
    documentTitle: documentTitle.endsWith('.pdf') ? documentTitle : `${documentTitle}.pdf`,
    recipientName,
  });

  const mailOptions = {
    to,
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    subject,
    text: `Your document has been completed.\n\nDocument: ${documentTitle}\n\nView completed document: ${viewCompletedUrl}\n\nThank You,\nCollings eSign`,
    html,
  };

  try {
    await t.sendMail(mailOptions);
    console.log('[email] Completion email sent to:', to);
  } catch (err) {
    console.error('[email] Failed to send completion email to', to, err);
  }
}

module.exports = {
  sendSignRequestEmail,
  sendDocuSignStyleSignEmail,
  sendProfileOtpEmail,
  sendSignupOtpEmail,
  sendForgotPasswordOtpEmail,
  sendSignedWaitingForOthersEmail,
  sendDocumentCompletedEmail,
};

