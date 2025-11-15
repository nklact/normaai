// Email Service Module - Resend Integration for Norma AI
// Sends professional transactional emails using Resend API

use chrono::Datelike;
use resend_rs::{Resend, Error};
use resend_rs::types::CreateEmailBaseOptions;

// Email constants
const FROM_EMAIL: &str = "Norma AI <info@normaai.rs>";
const LOGO_URL: &str = "https://normaai.rs/logo.svg";

// Brand colors from frontend App.css
const PRIMARY_COLOR: &str = "#064e3b";
const BG_PRIMARY: &str = "#ffffff";
const BG_SECONDARY: &str = "#f8f8f8";
const TEXT_PRIMARY: &str = "#0d0d0d";
const TEXT_SECONDARY: &str = "#3d3d3d";
const TEXT_MUTED: &str = "#8f8f8f";
const BORDER_COLOR: &str = "#eaeaea";

/// Generate base HTML email template with Norma AI branding
fn get_email_template(content: &str, preheader: &str) -> String {
    let current_year = chrono::Utc::now().year();

    format!(
        r#"<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Norma AI</title>
  <meta name="preheader" content="{preheader}">
  <style>
    * {{
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: {text_primary};
      background-color: {bg_secondary};
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }}
    .email-wrapper {{
      width: 100%;
      background-color: {bg_secondary};
      padding: 40px 20px;
    }}
    .email-container {{
      max-width: 600px;
      margin: 0 auto;
      background-color: {bg_primary};
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }}
    .email-header {{
      background-color: {bg_primary};
      border-bottom: 1px solid {border_color};
      padding: 32px 40px;
      text-align: center;
    }}
    .email-logo {{
      height: 30px;
      width: auto;
    }}
    .email-body {{
      padding: 40px;
    }}
    .email-title {{
      font-size: 24px;
      font-weight: 600;
      color: {text_primary};
      margin-bottom: 20px;
      line-height: 1.3;
    }}
    .email-text {{
      font-size: 16px;
      color: {text_secondary};
      margin-bottom: 16px;
      line-height: 1.6;
    }}
    .email-button {{
      display: inline-block;
      padding: 14px 32px;
      background-color: {primary_color};
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      font-size: 16px;
      margin: 24px 0;
    }}
    .email-divider {{
      height: 1px;
      background-color: {border_color};
      margin: 32px 0;
    }}
    .email-footer {{
      background-color: {bg_secondary};
      padding: 32px 40px;
      text-align: center;
      border-top: 1px solid {border_color};
    }}
    .email-footer-text {{
      font-size: 14px;
      color: {text_muted};
      margin-bottom: 8px;
    }}
    .email-footer-link {{
      color: {primary_color};
      text-decoration: none;
    }}
    .info-box {{
      background-color: {bg_secondary};
      border-left: 4px solid {primary_color};
      padding: 16px 20px;
      margin: 24px 0;
      border-radius: 4px;
    }}
    .info-box-text {{
      font-size: 14px;
      color: {text_secondary};
      margin: 0;
    }}
    @media only screen and (max-width: 600px) {{
      .email-header, .email-body, .email-footer {{
        padding: 24px 20px;
      }}
      .email-title {{
        font-size: 20px;
      }}
      .email-text {{
        font-size: 15px;
      }}
      .email-button {{
        display: block;
        width: 100%;
        text-align: center;
      }}
    }}
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-container">
      <div class="email-header">
        <img src="{logo_url}" alt="Norma AI" class="email-logo">
      </div>
      <div class="email-body">
        {content}
      </div>
      <div class="email-footer">
        <p class="email-footer-text">
          &copy; {year} Norma AI. Sva prava zadržana.
        </p>
        <p class="email-footer-text">
          <a href="https://normaai.rs" class="email-footer-link">normaai.rs</a>
        </p>
        <p class="email-footer-text" style="margin-top: 16px;">
          Ova poruka je poslata sa <strong>Norma AI</strong> platforme.
        </p>
      </div>
    </div>
  </div>
</body>
</html>"#,
        preheader = preheader,
        text_primary = TEXT_PRIMARY,
        bg_secondary = BG_SECONDARY,
        bg_primary = BG_PRIMARY,
        primary_color = PRIMARY_COLOR,
        text_secondary = TEXT_SECONDARY,
        border_color = BORDER_COLOR,
        text_muted = TEXT_MUTED,
        logo_url = LOGO_URL,
        content = content,
        year = current_year
    )
}

/// Send email verification email
pub async fn send_verification_email(
    resend_api_key: &str,
    email: &str,
    verification_token: &str,
) -> Result<String, Error> {
    let resend = Resend::new(resend_api_key);

    let verification_url = format!(
        "https://chat.normaai.rs/verify-email.html?token={}",
        verification_token
    );

    let email_content = format!(
        r#"
      <h1 class="email-title">Potvrdite vašu email adresu</h1>

      <p class="email-text">
        Hvala vam što ste se registrovali na Norma AI platformu!
      </p>

      <p class="email-text">
        Da biste završili registraciju i aktivirali vaš nalog, molimo vas da potvrdite vašu email adresu klikom na dugme ispod:
      </p>

      <div style="text-align: center;">
        <a href="{}" class="email-button">
          Potvrdite Email
        </a>
      </div>

      <div class="info-box">
        <p class="info-box-text">
          <strong>Napomena:</strong> Ovaj link važi 24 sata. Ako ne potvrdite svoju email adresu u tom roku, zatražite novi verifikacioni link putem Norma AI aplikacije.
        </p>
      </div>

      <div class="email-divider"></div>

      <p class="email-text" style="font-size: 14px; color: {};">
        Ako niste kreirali nalog na Norma AI platformi, možete ignorisati ovaj email.
      </p>

      <p class="email-text" style="font-size: 14px; color: {};">
        Ako dugme ne radi, kopirajte i nalepite sledeći link u vaš pretraživač:
      </p>

      <p style="font-size: 13px; color: {}; word-break: break-all;">
        {}
      </p>
    "#,
        verification_url, TEXT_MUTED, TEXT_MUTED, TEXT_MUTED, verification_url
    );

    let html = get_email_template(&email_content, "Potvrdite vašu email adresu za Norma AI");

    // Construct email using CreateEmailBaseOptions
    let email_payload = CreateEmailBaseOptions::new(
        FROM_EMAIL,
        vec![email],
        "Potvrdite vašu email adresu - Norma AI"
    )
    .with_html(&html);

    let result = resend
        .emails
        .send(email_payload)
        .await?;

    println!("✅ Verification email sent to: {} (ID: {})", email, result.id);

    Ok(result.id.to_string())
}

/// Send password reset email
pub async fn send_password_reset_email(
    resend_api_key: &str,
    email: &str,
    reset_token: &str,
) -> Result<String, Error> {
    let resend = Resend::new(resend_api_key);

    let reset_url = format!(
        "https://chat.normaai.rs/reset-password.html?token={}",
        reset_token
    );

    let email_content = format!(
        r#"
      <h1 class="email-title">Resetovanje lozinke</h1>

      <p class="email-text">
        Dobili smo zahtev za resetovanje lozinke za vaš Norma AI nalog.
      </p>

      <p class="email-text">
        Kliknite na dugme ispod da biste kreirali novu lozinku:
      </p>

      <div style="text-align: center;">
        <a href="{}" class="email-button">
          Resetuj Lozinku
        </a>
      </div>

      <div class="info-box">
        <p class="info-box-text">
          <strong>Napomena:</strong> Ovaj link važi 1 sat. Ako ne resetujete lozinku u tom roku, ponovo zatražite reset lozinke putem Norma AI aplikacije.
        </p>
      </div>

      <div class="email-divider"></div>

      <p class="email-text" style="font-size: 14px; color: {};">
        <strong>Niste tražili resetovanje lozinke?</strong><br>
        Možete ignorisati ovaj email. Vaša lozinka neće biti promenjena.
      </p>

      <p class="email-text" style="font-size: 14px; color: {};">
        Ako dugme ne radi, kopirajte i nalepite sledeći link u vaš pretraživač:
      </p>

      <p style="font-size: 13px; color: {}; word-break: break-all;">
        {}
      </p>
    "#,
        reset_url, TEXT_MUTED, TEXT_MUTED, TEXT_MUTED, reset_url
    );

    let html = get_email_template(&email_content, "Resetujte vašu Norma AI lozinku");

    // Construct email using CreateEmailBaseOptions
    let email_payload = CreateEmailBaseOptions::new(
        FROM_EMAIL,
        vec![email],
        "Resetovanje lozinke - Norma AI"
    )
    .with_html(&html);

    let result = resend
        .emails
        .send(email_payload)
        .await?;

    println!(
        "✅ Password reset email sent to: {} (ID: {})",
        email, result.id
    );

    Ok(result.id.to_string())
}
