import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export interface InviteEmailProps {
  firstName?: string;
  inviteUrl: string;
  logoUrl: string;
  expiresInDays?: number;
}

const BRAND_ORANGE = '#FF6B1A';
const BRAND_ORANGE_DARK = '#E55A0F';
const BRAND_INK = '#1A1A1A';
const BRAND_MUTED = '#6B6B6B';
const BRAND_BG = '#FFF7F2';

export const InviteEmail = ({
  firstName = 'there',
  inviteUrl,
  logoUrl,
  expiresInDays = 7,
}: InviteEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>
        {`You're invited to Schwifty, ${firstName} — claim your account`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Logo */}
          <Section style={{ textAlign: 'center', padding: '8px 0 24px' }}>
            <Img
              src={logoUrl}
              alt="Schwifty"
              width="160"
              height="auto"
              style={{ display: 'inline-block' }}
            />
          </Section>

          {/* Hero card */}
          <Section style={hero}>
            <Heading as="h1" style={h1}>
              Hey {firstName}, welcome to Schwifty.
            </Heading>
            <Text style={lede}>
              You've been invited to create your account. Tap the button below
              to set up your profile and get started — it only takes a minute.
            </Text>

            <Section style={{ textAlign: 'center', padding: '8px 0 4px' }}>
              <Button href={inviteUrl} style={button}>
                Create my account
              </Button>
            </Section>

            <Text style={fineprint}>
              This invite is unique to you and expires in {expiresInDays} days.
            </Text>
          </Section>

          {/* What's next */}
          <Section style={whatsNext}>
            <Heading as="h2" style={h2}>
              What's next
            </Heading>
            <Text style={listItem}>
              <span style={bullet}>1.</span> Click the button above to land on
              your personalized signup page.
            </Text>
            <Text style={listItem}>
              <span style={bullet}>2.</span> Pick a password and confirm a few
              details.
            </Text>
            <Text style={listItem}>
              <span style={bullet}>3.</span> You're in. We'll walk you through
              the rest.
            </Text>
          </Section>

          {/* Fallback link */}
          <Hr style={hr} />
          <Text style={fallback}>
            Button not working? Paste this link into your browser:
          </Text>
          <Text style={fallbackLink}>
            <Link href={inviteUrl} style={{ color: BRAND_ORANGE_DARK }}>
              {inviteUrl}
            </Link>
          </Text>

          {/* Footer */}
          <Hr style={hr} />
          <Text style={footer}>
            If you weren't expecting this invite, you can safely ignore this
            email. The link will expire on its own.
          </Text>
          <Text style={footer}>
            © {new Date().getFullYear()} Schwifty · Made with care
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default InviteEmail;

/* --- styles --- */

const body: React.CSSProperties = {
  backgroundColor: BRAND_BG,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: '32px 0',
};

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '40px 32px',
  maxWidth: '560px',
  borderRadius: '16px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};

const hero: React.CSSProperties = {
  paddingBottom: '8px',
};

const h1: React.CSSProperties = {
  color: BRAND_INK,
  fontSize: '28px',
  fontWeight: 700,
  lineHeight: 1.2,
  margin: '0 0 12px',
  textAlign: 'center',
};

const h2: React.CSSProperties = {
  color: BRAND_INK,
  fontSize: '16px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  margin: '0 0 12px',
};

const lede: React.CSSProperties = {
  color: BRAND_INK,
  fontSize: '16px',
  lineHeight: 1.55,
  margin: '0 0 24px',
  textAlign: 'center',
};

const button: React.CSSProperties = {
  backgroundColor: BRAND_ORANGE,
  color: '#ffffff',
  borderRadius: '10px',
  fontSize: '16px',
  fontWeight: 600,
  padding: '14px 28px',
  textDecoration: 'none',
  display: 'inline-block',
  border: `1px solid ${BRAND_ORANGE_DARK}`,
};

const fineprint: React.CSSProperties = {
  color: BRAND_MUTED,
  fontSize: '13px',
  lineHeight: 1.5,
  margin: '20px 0 0',
  textAlign: 'center',
};

const whatsNext: React.CSSProperties = {
  backgroundColor: BRAND_BG,
  borderRadius: '12px',
  padding: '20px 24px',
  margin: '28px 0 8px',
};

const listItem: React.CSSProperties = {
  color: BRAND_INK,
  fontSize: '15px',
  lineHeight: 1.55,
  margin: '6px 0',
};

const bullet: React.CSSProperties = {
  color: BRAND_ORANGE_DARK,
  fontWeight: 700,
  marginRight: '8px',
};

const hr: React.CSSProperties = {
  borderColor: '#EFEFEF',
  margin: '28px 0',
};

const fallback: React.CSSProperties = {
  color: BRAND_MUTED,
  fontSize: '13px',
  margin: '0 0 6px',
};

const fallbackLink: React.CSSProperties = {
  color: BRAND_ORANGE_DARK,
  fontSize: '13px',
  wordBreak: 'break-all',
  margin: 0,
};

const footer: React.CSSProperties = {
  color: BRAND_MUTED,
  fontSize: '12px',
  lineHeight: 1.5,
  margin: '6px 0',
  textAlign: 'center',
};

/* Preview props for `react-email dev` */
InviteEmail.PreviewProps = {
  firstName: 'Adam',
  inviteUrl: 'https://schwifty-adambursey-3058s-projects.vercel.app/sign-up?token=preview-token-abc123&email=adam%40example.com',
  logoUrl:
    'https://via.placeholder.com/160x42/FF6B1A/FFFFFF?text=Schwifty',
  expiresInDays: 7,
} satisfies InviteEmailProps;
