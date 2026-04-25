type AccountInviteEmailProps = {
  recipientName: string;
  inviteUrl: string;
  invitedByName?: string | null;
  appBaseUrl: string;
};

/**
 * Branded account-invitation email rendered through Resend.
 *
 * The component keeps the markup intentionally email-safe: inline styles,
 * hosted image assets, and a compact content structure that behaves reliably in
 * common inbox clients.
 */
export function AccountInviteEmail({
  recipientName,
  inviteUrl,
  invitedByName,
  appBaseUrl,
}: AccountInviteEmailProps) {
  const previewText = "You have been invited to create your Schwifty account.";
  const logoUrl = `${appBaseUrl.replace(/\/$/, "")}/schwifty-logo.png`;

  return (
    <html lang="en">
      <head>
        <title>Create your Schwifty account</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: "32px 16px",
          backgroundColor: "#f4efe9",
          color: "#261814",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ display: "none", overflow: "hidden", opacity: 0, maxHeight: 0, maxWidth: 0 }}>
          {previewText}
        </div>

        <div
          style={{
            maxWidth: 640,
            margin: "0 auto",
            background:
              "linear-gradient(180deg, rgba(255,129,53,0.16) 0%, rgba(255,255,255,0.96) 22%, #ffffff 100%)",
            border: "1px solid rgba(209, 120, 55, 0.22)",
            borderRadius: 28,
            overflow: "hidden",
            boxShadow: "0 22px 54px rgba(89, 41, 16, 0.14)",
          }}
        >
          <div
            style={{
              padding: "28px 28px 18px",
              background:
                "radial-gradient(circle at top, rgba(255, 120, 48, 0.28), rgba(255, 120, 48, 0) 64%)",
            }}
          >
            <img
              src={logoUrl}
              alt="Schwifty"
              width="220"
              style={{
                display: "block",
                width: "220px",
                maxWidth: "100%",
                height: "auto",
                marginBottom: 18,
              }}
            />

            <p
              style={{
                margin: 0,
                color: "#b6541c",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              Account Invitation
            </p>

            <h1
              style={{
                margin: "12px 0 0",
                fontSize: 32,
                lineHeight: 1.15,
                fontWeight: 800,
                color: "#261814",
              }}
            >
              Create your workspace account
            </h1>
          </div>

          <div style={{ padding: "8px 28px 32px" }}>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.65 }}>
              Hi {recipientName},
            </p>

            <p style={{ margin: "0 0 16px", fontSize: 16, lineHeight: 1.7, color: "#4f342b" }}>
              You have been invited to create your Schwifty account and join the planning workspace.
              Once your account is created, you will be able to sign in and access the schedule tools
              available to your role.
            </p>

            {invitedByName ? (
              <p style={{ margin: "0 0 16px", fontSize: 16, lineHeight: 1.7, color: "#4f342b" }}>
                This invitation was sent by <strong>{invitedByName}</strong>.
              </p>
            ) : null}

            <div
              style={{
                margin: "28px 0",
                padding: "22px",
                borderRadius: 22,
                backgroundColor: "#fff7f1",
                border: "1px solid rgba(209, 120, 55, 0.18)",
              }}
            >
              <p style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.65, color: "#6a4334" }}>
                Use the button below to open the account creation screen with your email already filled in.
              </p>

              <a
                href={inviteUrl}
                style={{
                  display: "inline-block",
                  padding: "14px 22px",
                  borderRadius: 999,
                  background: "linear-gradient(135deg, #ff7b31, #ff9445)",
                  color: "#ffffff",
                  textDecoration: "none",
                  fontSize: 15,
                  fontWeight: 700,
                  boxShadow: "0 10px 24px rgba(201, 89, 20, 0.28)",
                }}
              >
                Create account
              </a>
            </div>

            <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.7, color: "#6a4334" }}>
              If the button does not work, copy and paste this link into your browser:
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 13, lineHeight: 1.7, wordBreak: "break-all" }}>
              <a href={inviteUrl} style={{ color: "#b6541c", textDecoration: "underline" }}>
                {inviteUrl}
              </a>
            </p>

            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "#7a5a4a" }}>
              If you were not expecting this invitation, you can safely ignore this email.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
