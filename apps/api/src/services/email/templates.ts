export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

type Section = { paragraphs: string[]; action?: { label: string; url: string }; footnote?: string };

function render(title: string, section: Section): { text: string; html: string } {
  const text = [
    title,
    '',
    ...section.paragraphs,
    ...(section.action ? ['', `${section.action.label}: ${section.action.url}`] : []),
    ...(section.footnote ? ['', section.footnote] : []),
    '',
    'A.ai',
  ].join('\n');

  const button = section.action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(section.action.url)}" style="background:#c2410c;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(section.action.label)}</a></p>
<p style="font-size:13px;color:#585e6b">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(section.action.url)}</span></p>`
    : '';

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f6f5f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111318">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
<p style="font-size:18px;font-weight:700;margin:0 0 24px">A<span style="color:#c2410c">.ai</span></p>
<div style="background:#ffffff;border:1px solid #dedcd3;border-radius:16px;padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${section.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${escapeHtml(p)}</p>`).join('\n')}
${button}
${section.footnote ? `<p style="font-size:13px;color:#585e6b;margin:24px 0 0">${escapeHtml(section.footnote)}</p>` : ''}
</div></div></body></html>`;

  return { text, html };
}

export function verificationEmail(input: { to: string; link: string }): EmailMessage {
  return {
    to: input.to,
    subject: 'Verify your email for A.ai',
    ...render('Confirm your email address', {
      paragraphs: [
        'Thanks for signing up for A.ai. Confirm this is your email address to finish creating your account.',
      ],
      action: { label: 'Verify email', url: input.link },
      footnote: "This link expires in 24 hours. If you didn't sign up, you can ignore this email.",
    }),
  };
}

export function accountExistsEmail(input: {
  to: string;
  loginLink: string;
  resetLink: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: 'You already have an A.ai account',
    ...render('You already have an account', {
      paragraphs: [
        'Someone tried to create an A.ai account with this email address, but an account already exists.',
        `If that was you, sign in instead: ${input.loginLink}`,
      ],
      action: { label: 'Reset your password', url: input.resetLink },
      footnote: "If you didn't try to sign up, no action is needed. Your account is unchanged.",
    }),
  };
}

export function passwordResetEmail(input: { to: string; link: string }): EmailMessage {
  return {
    to: input.to,
    subject: 'Reset your A.ai password',
    ...render('Reset your password', {
      paragraphs: ['We received a request to reset the password for your A.ai account.'],
      action: { label: 'Choose a new password', url: input.link },
      footnote:
        "This link expires in 1 hour and can be used once. If you didn't ask for a reset, ignore this email; your password stays the same.",
    }),
  };
}

export function passwordChangedEmail(input: { to: string; resetLink: string }): EmailMessage {
  return {
    to: input.to,
    subject: 'Your A.ai password was changed',
    ...render('Your password was changed', {
      paragraphs: [
        'The password for your A.ai account was just changed, and every other device was signed out.',
        "If this wasn't you, reset your password now to secure your account.",
      ],
      action: { label: 'Reset password', url: input.resetLink },
    }),
  };
}
