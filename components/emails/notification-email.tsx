type NotificationEmailProps = {
  recipientName: string;
  title: string;
  body: string;
  actionUrl: string | null;
  actionLabel: string;
  settingsUrl: string;
  appBaseUrl: string;
  additionalCount: number;
};

/**
 * The email counterpart of an in-app notification.
 *
 * Deliberately generic over notification type: it renders the title and body
 * the notification row already carries rather than restating them, so a new
 * type needs no new template and the email can never disagree with the app.
 */
export function NotificationEmail({
  recipientName,
  title,
  body,
  actionUrl,
  actionLabel,
  settingsUrl,
  appBaseUrl,
  additionalCount,
}: NotificationEmailProps) {
  const logoUrl = `${appBaseUrl.replace(/\/$/, "")}/schwifty-logo.png`;

  return (
    <html lang="en">
      <head>
        <title>{title}</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: "32px 16px",
          backgroundColor: "#f4efe9",
          color: "#261814",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ display: "none", overflow: "hidden", opacity: 0, maxHeight: 0, maxWidth: 0 }}>
          {body}
        </div>

        <div
          style={{
            maxWidth: 640,
            margin: "0 auto",
            background: "#ffffff",
            border: "1px solid rgba(209, 120, 55, 0.22)",
            borderRadius: 28,
            overflow: "hidden",
            boxShadow: "0 22px 54px rgba(89, 41, 16, 0.14)",
          }}
        >
          <div style={{ padding: "28px 28px 18px" }}>
            <img
              src={logoUrl}
              alt="Schwifty"
              width="180"
              style={{ display: "block", width: "180px", maxWidth: "100%", height: "auto", marginBottom: 18 }}
            />

            <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 800, color: "#261814" }}>
              {title}
            </h1>
          </div>

          <div style={{ padding: "0 28px 32px" }}>
            <p style={{ margin: "0 0 16px", fontSize: 16, lineHeight: 1.65 }}>Hi {recipientName},</p>

            <p style={{ margin: "0 0 16px", fontSize: 16, lineHeight: 1.7, color: "#4f342b" }}>{body}</p>

            {additionalCount > 0 ? (
              <p style={{ margin: "0 0 16px", fontSize: 15, lineHeight: 1.7, color: "#6a4334" }}>
                There {additionalCount === 1 ? "is" : "are"} also <strong>{additionalCount}</strong> other
                {additionalCount === 1 ? " update" : " updates"} waiting for you in Schwifty.
              </p>
            ) : null}

            {actionUrl ? (
              <div style={{ margin: "28px 0" }}>
                <a
                  href={actionUrl}
                  style={{
                    display: "inline-block",
                    padding: "14px 22px",
                    borderRadius: 999,
                    backgroundColor: "#ff7b31",
                    color: "#ffffff",
                    textDecoration: "none",
                    fontSize: 15,
                    fontWeight: 700,
                  }}
                >
                  {actionLabel}
                </a>
              </div>
            ) : null}

            <p style={{ margin: "24px 0 0", fontSize: 13, lineHeight: 1.7, color: "#7a5a4a" }}>
              You are receiving this because it affects your schedule.{" "}
              <a href={settingsUrl} style={{ color: "#b6541c", textDecoration: "underline" }}>
                Change your email preferences
              </a>
              .
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
