import "server-only";

export type NotificationEnvStatus = {
  configured: boolean;
  email: {
    configured: boolean;
    missing: string[];
  };
  adminEmail: {
    configured: boolean;
    missing: string[];
  };
  missing: string[];
  optionalMissing: string[];
};

export function getNotificationEnvStatus(): NotificationEnvStatus {
  const emailMissing = [
    envMissing("RESEND_API_KEY"),
    senderMissing(),
  ].filter(Boolean) as string[];
  const adminMissing = [adminEmailMissing()].filter(Boolean) as string[];

  return {
    configured: emailMissing.length === 0,
    email: {
      configured: emailMissing.length === 0,
      missing: emailMissing,
    },
    adminEmail: {
      configured: adminMissing.length === 0,
      missing: adminMissing,
    },
    missing: emailMissing,
    optionalMissing: adminMissing,
  };
}

export function getResendFromEmail() {
  const configuredSenders = [
    process.env.FROM_EMAIL?.trim(),
    process.env.RESEND_FROM_EMAIL?.trim(),
  ].filter((sender): sender is string => Boolean(sender));

  return (
    configuredSenders.find((sender) => !isConsumerMailboxSender(sender)) ||
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

function isConsumerMailboxSender(sender: string) {
  const match = sender.match(/<([^>]+)>/);
  const email = (match?.[1] ?? sender).trim();
  const domain = email.split("@").at(-1)?.toLowerCase();
  return domain === "gmail.com" || domain === "googlemail.com";
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
