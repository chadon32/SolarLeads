export type NotificationEnvStatus = {
  configured: boolean;
  email: {
    configured: boolean;
    missing: string[];
  };
  missing: string[];
};

export function getNotificationEnvStatus(): NotificationEnvStatus {
  const emailMissing = [
    envMissing("RESEND_API_KEY"),
    senderMissing(),
    adminEmailMissing(),
  ].filter(Boolean) as string[];

  return {
    configured: emailMissing.length === 0,
    email: {
      configured: emailMissing.length === 0,
      missing: emailMissing,
    },
    missing: emailMissing,
  };
}

export function getResendFromEmail() {
  return (
    process.env.FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "reports@solartelligence.com"
  );
}

export function getAdminEmail() {
  return process.env.ADMIN_EMAIL?.trim() || process.env.OWNER_EMAIL?.trim() || "";
}

export function isValidSenderEmail(value: string) {
  const match = value.match(/<([^>]+)>/);
  const email = (match?.[1] ?? value).trim();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function envMissing(name: string) {
  return process.env[name]?.trim() ? "" : name;
}

function senderMissing() {
  const fromEmail = getResendFromEmail();

  if (!isValidSenderEmail(fromEmail)) {
    return "FROM_EMAIL or RESEND_FROM_EMAIL must be a valid sender email";
  }

  return "";
}

function adminEmailMissing() {
  return getAdminEmail() ? "" : "ADMIN_EMAIL or OWNER_EMAIL";
}
